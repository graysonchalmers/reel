// Live viewer server: watch the trailer file, rebuild timelines and reports on save, render a
// half-size proxy MP4 in the background, push state over SSE, serve frames, proxies and feedback.
import { createReadStream, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unwatchFile, watchFile, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { frameAt, scaled } from "../core/compose.ts";
import { type ReelError, wrap } from "../core/errors.ts";
import { type OtioEdit, editOtio } from "../core/otio.ts";
import { png } from "../core/png.ts";
import type { Project, Timeline } from "../core/project.ts";
import { FeedbackError, writeFeedback } from "./feedback.ts";
import { loadProject } from "./load.ts";
import { FrameSource, inspect } from "./media.ts";
import { renderMp4 } from "./render.ts";
import { clipText, report } from "./report.ts";

export interface ServeOptions {
  host?: string; media?: string[]; port?: number; out?: string; log?: (line: string) => void }

interface ErrInfo { message: string; loc?: string }
interface Proxy { state: "waiting" | "rendering" | "ready" | "failed"; progress: number; version: number; error?: string }
interface TrailerInfo {
  name: string; w: number; h: number; fps: number; dur: number; bpm?: number; beat0: number;
  clips: { n: number; start: number; dur: number; kind: string; text: string; loc?: string; in: string; inDur: number; from?: number }[];
  report: string; music?: { hop: number; db: number[]; hits: number[] }; proxy: Proxy; error?: ErrInfo;
}
interface State { version: number; file: string; editable: boolean; undo: number; redo: number; time: string; ms: number; error?: ErrInfo; trailers: TrailerInfo[] }

const viewerDir = join(dirname(fileURLToPath(import.meta.url)), "..", "viewer");
const errInfo = (e: ReelError): ErrInfo => ({ message: e.message, loc: e.loc });

export function serve(file: string, opts: ServeOptions = {}): Promise<{ url: string; close: () => void }> {
  const abs = resolve(file);
  const out = opts.out ?? join(dirname(abs), "out");
  const log = opts.log ?? ((l: string) => console.log(l));
  const clients = new Set<ServerResponse>();
  let project: Project | undefined;
  let timelines = new Map<string, Timeline>();
  const editable = /\.otio$/i.test(abs);
  const histDir = join(out, "_history", basename(abs));
  const redoDir = join(histDir, "_redo");
  const count = (d: string) => { try { return readdirSync(d).filter((f) => f.endsWith(".otio")).length; } catch { return 0; } };
  const undoCount = () => count(histDir), redoCount = () => count(redoDir);
  const lastIn = (d: string) => { try { return readdirSync(d).filter((f) => f.endsWith(".otio")).sort().pop(); } catch { return undefined; } };
  // Stamps sort in time order even with several edits in one millisecond.
  let seq = 0;
  const stamp = () => `${Date.now()}-${String(seq++ % 1000).padStart(3, "0")}.otio`;
  // Folders the "add clip" picker offers: --media dirs, else next to the edit and ../media.
  const mediaDirs = (opts.media?.length ? opts.media.map((d) => resolve(d)) : [dirname(abs), resolve(dirname(abs), "media"), resolve(dirname(abs), ".."), resolve(dirname(abs), "..", "media")]);
  const MEDIA_RE = /\.(mp4|mov|webm|mkv|gif|png|jpe?g)$/i;
  const listMedia = () => {
    const files: { name: string; path: string; dir: string }[] = [];
    for (const d of [...new Set(mediaDirs)]) {
      let names: string[] = [];
      try { names = readdirSync(d); } catch { continue; }
      for (const n of names.sort()) if (MEDIA_RE.test(n) && !n.startsWith(".")) files.push({ name: n, path: join(d, n), dir: basename(d) });
    }
    return files;
  };
  let state: State = { version: 0, editable, undo: 0, redo: 0, file: basename(abs), time: "", ms: 0, trailers: [] };
  let watched = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let abort: AbortController | undefined;
  const frameSources = new Map<string, FrameSource>();

  const push = () => {
    const msg = `event: build\ndata: ${JSON.stringify(state)}\n\n`;
    for (const c of clients) c.write(msg);
  };

  /** Proxies render one after another; a new build cancels the run. */
  const renderProxies = async (version: number, signal: AbortSignal) => {
    for (const t of state.trailers) {
      const tl = timelines.get(t.name);
      if (!tl || signal.aborted) continue;
      t.proxy = { state: "rendering", progress: 0, version };
      push();
      const final = join(out, "_proxy", t.name + ".mp4"), tmp = final.replace(/\.mp4$/, ".part.mp4");
      let lastPush = 0;
      try {
        await renderMp4(tl, tmp, { scale: 0.5, preset: "ultrafast", crf: 26, signal, onProgress: (f, n) => {
          t.proxy.progress = f / n;
          if (performance.now() - lastPush > 400) { lastPush = performance.now(); push(); }
        } });
        renameSync(tmp, final);
        t.proxy = { state: "ready", progress: 1, version };
      } catch (e) {
        rmSync(tmp, { force: true });
        if (signal.aborted) return;
        t.proxy = { state: "failed", progress: 0, version, error: wrap(e).message };
      }
      push();
    }
  };

  const rebuild = () => {
    abort?.abort();
    const t0 = performance.now();
    const next: State = { version: state.version + 1, editable, undo: undoCount(), redo: redoCount(), file: basename(abs), time: new Date().toLocaleTimeString(), ms: 0, trailers: [] };
    const nextTl = new Map<string, Timeline>();
    try { project = loadProject(abs); } catch (e) { project = undefined; next.error = errInfo(wrap(e)); }
    if (project) {
      for (const name of project.order) {
        const def = project.trailers.get(name)!;
        const info: TrailerInfo = { name, w: def.w, h: def.h, fps: def.fps, dur: 0, bpm: def.bpm, beat0: def.beat0, clips: [], report: "", proxy: { state: "waiting", progress: 0, version: next.version } };
        try {
          const tl = project.timeline(name), r = report(tl);
          nextTl.set(name, tl);
          Object.assign(info, {
            dur: tl.dur, report: r.text,
            clips: tl.clips.map((c) => ({ n: c.i + 1, start: c.start, dur: c.dur, kind: c.def.kind, text: clipText(c), loc: c.def.loc, in: c.def.in.type, inDur: c.def.in.dur, from: c.def.kind === "shot" ? c.def.from : undefined })),
            music: r.music && { hop: r.music.hop, db: r.music.db, hits: r.music.hits.map((h) => h.t) },
          });
        } catch (e) {
          info.error = errInfo(wrap(e, (s) => project!.locFromStack(s)));
          info.proxy.state = "failed";
        }
        next.trailers.push(info);
      }
      const media = [...nextTl.values()].flatMap((tl) => [...inspect(tl).probes.keys()]);
      watch([...project.files, ...media]);
    } else watch([abs]);
    next.ms = Math.round(performance.now() - t0);
    state = next;
    timelines = nextTl;
    frameSources.clear();
    const bad = next.error ? 1 : next.trailers.filter((t) => t.error).length;
    log(`[reel] v${next.version} ${next.ms}ms: ${next.trailers.length} trailer(s), ${bad} error(s)` + (next.error ? `\n  ${next.error.message}` : ""));
    push();
    abort = new AbortController();
    void renderProxies(next.version, abort.signal);
  };

  const schedule = () => { clearTimeout(timer); timer = setTimeout(rebuild, 120); };
  function watch(files: string[]) {
    const nextSet = new Set(files);
    for (const f of watched) if (!nextSet.has(f)) unwatchFile(f);
    for (const f of nextSet) if (!watched.has(f)) watchFile(f, { interval: 200 }, (a, b) => { if (a.mtimeMs !== b.mtimeMs) schedule(); });
    watched = nextSet;
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const name = url.searchParams.get("name") ?? "";
    try {
      if (url.pathname === "/" || url.pathname === "/app.js") {
        const js = url.pathname === "/app.js";
        res.writeHead(200, { "content-type": js ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8" });
        res.end(readFileSync(join(viewerDir, js ? "app.js" : "index.html")));
      } else if (url.pathname === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(`event: build\ndata: ${JSON.stringify(state)}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
      } else if (url.pathname === "/api/frame") {
        // The exact composed frame, at a preview width.
        const tl = timelines.get(name);
        if (!tl) { res.writeHead(404); res.end("no such trailer"); return; }
        const w = Math.max(64, Math.min(tl.def.w, Number(url.searchParams.get("w")) || 960));
        const key = `${name}|${w}`;
        const small = scaled(tl, w / tl.def.w);
        let src = frameSources.get(key);
        if (!src) { src = new FrameSource(small, inspect(small).probes); frameSources.set(key, src); }
        const t = Math.max(0, Math.min((tl.frames - 1) / tl.def.fps, Number(url.searchParams.get("t")) || 0));
        const im = frameAt(small, Math.floor(t * tl.def.fps + 1e-6) / tl.def.fps, src);
        res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
        res.end(Buffer.from(png(im.w, im.h, im.data, (b) => deflateSync(b, { level: 1 }))));
      } else if (url.pathname === "/api/proxy") {
        // MP4 with byte ranges, so the video element can seek.
        const path = join(out, "_proxy", basename(name) + ".mp4");
        const size = statSync(path).size, m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
        if (m) {
          const a = m[1] ? Number(m[1]) : size - Number(m[2]), z = m[1] && m[2] ? Number(m[2]) : size - 1;
          res.writeHead(206, { "content-type": "video/mp4", "accept-ranges": "bytes", "content-range": `bytes ${a}-${z}/${size}`, "content-length": z - a + 1, "cache-control": "no-store" });
          createReadStream(path, { start: a, end: z }).pipe(res);
        } else {
          res.writeHead(200, { "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": size, "cache-control": "no-store" });
          createReadStream(path).pipe(res);
        }
      } else if (url.pathname === "/api/media") {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(listMedia().map(({ name, dir }) => ({ name, dir }))));
      } else if (url.pathname === "/api/thumb") {
        // A small still from a media file for the picker (first frame, 1 s in for video).
        const f = listMedia().find((m) => m.name === url.searchParams.get("f") && m.dir === url.searchParams.get("d"));
        if (!f) { res.writeHead(404); res.end(); return; }
        const r = spawnSync("ffmpeg", ["-v", "error", ...(/\.(png|jpe?g)$/i.test(f.name) ? [] : ["-ss", "1"]), "-i", f.path, "-frames:v", "1", "-vf", "scale=240:-2", "-f", "image2", "-c:v", "mjpeg", "-"], { maxBuffer: 8 << 20 });
        if (r.status !== 0 || !r.stdout.length) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "max-age=300" });
        res.end(r.stdout);
      } else if ((url.pathname === "/api/edit" || url.pathname === "/api/undo" || url.pathname === "/api/redo") && req.method === "POST") {
        // Edits write the master .otio (old copy kept in out/_history for undo, undone copies in
        // out/_history/<file>/_redo for redo); the watcher rebuilds. A new edit clears redo.
        const chunks: Buffer[] = [];
        req.on("data", (d: Buffer) => chunks.push(d));
        req.on("end", () => {
          const reply = (code: number, j: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
          if (!editable) return reply(409, { error: "editing needs an .otio file: run `reel otio` and serve the .otio" });
          try {
            if (url.pathname === "/api/undo" || url.pathname === "/api/redo") {
              const undo = url.pathname === "/api/undo";
              const [from, to] = undo ? [histDir, redoDir] : [redoDir, histDir];
              const last = lastIn(from);
              if (!last) return reply(409, { error: undo ? "nothing to undo" : "nothing to redo" });
              mkdirSync(to, { recursive: true });
              writeFileSync(join(to, stamp()), readFileSync(abs, "utf8"));
              renameSync(join(from, last), abs);
              log(`[reel] ${undo ? "undo" : "redo"} -> ${last}`);
            } else {
              const e = JSON.parse(Buffer.concat(chunks).toString("utf8")) as OtioEdit & { file?: string; dir?: string };
              if (e.op === "insert") {
                // Only files the picker offers can be added.
                const f = listMedia().find((m) => m.name === e.file && m.dir === e.dir);
                if (!f) throw new Error(`no media file '${e.file}'`);
                e.src = f.path;
              }
              const cur = readFileSync(abs, "utf8");
              const next = editOtio(JSON.parse(cur), e);
              mkdirSync(histDir, { recursive: true });
              writeFileSync(join(histDir, stamp()), cur);
              writeFileSync(abs, JSON.stringify(next, null, 2) + "\n");
              // The redo branch is dead now: park it (kept, not deleted) out of the stack.
              if (redoCount()) renameSync(redoDir, join(histDir, `_dropped-redo-${Date.now()}`));
              log(`[reel] edit ${JSON.stringify(e)}`);
            }
            rebuild();
            reply(200, { ok: true, undo: undoCount(), redo: redoCount() });
          } catch (err) { reply(400, { error: wrap(err).message }); }
        });
      } else if (url.pathname === "/api/feedback" && req.method === "POST") {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (d: Buffer) => { size += d.length; if (size > 4 << 20) req.destroy(); else chunks.push(d); });
        req.on("end", () => {
          const reply = (code: number, j: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
          if (!project) return reply(409, { error: "the trailer file does not build right now" });
          try {
            const r = writeFeedback(project, out, JSON.parse(Buffer.concat(chunks).toString("utf8")));
            log(`[reel] feedback: ${r.summary} -> ${r.files[0]}`);
            reply(200, { ok: true, ...r });
          } catch (e) {
            reply(e instanceof FeedbackError || e instanceof SyntaxError ? 400 : 500, { error: (e as Error).message });
          }
        });
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    } catch (e) {
      res.writeHead(500);
      res.end(wrap(e).message);
    }
  });
  const ping = setInterval(() => { for (const c of clients) c.write(": ping\n\n"); }, 15000);

  return new Promise((ok, fail) => {
    server.on("error", fail);
    server.listen(opts.port ?? 4340, opts.host ?? "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      rebuild();
      ok({
        url: `http://${opts.host && opts.host !== "0.0.0.0" ? opts.host : "127.0.0.1"}:${port}/`,
        close: () => {
          abort?.abort();
          clearInterval(ping);
          clearTimeout(timer);
          for (const f of watched) unwatchFile(f);
          for (const c of clients) c.end();
          server.close();
        },
      });
    });
  });
}
