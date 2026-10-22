// Feedback from the live viewer: notes pinned to a moment (or a span) of a trailer, written next to
// the outputs with what an agent needs to find the cause: the clip on screen, its source line,
// the clip-local time, the beat, and the exact frame as a PNG.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { clipAt, frameAt, scaled } from "../core/compose.ts";
import { png } from "../core/png.ts";
import type { Project } from "../core/project.ts";
import { FrameSource, inspect } from "./media.ts";
import { beatOffset } from "./report.ts";

export class FeedbackError extends Error {}

const MAX_ITEMS = 100, MAX_TEXT = 4000;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Validate and write `<out>/_feedback/<name>.json` plus one frame PNG per note. */
export function writeFeedback(p: Project, out: string, body: unknown): { files: string[]; summary: string } {
  if (typeof body !== "object" || body === null) throw new FeedbackError("feedback must be a JSON object");
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" && p.trailers.has(b.name) ? b.name : undefined;
  if (!name) throw new FeedbackError(`unknown trailer ${JSON.stringify(b.name)}`);
  const tl = p.timeline(name), last = (tl.frames - 1) / tl.def.fps;
  const clamp = (t: number) => Math.max(0, Math.min(last, Math.floor(t * tl.def.fps + 1e-6) / tl.def.fps));
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, MAX_TEXT) : "");
  const notes = (Array.isArray(b.notes) ? b.notes : []).slice(0, MAX_ITEMS).flatMap((n) =>
    n && num(n.t) && typeof n.text === "string" ? [{ t: clamp(n.t), t1: num(n.t1) ? clamp(n.t1) : null, text: text(n.text) }] : []);
  const comment = text(b.comment);

  const dir = join(out, "_feedback");
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const small = scaled(tl, Math.min(1, 960 / tl.def.w)), src = new FrameSource(small, inspect(small).probes);
  const at = (t: number) => {
    const c = clipAt(tl, t), bo = beatOffset(tl, t);
    return { clip: { n: c.i + 1, label: c.def.label, loc: c.def.loc ?? null, start: r3(c.start), dur: r3(c.dur), u: r3(t - c.start) }, beat: bo ? { n: bo.beat, offMs: Math.round(bo.off * 1000) } : null };
  };
  const json = {
    trailer: name, dur: r3(tl.dur), fps: tl.def.fps, time: new Date().toISOString(), comment,
    notes: notes.map((n, i) => {
      const img = `${name}.n${i + 1}.png`, im = frameAt(small, n.t, src);
      const path = join(dir, img);
      writeFileSync(path, png(im.w, im.h, im.data, (d) => deflateSync(d)));
      files.push(path);
      return { n: i + 1, t: r3(n.t), t1: n.t1 === null ? null : r3(Math.max(n.t, n.t1)), text: n.text, ...at(n.t), image: img };
    }),
  };
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(json, null, 1) + "\n");
  files.unshift(path);
  return { files, summary: `${notes.length} note${notes.length === 1 ? "" : "s"}${comment ? ", a comment" : ""}` };
}
