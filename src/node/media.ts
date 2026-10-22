// Media in: ffprobe facts about every source, frames decoded by ffmpeg (one at a time for
// previews, as a stream for renders), and text rendered by resvg. The only owner of source
// timing: a shot's local time u maps to source time here and nowhere else.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { type Img, type Sources, type TextSpec, image } from "../core/compose.ts";
import { ReelError } from "../core/errors.ts";
import type { Clip, ShotDef, Timeline } from "../core/project.ts";

export interface Probe {
  path: string;
  w: number;
  h: number;
  /** Seconds; undefined for a still image. */
  dur?: number;
  fps: number;
  audio: boolean;
  /** Animated GIFs loop. */
  loop: boolean;
}

const probes = new Map<string, { mtime: number; p: Probe }>();

function run(args: string[], what: string, maxBuffer = 1 << 30) {
  const r = spawnSync("ffmpeg", ["-v", "error", ...args], { maxBuffer });
  if (r.error) throw new ReelError(`${what} needs ffmpeg on PATH`);
  if (r.status !== 0) throw new ReelError(`ffmpeg failed (${what}): ${String(r.stderr).trim().split("\n").slice(-3).join(" | ")}`);
  return r.stdout;
}

export function probe(path: string): Probe {
  let mtime: number;
  try { mtime = statSync(path).mtimeMs; } catch { throw new ReelError(`no such file '${path}'`); }
  const hit = probes.get(path);
  if (hit && hit.mtime === mtime) return hit.p;
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,format_name:stream=codec_type,width,height,avg_frame_rate,nb_frames", "-of", "json", path], { encoding: "utf8" });
  if (r.error) throw new ReelError("reel needs ffprobe (part of ffmpeg) on PATH");
  if (r.status !== 0) throw new ReelError(`'${path}' is not a readable image, video or audio file: ${r.stderr.trim()}`);
  const j = JSON.parse(r.stdout) as { format?: { duration?: string; format_name?: string }; streams?: { codec_type: string; width?: number; height?: number; avg_frame_rate?: string }[] };
  const v = j.streams?.find((s) => s.codec_type === "video");
  const fmt = j.format?.format_name ?? "";
  const still = !!v && (/image2|_pipe$|^png|^webp/.test(fmt) || !j.format?.duration);
  const [a, b] = (v?.avg_frame_rate ?? "0/1").split("/").map(Number);
  const p: Probe = {
    path, w: v?.width ?? 0, h: v?.height ?? 0,
    dur: still ? undefined : Number(j.format?.duration) || undefined,
    fps: b ? a / b : 0,
    audio: !!j.streams?.some((s) => s.codec_type === "audio"),
    loop: fmt === "gif" && !still,
  };
  probes.set(path, { mtime, p });
  return p;
}

/** Every source of a timeline probed; missing or unreadable files fail at the clip that names them. */
export function inspect(tl: Timeline): { probes: Map<string, Probe>; warnings: string[] } {
  const out = new Map<string, Probe>(), warnings: string[] = [];
  const get = (path: string, what: string, loc?: string) => {
    try { const p = probe(path); out.set(path, p); return p; } catch (e) { throw (e as ReelError).within(what, loc); }
  };
  if (tl.def.music) {
    const m = get(tl.def.music.src, "music", tl.def.loc);
    if (!m.dur) throw new ReelError(`music '${m.path}' has no duration`, tl.def.loc);
    if (m.dur - tl.def.music.from < tl.dur) warnings.push(`music ends at ${(m.dur - tl.def.music.from).toFixed(2)}s, before the trailer (${tl.dur.toFixed(2)}s)`);
  }
  for (const c of tl.clips) {
    const what = `clip ${c.i + 1} (${c.def.label})`;
    for (const s of c.def.sfx) get(s.src, `${what} sfx`, s.loc ?? c.def.loc);
    if (c.def.kind !== "shot") continue;
    const p = get(c.def.src, what, c.def.loc);
    if (!p.w) throw new ReelError(`'${p.path}' has no picture`).within(what, c.def.loc);
    const d = c.def, tail = tl.clips[c.i + 1]?.def.in.dur ?? 0;
    const end = d.from + (c.dur + tail) * d.speed;
    if (p.dur !== undefined && !p.loop && end > p.dur + 1e-3) warnings.push(`${what} needs source time up to ${end.toFixed(2)}s but '${base(p.path)}' is ${p.dur.toFixed(2)}s: it holds the last frame`);
    if (d.audio > 0 && !p.audio) warnings.push(`${what} asks for audio but '${base(p.path)}' has none`);
  }
  return { probes: out, warnings };
}

