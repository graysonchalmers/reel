// Project: the registry a trailer file fills in (the DSL), and the timeline resolver that turns
// a trailer's clips into frame-exact start times. Pure: no file system, no ffmpeg.
import { ReelError, didYouMean, wrap } from "./errors.ts";

export type Ease = "linear" | "in" | "out" | "inOut";
export type TransType = "cut" | "fade" | "dip" | "flash" | "wipe";

export interface Trans { __trans: true; type: TransType; dur: number; color: string }
export interface Sfx { __sfx: true; src: string; at: number; vol: number; loc?: string }
export interface Move { zoom: [number, number]; x: [number, number]; y: [number, number]; ease: Ease }
export interface TextStyle { size: number; font: string; weight: number; color: string; tracking: number; pos: "center" | "bottom" | "top"; shadow: boolean }

interface ClipBase { label: string; loc?: string; dur: number | undefined; beats: number | undefined; in: Trans; sfx: Sfx[] }
export interface ShotDef extends ClipBase {
  kind: "shot";
  src: string;
  /** Source seconds where the shot starts. */
  from: number;
  speed: number;
  fit: "cover" | "contain";
  pixel: boolean;
  bg: string;
  move: Move;
  /** Volume of the source's own audio (0 = muted). */
  audio: number;
  caption?: { text: string; style: TextStyle };
}
export interface TitleDef extends ClipBase {
  kind: "title";
  text: string;
  sub?: string;
  style: TextStyle;
  bg: string;
  anim: "push" | "punch" | "none";
}
export type ClipDef = ShotDef | TitleDef;

export interface TrailerDef {
  name: string;
  loc?: string;
  w: number;
  h: number;
  fps: number;
  bpm?: number;
  /** Seconds into the trailer of the first beat. */
  beat0: number;
  music?: { src: string; from: number; vol: number; fadeOut: number };
  /** Cinematic bars: target aspect ratio (2.39) or undefined. */
  letterbox?: number;
  fadeIn: number;
  fadeOut: number;
  clips: ClipDef[];
}

export interface Clip { i: number; def: ClipDef; start: number; dur: number; frames: number }
export interface Timeline { def: TrailerDef; clips: Clip[]; dur: number; frames: number; beats: number[] }

const TRAILER_OPTS = ["w", "h", "fps", "bpm", "beat0", "music", "letterbox", "fadeIn", "fadeOut"];
const MUSIC_OPTS = ["src", "from", "vol", "fadeOut"];
const CLIP_OPTS = ["dur", "beats", "in", "sfx"];
const SHOT_OPTS = [...CLIP_OPTS, "from", "speed", "fit", "pixel", "bg", "move", "audio", "caption"];
const TITLE_OPTS = [...CLIP_OPTS, "sub", "size", "font", "weight", "color", "tracking", "pos", "shadow", "bg", "anim"];
const MOVE_OPTS = ["zoom", "x", "y", "ease"];
const TEXT_OPTS = ["text", "size", "font", "weight", "color", "tracking", "pos", "shadow"];
const EASES: Ease[] = ["linear", "in", "out", "inOut"];
const TRANS: TransType[] = ["cut", "fade", "dip", "flash", "wipe"];

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTrans = (v: unknown): v is Trans => isPlain(v) && v.__trans === true;
const isSfx = (v: unknown): v is Sfx => isPlain(v) && v.__sfx === true;

function checkKeys(what: string, obj: object, allowed: string[]): void {
  for (const k of Object.keys(obj))
    if (!allowed.includes(k)) throw new ReelError(`${what}: unknown option '${k}'${didYouMean(k, allowed)}`);
}
function num(what: string, v: unknown, min = -Infinity, max = Infinity): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ReelError(`${what} must be a number, got ${JSON.stringify(v)}`);
  if (v < min || v > max) throw new ReelError(`${what} must be in ${min}..${max}, got ${v}`);
  return v;
}
function str(what: string, v: unknown): string {
  if (typeof v !== "string" || !v) throw new ReelError(`${what} must be a non-empty string`);
  return v;
}
function color(what: string, v: unknown): string {
  if (typeof v !== "string" || !/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) throw new ReelError(`${what} must be a hex color like "#ff8800", got ${JSON.stringify(v)}`);
  return v.toLowerCase();
}
/** A number, or [from, to]. */
function range(what: string, v: unknown, min: number, max: number): [number, number] {
  if (Array.isArray(v) && v.length === 2) return [num(what + "[0]", v[0], min, max), num(what + "[1]", v[1], min, max)];
  const n = num(what, v, min, max);
  return [n, n];
}
function oneOf<T extends string>(what: string, v: unknown, all: readonly T[]): T {
  if (!all.includes(v as T)) throw new ReelError(`${what} must be one of ${all.map((s) => `"${s}"`).join(", ")}, got ${JSON.stringify(v)}${typeof v === "string" ? didYouMean(v, all) : ""}`);
  return v as T;
}

