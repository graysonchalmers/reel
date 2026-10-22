// Music the agent can read without hearing it: a loudness curve, the strongest hits (onsets) and a
// tempo estimate, all in trailer time (music.from already subtracted).
import { spawnSync, } from "node:child_process";
import { statSync } from "node:fs";
import { ReelError } from "../core/errors.ts";
import type { TrailerDef } from "../core/project.ts";

export interface MusicInfo {
  /** Seconds per point of `db`. */
  hop: number;
  /** Loudness per hop, dBFS (RMS). */
  db: number[];
  /** Strongest onsets, trailer seconds, by strength. */
  hits: { t: number; strength: number }[];
  /** Tempo estimate from the onset envelope. */
  bpm?: number;
}

const SR = 11025, HOP = 256;
const cache = new Map<string, MusicInfo>();

export function analyzeMusic(m: NonNullable<TrailerDef["music"]>, dur: number): MusicInfo {
  const key = `${m.src}|${statSync(m.src).mtimeMs}|${m.from}|${dur}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(m.from), "-t", dur.toFixed(3), "-i", m.src, "-ac", "1", "-ar", String(SR), "-f", "f32le", "pipe:1"], { maxBuffer: 1 << 30 });
  if (r.error || r.status !== 0) throw new ReelError(`could not decode music '${m.src}': ${String(r.stderr ?? r.error).trim()}`);
  const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 2);
  const n = Math.floor(x.length / HOP), rms = new Float64Array(n), db: number[] = [];
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let k = i * HOP; k < (i + 1) * HOP; k++) e += x[k] * x[k];
    rms[i] = Math.sqrt(e / HOP);
    db.push(Math.round(20 * Math.log10(rms[i] + 1e-9) * 10) / 10);
  }
  // Onset strength: rise in log energy over a short window.
  const le = Array.from(rms, (v) => Math.log(v + 1e-4));
  const flux = le.map((v, i) => (i < 2 ? 0 : Math.max(0, v - Math.max(le[i - 1], le[i - 2]))));
  const mean = flux.reduce((a, b) => a + b, 0) / (n || 1);
  const sd = Math.sqrt(flux.reduce((a, b) => a + (b - mean) ** 2, 0) / (n || 1));
  const gap = Math.round((0.2 * SR) / HOP), hop = HOP / SR;
  const peaks: { t: number; strength: number }[] = [];
  for (let i = 2; i < n - 1; i++) {
    if (flux[i] < mean + 1.5 * sd) continue;
    let best = true;
    for (let k = Math.max(0, i - gap); k <= Math.min(n - 1, i + gap); k++) if (flux[k] > flux[i]) { best = false; break; }
    if (best) peaks.push({ t: Math.round(i * hop * 1000) / 1000, strength: Math.round(((flux[i] - mean) / (sd || 1)) * 10) / 10 });
  }
  peaks.sort((a, b) => b.strength - a.strength);
  // Tempo: autocorrelation of the onset envelope (smoothed, so one-hop spikes still overlap at
  // fractional lags) over 60..180 bpm, gently favouring ~110.
  const sm = flux.map((_, i) => { let a = 0; for (let k = -2; k <= 2; k++) a += (flux[i + k] ?? 0) * (3 - Math.abs(k)); return a; });
  // Raw autocorrelation per candidate tempo; the prior only picks between peaks (octave errors),
  // the reported tempo is the peak itself.
  const cands: number[] = [], score: number[] = [];
  const ac = (lag: number) => {
    const l0 = Math.floor(lag), f = lag - l0;
    let s = 0;
    for (let i = 0; i + l0 + 1 < n; i++) s += sm[i] * (sm[i + l0] * (1 - f) + sm[i + l0 + 1] * f);
    return s / Math.max(1, n - l0 - 1);
  };
  // A comb over four periods: one hop is ~2% of a beat, four periods resolve the tempo 4x finer.
  for (let b = 60; b <= 180; b += 0.25) {
    const lag = (60 / b) / hop;
    let s = 0;
    for (let k = 1; k <= 4 && k * lag < n - 2; k++) s += ac(k * lag);
    cands.push(b); score.push(s);
  }
  let bpm: number | undefined, best = 0;
  for (let i = 1; i < score.length - 1; i++) {
    if (score[i] < score[i - 1] || score[i] < score[i + 1]) continue;
    const w = score[i] * Math.exp(-0.5 * (Math.log2(cands[i] / 110) / 1.2) ** 2);
    if (w > best) { best = w; bpm = Math.round(cands[i] * 2) / 2; }
  }
  const info: MusicInfo = { hop, db, hits: peaks.slice(0, 24), bpm };
  cache.set(key, info);
  return info;
}

/** Mean loudness (dB) and the strongest hit inside [t0, t1). */
export function musicIn(mi: MusicInfo, t0: number, t1: number): { db: number; hit?: number } {
  const a = Math.floor(t0 / mi.hop), z = Math.max(a + 1, Math.floor(t1 / mi.hop));
  let e = 0, k = 0;
  for (let i = a; i < z && i < mi.db.length; i++, k++) e += 10 ** (mi.db[i] / 10);
  return { db: k ? Math.round(10 * Math.log10(e / k + 1e-12)) : -120, hit: mi.hits.find((h) => h.t >= t0 && h.t < t1)?.t };
}