const base = (p: string) => p.replace(/^.*[\\/]/, "");

/** Source seconds a shot shows u seconds after it starts. */
export function sourceTime(d: ShotDef, p: Probe, u: number): number {
  let t = d.from + u * d.speed;
  if (p.dur === undefined) return 0;
  if (p.loop) t %= p.dur;
  return Math.max(0, Math.min(t, p.dur - 0.5 / Math.max(1, p.fps || 30)));
}

/** Decode size: never more pixels than the shot can show at its largest zoom. */
export function decodeSize(d: ShotDef, p: Probe, W: number, H: number): [number, number] {
  const base = d.fit === "cover" ? Math.max(W / p.w, H / p.h) : Math.min(W / p.w, H / p.h);
  const s = Math.min(1, base * Math.max(...d.move.zoom));
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return [even(p.w * s), even(p.h * s)];
}

const scaleFilter = (d: ShotDef, w: number, h: number) => `scale=${w}:${h}:flags=${d.pixel ? "neighbor" : "lanczos"}`;

// ---------------------------------------------------------------- text

const fonts = new Map<string, string | undefined>();
function fontFile(family: string, weight: number): string | undefined {
  const key = `${family}:${weight}`;
  if (fonts.has(key)) return fonts.get(key);
  if (/\.(ttf|otf)$/i.test(family)) {
    try { statSync(family); } catch { throw new ReelError(`no such font file '${family}'`); }
    fonts.set(key, family);
    return family;
  }
  const w = weight >= 900 ? "black" : weight >= 800 ? "extrabold" : weight >= 700 ? "bold" : weight >= 600 ? "semibold" : weight >= 500 ? "medium" : weight <= 300 ? "light" : "regular";
  const r = spawnSync("fc-match", ["-f", "%{file}|%{family}", `${family}:${w}`], { encoding: "utf8" });
  const [file, fam] = r.error || r.status !== 0 ? [] : r.stdout.split("|");
  const f = file && fam?.toLowerCase().includes(family.toLowerCase()) ? file : undefined;
  fonts.set(key, f);
  return f;
}