function trans(v: unknown): Trans {
  if (v === undefined) return { __trans: true, type: "cut", dur: 0, color: "#000000" };
  if (typeof v === "string") return makeTrans(oneOf("in", v, TRANS));
  if (isTrans(v)) return v;
  throw new ReelError(`in: use a transition like "fade" or fade(0.5), dip(0.4, "#000"), flash(0.15), wipe(0.4)`);
}
function makeTrans(type: TransType, dur?: unknown, c?: unknown): Trans {
  const def = { cut: 0, fade: 0.5, dip: 0.6, flash: 0.25, wipe: 0.4 }[type];
  return { __trans: true, type, dur: type === "cut" ? 0 : dur === undefined ? def : num(`${type}() duration`, dur, 0.01, 10), color: color(`${type}() color`, c ?? (type === "flash" ? "#ffffff" : "#000000")) };
}

function textStyle(what: string, o: Record<string, unknown>, d: Partial<TextStyle>): TextStyle {
  return {
    size: o.size === undefined ? d.size ?? 64 : num(`${what} size`, o.size, 4, 2000),
    font: o.font === undefined ? "Noto Sans" : str(`${what} font`, o.font),
    weight: o.weight === undefined ? d.weight ?? 900 : num(`${what} weight`, o.weight, 100, 1000),
    color: o.color === undefined ? "#ffffff" : color(`${what} color`, o.color),
    tracking: o.tracking === undefined ? d.tracking ?? 0.08 : num(`${what} tracking`, o.tracking, -0.5, 2),
    pos: o.pos === undefined ? d.pos ?? "center" : oneOf(`${what} pos`, o.pos, ["center", "bottom", "top"] as const),
    shadow: o.shadow === undefined ? d.shadow ?? false : Boolean(o.shadow),
  };
}

export class Project {
  trailers = new Map<string, TrailerDef>();
  order: string[] = [];
  files: string[] = [];
  includeHook?: (path: string) => void;
  /** Resolves a media path relative to the file currently being run. */
  pathHook: (path: string) => string = (p) => p;

  addFile(file: string): void {
    if (!this.files.includes(file)) this.files.push(file);
  }

  locFromStack(stack: string): string | undefined {
    for (const line of stack.split("\n")) {
      for (const f of this.files) {
        const i = line.indexOf(f + ":");
        if (i < 0) continue;
        const m = /^:(\d+):(\d+)/.exec(line.slice(i + f.length));
        if (m) return `${f.replace(/^.*[\\/]/, "")}:${m[1]}:${m[2]}`;
      }
    }
    return undefined;
  }

  /** Where the DSL was called from: the outermost line in a trailer file, so a clip made by a
   *  helper function points at the line that used the helper, not at the helper. */
  callerLoc(): string | undefined {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 60;
    const stack = new Error().stack ?? "";
    Error.stackTraceLimit = limit;
    let loc: string | undefined;
    for (const line of stack.split("\n")) loc = this.locFromStack(line) ?? loc;
    return loc;
  }

  // ---------------------------------------------------------------- DSL

