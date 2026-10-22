// What the agent reads instead of watching: a text report (clip times, beat alignment, music
// loudness and hits, warnings) and a contact sheet PNG (a frame from every clip over a timeline
// strip with the beat grid, the music's loudness curve and its strongest hits).
import { deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
import { type Img, frameAt, scaled } from "../core/compose.ts";
import { png } from "../core/png.ts";
import type { Clip, Timeline } from "../core/project.ts";
import { FrameSource, inspect } from "./media.ts";
import { type MusicInfo, analyzeMusic, musicIn } from "./music.ts";

export interface Report {
  text: string;
  warnings: string[];
  music?: MusicInfo;
}

const f2 = (v: number) => v.toFixed(2);
const base = (p: string) => p.replace(/^.*[\\/]/, "");

/** Seconds from t to the nearest beat (signed), or undefined without a bpm. */
export function beatOffset(tl: Timeline, t: number): { beat: number; off: number } | undefined {
  if (!tl.def.bpm) return undefined;
  const spb = 60 / tl.def.bpm, b = Math.round((t - tl.def.beat0) / spb);
  return { beat: b + 1, off: t - (tl.def.beat0 + b * spb) };
}

export function clipText(c: Clip): string {
  const d = c.def;
  if (d.kind === "title") return `title ${JSON.stringify(d.text.replace(/\n/g, " / "))}`;
  return `shot ${base(d.src)} @${f2(d.from)}s${d.speed !== 1 ? ` x${d.speed}` : ""}${d.move.zoom[0] !== d.move.zoom[1] ? ` zoom ${d.move.zoom.map((z) => +z.toFixed(2)).join("→")}` : ""}${d.caption ? ` "${d.caption.text}"` : ""}`;
}

export function report(tl: Timeline): Report {
  const { warnings } = inspect(tl);
  const d = tl.def, mi = d.music ? analyzeMusic(d.music, tl.dur) : undefined;
  const lines = [`trailer ${d.name} ${d.w}x${d.h} ${d.fps}fps ${f2(tl.dur)}s, ${tl.clips.length} clips` +
    (d.bpm ? `, ${d.bpm} bpm` : "") + (mi?.bpm ? ` (music sounds like ~${mi.bpm} bpm)` : "") + (d.music ? `, music ${base(d.music.src)} from ${d.music.from}s` : ", no music")];
  lines.push(`  #   start   dur  ${d.bpm ? "beat  cut-off " : ""}in          ${mi ? "music  hit    " : ""}clip`);
  let offBeat = 0;
  for (const c of tl.clips) {
    const b = beatOffset(tl, c.start), tr = c.def.in.type === "cut" ? "cut" : `${c.def.in.type} ${c.def.in.dur}`;
    if (b && Math.abs(b.off) > 0.5 / d.fps + 1e-6) offBeat++;
    const m = mi && musicIn(mi, c.start, c.start + c.dur);
    lines.push(`  ${String(c.i + 1).padStart(2)} ${f2(c.start).padStart(7)} ${f2(c.dur).padStart(5)}  ` +
      (b ? `${String(b.beat).padStart(4)} ${(b.off >= 0 ? "+" : "") + Math.round(b.off * 1000) + "ms"}`.padEnd(14) + " " : "") +
      tr.padEnd(11) + " " + (m ? `${(m.db + "dB").padStart(5)}  ${m.hit !== undefined ? f2(m.hit) : "-"}`.padEnd(14) + " " : "") +
      clipText(c) + (c.def.loc ? `  (${c.def.loc})` : ""));
  }
  if (d.bpm) lines.push(offBeat ? `${offBeat} cut(s) off the beat grid by more than half a frame` : "every cut lands on a beat");
  if (mi) lines.push(`music hits (strongest first, trailer s): ${mi.hits.slice(0, 12).map((h) => f2(h.t)).join(" ")}`);
  for (const w of warnings) lines.push("warning: " + w);
  return { text: lines.join("\n"), warnings, music: mi };
}

// ---------------------------------------------------------------- contact sheet

const toPng = (im: Img) => Buffer.from(png(im.w, im.h, im.data, (b) => deflateSync(b))).toString("base64");

/** The frame a clip is judged by: its middle, or just after its transition if that is later. */
export const thumbTime = (c: Clip) => c.start + Math.max(c.def.in.dur, c.dur / 2);

export function contactSheet(full: Timeline, mi?: MusicInfo): Buffer {
  const TW = 360, cols = 4, k = TW / full.def.w, tl = scaled(full, k);
  const src = new FrameSource(tl, inspect(tl).probes);
  const TH = tl.def.h, cellH = TH + 34, pad = 12, W = cols * (TW + pad) + pad;
  const rows = Math.ceil(tl.clips.length / cols), gridH = rows * (cellH + pad) + pad;
  const stripY = gridH + 30, stripH = 120, H = stripY + stripH + 46;
  const x = (t: number) => pad + (t / tl.dur) * (W - pad * 2);
  const e = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#14131b"/>` +
    `<g font-family="monospace" font-size="12">`;
  for (const c of tl.clips) {
    const cx = pad + (c.i % cols) * (TW + pad), cy = pad + Math.floor(c.i / cols) * (cellH + pad), t = thumbTime(c);
    svg += `<image x="${cx}" y="${cy}" width="${TW}" height="${TH}" href="data:image/png;base64,${toPng(frameAt(tl, t, src))}"/>` +
      `<rect x="${cx}" y="${cy}" width="${TW}" height="${TH}" fill="none" stroke="#322d40"/>` +
      `<text x="${cx}" y="${cy + TH + 14}" fill="#ffb454">#${c.i + 1}  ${f2(c.start)}–${f2(c.start + c.dur)}s  @${f2(t)}s  ${c.def.in.type !== "cut" ? c.def.in.type : ""}</text>` +
      `<text x="${cx}" y="${cy + TH + 28}" fill="#9a93ab">${e(clipText(c).slice(0, 48))}</text>`;
  }
  // Timeline strip: clip blocks, beat grid, loudness, hits.
  svg += `<text x="${pad}" y="${stripY - 10}" fill="#e8e4f0">${e(`${tl.def.name}  ${f2(tl.dur)}s  ${tl.def.bpm ? tl.def.bpm + " bpm" : ""}`)}  <tspan fill="#9a93ab">clips · beats · music loudness · ▲ hits</tspan></text>`;
  svg += `<rect x="${pad}" y="${stripY}" width="${W - pad * 2}" height="${stripH}" fill="#1c1a26"/>`;
  for (const c of tl.clips) {
    const x0 = x(c.start), x1 = x(c.start + c.dur);
    svg += `<rect x="${x0}" y="${stripY}" width="${Math.max(1, x1 - x0 - 1)}" height="26" fill="${c.def.kind === "title" ? "#4a3a6a" : "#2d4a5a"}"/>` +
      `<text x="${x0 + 3}" y="${stripY + 17}" fill="#e8e4f0">${c.i + 1}</text>`;
    if (c.def.in.dur > 0) svg += `<rect x="${x0}" y="${stripY + 26}" width="${x(c.start + c.def.in.dur) - x0}" height="4" fill="#ffb454"/>`;
  }
  const bt = full.def.bpm ? 60 / full.def.bpm : 0;
  if (bt) for (let t = full.def.beat0, b = 0; t <= tl.dur; t += bt, b++)
    svg += `<line x1="${x(t)}" y1="${stripY + 30}" x2="${x(t)}" y2="${stripY + stripH}" stroke="#ffffff" stroke-opacity="${b % 4 === 0 ? 0.35 : 0.12}"/>`;
  if (mi) {
    const y = (db: number) => stripY + stripH - 4 - Math.max(0, Math.min(1, (db + 60) / 60)) * (stripH - 40);
    const step = Math.max(1, Math.floor(mi.db.length / 800));
    let pts = "";
    for (let i = 0; i < mi.db.length; i += step) pts += `${x(i * mi.hop).toFixed(1)},${y(mi.db[i]).toFixed(1)} `;
    svg += `<polyline points="${pts}" fill="none" stroke="#7bd88f" stroke-width="1.5"/>`;
    for (const h of mi.hits.slice(0, 12)) svg += `<path d="M${x(h.t) - 5},${stripY + stripH + 12} l5,-9 l5,9 z" fill="#ff6b7a"/>`;
  }
  for (let t = 0; t <= tl.dur; t += tl.dur > 40 ? 10 : 5) svg += `<text x="${x(t)}" y="${stripY + stripH + 30}" fill="#9a93ab" text-anchor="middle">${t}s</text>`;
  svg += "</g></svg>";
  return new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng();
}