/** The family name inside a font file, so SVG text can ask for it. */
function familyOf(file: string): string {
  const r = spawnSync("fc-scan", ["--format", "%{family[0]}", file], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim().split("\n")[0] : file.replace(/^.*[\\/]/, "").replace(/\.\w+$/, "");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Text as an image: wrapped to maxW, centred lines, optional soft shadow. Cached. */
export function textImage(spec: TextSpec, cache: Map<string, Img>): Img {
  const key = JSON.stringify(spec);
  const hit = cache.get(key);
  if (hit) return hit;
  const st = spec.style, file = fontFile(st.font, st.weight), family = file && file === st.font ? familyOf(file) : st.font;
  const font = file ? { fontFiles: [file], loadSystemFonts: false, defaultFontFamily: family } : { loadSystemFonts: true, defaultFontFamily: family };
  const attrs = `font-family="${esc(family)}" font-size="${st.size}" font-weight="${st.weight}" letter-spacing="${st.size * st.tracking}"`;
  const width = (s: string) => new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(spec.maxW * 3)}" height="${st.size * 2}"><text x="0" y="${st.size * 1.4}" ${attrs}>${esc(s)}</text></svg>`, { font }).getBBox()?.width ?? 0;
  const lines: string[] = [];
  for (const para of spec.text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? line + " " + word : word;
      if (line && width(next) > spec.maxW) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  const lh = Math.round(st.size * 1.15), pad = Math.ceil(st.size * 0.3);
  const w = Math.ceil(Math.min(spec.maxW, Math.max(...lines.map(width))) + pad * 2 + st.size * st.tracking), h = lh * lines.length + pad * 2;
  const body = (fill: string, extra = "") => lines.map((l, i) => `<text x="${w / 2}" y="${pad + lh * i + st.size * 0.92}" text-anchor="middle" ${attrs} fill="${fill}"${extra}>${esc(l)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    (st.shadow ? `<filter id="s" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${st.size * 0.12}"/></filter><g filter="url(#s)" opacity="0.85">${body("#000000", ` stroke="#000000" stroke-width="${st.size * 0.08}"`)}</g>` : "") +
    body(st.color.slice(0, 7), st.color.length === 9 ? ` fill-opacity="${parseInt(st.color.slice(7), 16) / 255}"` : "") + "</svg>";
  const r = new Resvg(svg, { font }).render();
  const img = { w: r.width, h: r.height, data: new Uint8Array(r.pixels) };
  cache.set(key, img);
  return img;
}

// ---------------------------------------------------------------- frames, one at a time

/** Random-access sources for previews: each frame is one ffmpeg seek (stills decode once). */
export class FrameSource implements Sources {
  private frames = new Map<string, Img>();
  private texts = new Map<string, Img>();
  private tl: Timeline;
  private probes: Map<string, Probe>;
  constructor(tl: Timeline, probes: Map<string, Probe>) {
    this.tl = tl;
    this.probes = probes;
  }

  shot(c: Clip, u: number): Img {
    const d = c.def as ShotDef, p = this.probes.get(d.src)!;
    const [w, h] = decodeSize(d, p, this.tl.def.w, this.tl.def.h);
    const t = sourceTime(d, p, u);
    const key = `${d.src}|${d.pixel}|${w}x${h}|${p.dur === undefined ? "still" : Math.round(t * 1000)}`;
    let im = this.frames.get(key);
    if (!im) {
      const data = run([...(p.dur === undefined ? [] : ["-ss", t.toFixed(4)]), "-i", d.src, "-frames:v", "1", "-vf", scaleFilter(d, w, h), "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], "decoding a frame");
      if (data.length < w * h * 4) throw new ReelError(`could not decode a frame of '${base(d.src)}' at ${t.toFixed(2)}s`, d.loc);
      im = { w, h, data: new Uint8Array(data.buffer, data.byteOffset, w * h * 4) };
      if (this.frames.size > 48) this.frames.delete(this.frames.keys().next().value!);
      this.frames.set(key, im);
    }
    return im;
  }

  text(spec: TextSpec): Img {
    return textImage(spec, this.texts);
  }
}

// ---------------------------------------------------------------- frames, as a stream

/** Sequential frames of one shot at the output frame rate, decoded by a single ffmpeg. */
export class ShotStream {
  private proc: ChildProcess;
  private buf: Buffer[] = [];
  private have = 0;
  private queue: Img[] = [];
  private last?: Img;
  private ended = false;
  private wake?: () => void;
  private err = "";
  readonly size: number;

  constructor(d: ShotDef, p: Probe, u0: number, len: number, fps: number, w: number, h: number) {
    this.size = w * h * 4;
    const seek = p.dur === undefined ? [] : ["-ss", sourceTime(d, p, u0).toFixed(4)];
    const args = ["-v", "error", ...(p.loop ? ["-stream_loop", "-1"] : p.dur === undefined ? ["-loop", "1"] : []), ...seek, "-i", d.src, "-an",
      "-vf", `setpts=(PTS-STARTPTS)/${d.speed},fps=${fps},${scaleFilter(d, w, h)}`, "-t", len.toFixed(4), "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"];
    this.proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    this.proc.stderr!.on("data", (b: Buffer) => { this.err += b; });
    this.proc.stdout!.on("data", (b: Buffer) => {
      this.buf.push(b); this.have += b.length;
      while (this.have >= this.size) {
        const all = Buffer.concat(this.buf);
        this.queue.push({ w, h, data: new Uint8Array(all.subarray(0, this.size)) });
        this.buf = [all.subarray(this.size)]; this.have -= this.size;
      }
      if (this.queue.length > 6) this.proc.stdout!.pause();
      this.wake?.();
    });
    this.proc.on("close", () => { this.ended = true; this.wake?.(); });
    this.proc.on("error", () => { this.err ||= "ffmpeg not found on PATH"; this.ended = true; this.wake?.(); });
  }

  /** The next frame; after the source runs out, the last one again. */
  async next(): Promise<Img> {
    while (!this.queue.length && !this.ended) await new Promise<void>((r) => { this.wake = r; });
    this.wake = undefined;
    const f = this.queue.shift();
    if (this.queue.length <= 2) this.proc.stdout!.resume();
    if (f) return (this.last = f);
    if (this.last) return this.last;
    throw new ReelError(`could not decode frames: ${this.err.trim() || "no frames"}`);
  }

  close(): void {
    if (!this.ended) this.proc.kill("SIGKILL");
  }
}