  env(): Record<string, unknown> {
    const env: Record<string, unknown> = {};
    const at = <T>(what: string, fn: (loc?: string) => T): T => {
      const loc = this.callerLoc();
      try { return fn(loc); } catch (e) { throw wrap(e).within(what, loc); }
    };
    // A font is a family name (fontconfig) or a .ttf/.otf file next to the trailer.
    const withFont = (st: TextStyle): TextStyle => (/\.(ttf|otf)$/i.test(st.font) ? { ...st, font: this.pathHook(st.font) } : st);
    const clipBase = (o: Record<string, unknown>, label: string, loc?: string): ClipBase => {
      if (o.dur !== undefined && o.beats !== undefined) throw new ReelError("give dur (seconds) or beats, not both");
      const sfx = o.sfx === undefined ? [] : (Array.isArray(o.sfx) ? o.sfx : [o.sfx]).map((s) => {
        if (typeof s === "string") return { __sfx: true as const, src: this.pathHook(s), at: 0, vol: 1, loc };
        if (isSfx(s)) return s;
        throw new ReelError(`sfx: use a path or sfx("hit.wav", { at: 0.2, vol: 0.8 })`);
      });
      return {
        label, loc, in: trans(o.in), sfx,
        dur: o.dur === undefined ? undefined : num("dur", o.dur, 1e-3, 3600),
        beats: o.beats === undefined ? undefined : num("beats", o.beats, 0.125, 10000),
      };
    };

    env.trailer = (name: unknown, o: unknown, ...items: unknown[]) => at(`trailer '${String(name)}'`, (loc) => {
      if (typeof name !== "string" || !/^[\w.-]+$/.test(name)) throw new ReelError(`trailer name must be a simple file name, got ${JSON.stringify(name)}`);
      if (this.trailers.has(name)) throw new ReelError(`trailer '${name}' is already defined at ${this.trailers.get(name)!.loc}`);
      if (!isPlain(o)) throw new ReelError(`trailer("${name}", { w, h, fps, bpm, music }, ...clips)`);
      checkKeys("trailer", o, TRAILER_OPTS);
      const clips = items.flat(Infinity) as unknown[];
      if (!clips.length) throw new ReelError("a trailer needs at least one shot() or title()");
      for (const [i, c] of clips.entries())
        if (!isPlain(c) || (c.kind !== "shot" && c.kind !== "title")) throw new ReelError(`clip ${i + 1} is not a shot() or title()`);
      let music: TrailerDef["music"];
      if (o.music !== undefined) {
        const m = typeof o.music === "string" ? { src: o.music } : o.music;
        if (!isPlain(m)) throw new ReelError(`music: a path or { src, from, vol, fadeOut }`);
        checkKeys("music", m, MUSIC_OPTS);
        music = { src: this.pathHook(str("music src", m.src)), from: m.from === undefined ? 0 : num("music from", m.from, 0), vol: m.vol === undefined ? 1 : num("music vol", m.vol, 0, 4), fadeOut: m.fadeOut === undefined ? 1.5 : num("music fadeOut", m.fadeOut, 0, 60) };
      }
      const def: TrailerDef = {
        name, loc,
        w: o.w === undefined ? 1920 : num("w", o.w, 16, 7680),
        h: o.h === undefined ? 1080 : num("h", o.h, 16, 7680),
        fps: o.fps === undefined ? 30 : num("fps", o.fps, 1, 120),
        bpm: o.bpm === undefined ? undefined : num("bpm", o.bpm, 20, 400),
        beat0: o.beat0 === undefined ? 0 : num("beat0", o.beat0, 0),
        music,
        letterbox: o.letterbox === undefined ? undefined : num("letterbox", o.letterbox, 0.2, 5),
        fadeIn: o.fadeIn === undefined ? 0 : num("fadeIn", o.fadeIn, 0, 30),
        fadeOut: o.fadeOut === undefined ? 0 : num("fadeOut", o.fadeOut, 0, 30),
        clips: clips as ClipDef[],
      };
      if (def.w % 2 || def.h % 2) throw new ReelError(`w and h must be even (H.264), got ${def.w}x${def.h}`);
      this.trailers.set(name, def);
      this.order.push(name);
    });

    env.shot = (src: unknown, o: unknown = {}): ShotDef => at("shot", (loc) => {
      if (!isPlain(o)) throw new ReelError(`shot("clip.mp4", { dur | beats, from, move, in, ... })`);
      checkKeys("shot", o, SHOT_OPTS);
      const path = this.pathHook(str("shot source", src));
      let move: Move = { zoom: [1, 1], x: [0.5, 0.5], y: [0.5, 0.5], ease: "inOut" };
      if (o.move !== undefined) {
        if (!isPlain(o.move)) throw new ReelError(`move: { zoom: [1, 1.2], x: [0.4, 0.6], y: 0.5, ease: "inOut" }`);
        checkKeys("move", o.move, MOVE_OPTS);
        const m = o.move;
        move = {
          zoom: m.zoom === undefined ? move.zoom : range("move zoom", m.zoom, 0.05, 50),
          x: m.x === undefined ? move.x : range("move x", m.x, 0, 1),
          y: m.y === undefined ? move.y : range("move y", m.y, 0, 1),
          ease: m.ease === undefined ? "inOut" : oneOf("move ease", m.ease, EASES),
        };
      }
      let caption: ShotDef["caption"];
      if (o.caption !== undefined) {
        const c = typeof o.caption === "string" ? { text: o.caption } : o.caption;
        if (!isPlain(c)) throw new ReelError(`caption: a string or { text, size, pos, ... }`);
        checkKeys("caption", c, TEXT_OPTS);
        caption = { text: str("caption text", c.text), style: withFont(textStyle("caption", c, { size: 44, weight: 700, tracking: 0.04, pos: "bottom", shadow: true })) };
      }
      return {
        kind: "shot", ...clipBase(o, `shot ${src}`, loc), src: path,
        from: o.from === undefined ? 0 : num("from", o.from, 0),
        speed: o.speed === undefined ? 1 : num("speed", o.speed, 0.05, 20),
        fit: o.fit === undefined ? "cover" : oneOf("fit", o.fit, ["cover", "contain"] as const),
        pixel: Boolean(o.pixel),
        bg: o.bg === undefined ? "#000000" : color("bg", o.bg),
        move, caption,
        audio: o.audio === undefined ? 0 : o.audio === true ? 1 : num("audio", o.audio, 0, 4),
      };
    });

    env.title = (text: unknown, o: unknown = {}): TitleDef => at("title", (loc) => {
      if (!isPlain(o)) throw new ReelError(`title("TEXT", { dur | beats, sub, size, color, in, ... })`);
      checkKeys("title", o, TITLE_OPTS);
      const t = str("title text", text);
      return {
        kind: "title", ...clipBase(o, `title ${JSON.stringify(t.length > 24 ? t.slice(0, 23) + "…" : t)}`, loc), text: t,
        sub: o.sub === undefined ? undefined : str("sub", o.sub),
        style: withFont(textStyle("title", o, {})),
        bg: o.bg === undefined ? "#000000" : color("bg", o.bg),
        anim: o.anim === undefined ? "push" : oneOf("anim", o.anim, ["push", "punch", "none"] as const),
      };
    });

    for (const type of TRANS) env[type] = (dur?: unknown, c?: unknown) => at(`${type}()`, () => makeTrans(type, dur, c));
    env.sfx = (src: unknown, o: unknown = {}): Sfx => at("sfx", (loc) => {
      if (!isPlain(o)) throw new ReelError(`sfx("hit.wav", { at: 0.2, vol: 0.8 })`);
      checkKeys("sfx", o, ["at", "vol"]);
      return { __sfx: true, src: this.pathHook(str("sfx source", src)), at: o.at === undefined ? 0 : num("sfx at", o.at, 0), vol: o.vol === undefined ? 1 : num("sfx vol", o.vol, 0, 4), loc };
    });
    env.include = (path: unknown) => {
      if (typeof path !== "string") throw new ReelError('include("other.rx.js")', this.callerLoc());
      if (!this.includeHook) throw new ReelError("include() is not available here", this.callerLoc());
      this.includeHook(path);
    };
    return env;
  }

  // ---------------------------------------------------------------- timeline

  trailer(name: string): TrailerDef {
    const d = this.trailers.get(name);
    if (!d) throw new ReelError(`unknown trailer '${name}'${didYouMean(name, this.order)}`);
    return d;
  }

  /** Frame-exact start times. Clips are back to back; a transition plays over the incoming clip's first `in.dur` seconds. */
  timeline(name: string): Timeline {
    const def = this.trailer(name);
    const clips: Clip[] = [];
    let frame = 0, exact = 0;   // cuts round the exact running time, so they never drift off the beat
    for (const [i, c] of def.clips.entries()) {
      try {
        let sec: number;
        if (c.beats !== undefined) {
          if (!def.bpm) throw new ReelError(`beats: ${c.beats} needs the trailer's bpm`);
          sec = (c.beats * 60) / def.bpm;
        } else sec = c.dur ?? (c.kind === "title" ? 2 : 3);
        exact += sec;
        const end = Math.round(exact * def.fps);
        const frames = Math.max(1, end - frame);
        if (c.in.type !== "cut" && i === 0 && c.in.type !== "flash" && c.in.type !== "dip") throw new ReelError(`the first clip can't ${c.in.type} in from nothing; use the trailer's fadeIn or dip()`);
        if (c.in.dur * def.fps > frames) throw new ReelError(`the ${c.in.type} (${c.in.dur}s) is longer than the clip (${(frames / def.fps).toFixed(2)}s)`);
        clips.push({ i, def: c, start: frame / def.fps, dur: frames / def.fps, frames });
        frame += frames;
      } catch (e) {
        throw wrap(e).within(`clip ${i + 1} (${c.label})`, c.loc).within(`trailer '${name}'`, def.loc);
      }
    }
    const dur = frame / def.fps;
    const beats: number[] = [];
    if (def.bpm) for (let k = 0, spb = 60 / def.bpm; def.beat0 + k * spb <= dur + 1e-6; k++) beats.push(Math.round((def.beat0 + k * spb) * 1e6) / 1e6);
    return { def, clips, dur, frames: frame, beats };
  }
}

export function ease(e: Ease, p: number): number {
  p = Math.max(0, Math.min(1, p));
  return e === "linear" ? p : e === "in" ? p * p : e === "out" ? 1 - (1 - p) ** 2 : p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
}
