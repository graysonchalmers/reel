// OpenTimelineIO bridge: a reel trailer <-> an .otio timeline (plain JSON, no Python needed).
// The .otio file is the master edit: Kdenlive/Shotcut (via OTIO adapters), the web editor and the
// agent all edit it. Standard OTIO fields carry what an NLE can change (order, names, trims, media,
// transitions); reel-only settings (moves, grades, titles, overlays) ride in metadata.reel.
// Pure: no file system.
import { ReelError } from "./errors.ts";
import { type ClipDef, type Timeline, type TrailerDef, type TransType, TRANS, makeTrans } from "./project.ts";

type J = Record<string, any>;
const rt = (value: number, rate: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate, value });
const range = (start: number, dur: number, rate: number) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(start, rate), duration: rt(dur, rate) });
const url = (p: string) => (/^[a-z]+:\/\//i.test(p) ? p : "file://" + encodeURI(p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1:")));
const unurl = (u: string) => (u.startsWith("file://") ? decodeURI(u.slice(7)).replace(/^\/([A-Za-z]:)/, "$1") : u);
const strip = <T extends J>(o: T, ...keys: string[]): J => { const c: J = { ...o }; for (const k of keys) delete c[k]; return c; };

const OTIO_TRANS: Record<string, string> = { fade: "SMPTE_Dissolve" };

/** A resolved timeline as an OTIO Timeline (JSON object). Clip lengths are the frame-exact resolved ones. */
export function toOtio(tl: Timeline): J {
  const { def } = tl, fps = def.fps;
  const items: J[] = [];
  for (const c of tl.clips) {
    const d = c.def;
    if (c.i > 0 && d.in.type !== "cut") {
      const half = Math.round((d.in.dur * fps) / 2);
      items.push({
        OTIO_SCHEMA: "Transition.1", name: d.in.type, transition_type: OTIO_TRANS[d.in.type] ?? "Custom_Transition",
        in_offset: rt(half, fps), out_offset: rt(half, fps), metadata: { reel: d.in },
      });
    }
    const reel = strip(d, "loc", "kind", "in");
    const base = { name: d.label, source_range: null as J | null, metadata: { reel: { kind: d.kind, ...reel, in: d.in } } };
    if (d.kind === "shot") {
      items.push({ OTIO_SCHEMA: "Clip.2", ...base,
        source_range: range(Math.round(d.from * fps), c.frames, fps),
        media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: "ExternalReference.1", target_url: url(d.src), available_range: null, metadata: {} } },
        active_media_reference_key: "DEFAULT_MEDIA" });
    } else {
      items.push({ OTIO_SCHEMA: "Clip.2", ...base, source_range: range(0, c.frames, fps),
        media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: "GeneratorReference.1", generator_kind: "reel.title", parameters: { text: d.text, sub: d.sub ?? null }, available_range: range(0, c.frames, fps), metadata: {} } },
        active_media_reference_key: "DEFAULT_MEDIA" });
    }
  }
  const tracks: J[] = [{ OTIO_SCHEMA: "Track.1", name: "V1", kind: "Video", children: items, metadata: {} }];
  if (def.music) {
    const m = def.music;
    tracks.push({ OTIO_SCHEMA: "Track.1", name: "A1", kind: "Audio", metadata: {}, children: [{
      OTIO_SCHEMA: "Clip.2", name: "music", metadata: { reel: { vol: m.vol, fadeOut: m.fadeOut } },
      source_range: range(Math.round(m.from * fps), tl.frames, fps),
      media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: "ExternalReference.1", target_url: url(m.src), available_range: null, metadata: {} } },
      active_media_reference_key: "DEFAULT_MEDIA" }] });
  }
  return {
    OTIO_SCHEMA: "Timeline.1", name: def.name, global_start_time: null,
    metadata: { reel: { version: 2, ...strip(def, "loc", "clips", "music", "name") } },
    tracks: { OTIO_SCHEMA: "Stack.1", name: "tracks", children: tracks, metadata: {} },
  };
}

/** An OTIO Timeline back into a reel trailer. Anything an NLE changed in the standard fields wins
 *  over metadata: clip order, names, trims (source start + duration), media paths, fade lengths.
 *  Clips with no reel metadata (added in Kdenlive) become plain shots. */
export function fromOtio(o: J, loc?: string): TrailerDef {
  if (o?.OTIO_SCHEMA?.split(".")[0] !== "Timeline") throw new ReelError("not an OTIO Timeline", loc);
  const meta: J = strip(o.metadata?.reel ?? {}, "version");
  const tracks: J[] = o.tracks?.children ?? [];
  const video = tracks.find((t) => t.kind === "Video");
  if (!video) throw new ReelError("OTIO timeline has no video track", loc);
  const fps: number = meta.fps ?? video.children.find((c: J) => c.source_range)?.source_range.duration.rate ?? 30;
  const secs = (t: J) => t.value / t.rate;
  const clips: ClipDef[] = [];
  let pending: J | undefined;
  for (const it of video.children as J[]) {
    const kind = it.OTIO_SCHEMA.split(".")[0];
    if (kind === "Transition") {
      const r = it.metadata?.reel;
      const dur = secs(it.in_offset) + secs(it.out_offset);
      pending = r ? { ...r, dur } : { __trans: true, type: "fade" as TransType, dur, color: "#000000", dir: "left" };
      continue;
    }
    if (kind === "Gap") { pending = undefined; continue; }
    if (kind !== "Clip") continue;
    const r: J = it.metadata?.reel ?? {};
    const ref = it.media_references?.[it.active_media_reference_key ?? "DEFAULT_MEDIA"] ?? it.media_reference ?? {};
    const sr = it.source_range;
    const dur = sr ? secs(sr.duration) : r.dur;
    const common = { label: it.name ?? r.label ?? "clip", loc, dur, beats: undefined, sfx: r.sfx ?? [], overlays: r.overlays ?? [], grade: r.grade,
      in: (pending ?? (clips.length === 0 ? r.in : undefined) ?? { __trans: true, type: "cut", dur: 0, color: "#000000", dir: "left" }) as any };
    pending = undefined;
    if (r.kind === "title" || ref.generator_kind === "reel.title") {
      clips.push({ ...strip(r, "kind", "in", "dur", "beats", "label"), kind: "title", ...common,
        text: ref.parameters?.text ?? r.text, sub: ref.parameters?.sub ?? r.sub ?? undefined,
        style: r.style ?? { size: 96, font: "sans-serif", weight: 800, color: "#ffffff", tracking: 0.05, pos: "center", shadow: true },
        bg: r.bg ?? "#000000", anim: r.anim ?? "push" } as ClipDef);
    } else {
      if (!ref.target_url) throw new ReelError(`OTIO clip '${it.name}' has no media`, loc);
      clips.push({ fit: "cover", pixel: false, bg: "#000000", speed: 1, audio: 0,
        move: { zoom: [1, 1], x: [0.5, 0.5], y: [0.5, 0.5], ease: "inOut" },
        ...strip(r, "kind", "in", "dur", "beats", "label", "from", "src"), kind: "shot", ...common,
        src: unurl(ref.target_url), from: sr ? secs(sr.start_time) : 0 } as ClipDef);
    }
  }
  if (!clips.length) throw new ReelError("OTIO timeline has no clips", loc);
  const audio = tracks.find((t) => t.kind === "Audio")?.children?.find((c: J) => c.OTIO_SCHEMA?.startsWith("Clip"));
  const aref = audio && (audio.media_references?.[audio.active_media_reference_key ?? "DEFAULT_MEDIA"] ?? audio.media_reference);
  return {
    w: 1920, h: 1080, beat0: 0, fadeIn: 0, fadeOut: 0, ...meta, fps, name: o.name, loc, clips,
    music: aref?.target_url ? { src: unurl(aref.target_url), from: audio.source_range ? secs(audio.source_range.start_time) : 0,
      vol: audio.metadata?.reel?.vol ?? 1, fadeOut: audio.metadata?.reel?.fadeOut ?? 1.5 } : undefined,
  } as TrailerDef;
}

/** Edits the viewer can make to the master .otio: reorder or delete a clip (1-based, as shown).
 *  A clip moves with the transition into it. The new first clip loses its incoming transition
 *  (nothing to blend from) unless it is one reel allows on the first clip. */
export type OtioEdit = { op: "move"; n: number; to: number } | { op: "delete"; n: number }
  /** Seconds: `from` = where in the source the clip starts (shots only), `dur` = clip length. */
  | { op: "trim"; n: number; from?: number; dur?: number }
  /** A new shot at position `at` (1-based; past the end appends). `src` is an absolute media path. */
  | { op: "insert"; at: number; src: string; from?: number; dur: number }
  /** A copy of clip `n` (with the transition into it) right after it. */
  | { op: "duplicate"; n: number }
  /** Cut clip `n` in two, `at` seconds into the clip. The second half starts with a cut. */
  | { op: "split"; n: number; at: number }
  /** A title's text, sub line (null removes it) and length in seconds. */
  | { op: "title"; n: number; text?: string; sub?: string | null; dur?: number }
  /** The transition into clip `n`; `dir` is for slide, `color` for dip/flash. */
  | { op: "trans"; n: number; type: TransType; dur?: number; dir?: string; color?: string }
  /** The trailer's music: a media file (absolute path) and volume, or `src: null` for none. */
  | { op: "music"; src?: string | null; vol?: number; from?: number }
  /** A corner badge over clip `n` (e.g. "10x"), or null to remove it. */
  | { op: "badge"; n: number; badge: string | null };
const FIRST_OK = ["cut", "flash", "dip", "slide", "zoom"];
export function editOtio(o: J, e: OtioEdit): J {
  const out = structuredClone(o);
  const video = out.tracks?.children?.find((t: J) => t.kind === "Video");
  if (!video) throw new ReelError("OTIO timeline has no video track");
  const units: J[][] = [];
  let pre: J[] = [];
  for (const it of video.children as J[]) {
    if (it.OTIO_SCHEMA?.startsWith("Clip")) { units.push([...pre, it]); pre = []; } else pre.push(it);
  }
  const fps: number = out.metadata?.reel?.fps ?? 30;
  const secs = (v: unknown, what: string, min: number) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min) throw new ReelError(`${what} must be a number >= ${min}`);
    return v;
  };
  if (e.op === "insert") {
    const dur = secs(e.dur, "dur", 1 / fps), from = e.from === undefined ? 0 : secs(e.from, "from", 0);
    if (typeof e.src !== "string" || !e.src) throw new ReelError("insert needs a media file");
    const clip = { OTIO_SCHEMA: "Clip.2", name: e.src.replace(/^.*[\\/]/, ""), metadata: { reel: { kind: "shot" } },
      source_range: range(Math.round(from * fps), Math.max(1, Math.round(dur * fps)), fps),
      media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: "ExternalReference.1", target_url: url(e.src), available_range: null, metadata: {} } },
      active_media_reference_key: "DEFAULT_MEDIA" };
    units.splice(Math.max(0, Math.min(units.length, Math.round(e.at) - 1)), 0, [clip]);
    return finish(out, video, units);
  }
  if (e.op === "music") {
    const tracks: J[] = out.tracks.children;
    const i = tracks.findIndex((t) => t.kind === "Audio");
    const old = i >= 0 ? tracks[i].children?.find((c: J) => c.OTIO_SCHEMA?.startsWith("Clip")) : undefined;
    if (e.src === null) { if (i >= 0) tracks.splice(i, 1); return out; }
    const oref = old && (old.media_references?.[old.active_media_reference_key ?? "DEFAULT_MEDIA"] ?? old.media_reference);
    const src = e.src ?? (oref?.target_url ? unurl(oref.target_url) : undefined);
    if (typeof src !== "string" || !src) throw new ReelError("music needs a media file");
    const vol = e.vol === undefined ? (old?.metadata?.reel?.vol ?? 1) : secs(e.vol, "vol", 0);
    if (vol > 4) throw new ReelError("vol must be <= 4");
    const from = e.from === undefined ? (old?.source_range ? old.source_range.start_time.value / old.source_range.start_time.rate : 0) : secs(e.from, "from", 0);
    let frames = 0;
    for (const u of units) { const c = u[u.length - 1]; frames += c.source_range ? Math.round(c.source_range.duration.value * fps / c.source_range.duration.rate) : 0; }
    const clip = { OTIO_SCHEMA: "Clip.2", name: "music", metadata: { reel: { vol, fadeOut: old?.metadata?.reel?.fadeOut ?? 1.5 } },
      source_range: range(Math.round(from * fps), Math.max(1, frames), fps),
      media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: "ExternalReference.1", target_url: url(src), available_range: null, metadata: {} } },
      active_media_reference_key: "DEFAULT_MEDIA" };
    const track = { OTIO_SCHEMA: "Track.1", name: "A1", kind: "Audio", metadata: {}, children: [clip] };
    if (i >= 0) tracks[i] = track; else tracks.push(track);
    return out;
  }
  const n = e.n - 1;
  if (!(n >= 0 && n < units.length)) throw new ReelError(`no clip ${e.n} (there are ${units.length})`);
  if (e.op === "trim") {
    const u = units[n], clip = u[u.length - 1];
    const isTitle = clip.metadata?.reel?.kind === "title";
    const sr = clip.source_range ?? range(0, Math.round((clip.metadata?.reel?.dur ?? 3) * fps), fps);
    if (e.from !== undefined) {
      if (isTitle) throw new ReelError("a title has no source to trim from; change its length instead");
      sr.start_time = rt(Math.round(secs(e.from, "from", 0) * sr.start_time.rate), sr.start_time.rate);
    }
    if (e.dur !== undefined) sr.duration = rt(Math.max(1, Math.round(secs(e.dur, "dur", 1 / fps) * sr.duration.rate)), sr.duration.rate);
    clip.source_range = sr;
    if (isTitle && clip.media_references?.DEFAULT_MEDIA?.available_range) clip.media_references.DEFAULT_MEDIA.available_range = range(0, sr.duration.value, sr.duration.rate);
    return finish(out, video, units);
  }
  if (e.op === "title") {
    const u = units[n], clip = u[u.length - 1], r = clip.metadata?.reel;
    const ref = clip.media_references?.DEFAULT_MEDIA;
    if (r?.kind !== "title" && ref?.generator_kind !== "reel.title") throw new ReelError(`clip ${e.n} is not a title`);
    const params = ref.parameters ?? (ref.parameters = {});
    if (e.text !== undefined) {
      if (typeof e.text !== "string" || !e.text.trim()) throw new ReelError("title text can't be empty");
      params.text = e.text; if (r) r.text = e.text;
      clip.name = `title ${JSON.stringify(e.text.length > 24 ? e.text.slice(0, 23) + "…" : e.text)}`;
    }
    if (e.sub !== undefined) {
      if (e.sub !== null && typeof e.sub !== "string") throw new ReelError("sub must be text or null");
      const sub = e.sub && e.sub.trim() ? e.sub : null;
      params.sub = sub; if (r) { if (sub) r.sub = sub; else delete r.sub; }
    }
    if (e.dur !== undefined) {
      const k = Math.max(1, Math.round(secs(e.dur, "dur", 1 / fps) * fps));
      clip.source_range = range(0, k, fps);
      if (ref.available_range) ref.available_range = range(0, k, fps);
      if (r && "dur" in r) r.dur = k / fps;
    }
    return finish(out, video, units);
  }
  if (e.op === "trans") {
    if (!TRANS.includes(e.type)) throw new ReelError(`transition must be one of ${TRANS.join(", ")}`);
    if (n === 0 && !FIRST_OK.includes(e.type)) throw new ReelError(`the first clip can't ${e.type} in (nothing before it); use ${FIRST_OK.join(", ")}`);
    const t = makeTrans(e.type, e.type === "cut" ? undefined : e.dur, e.type === "slide" ? (e.dir ?? "left") : e.color);
    const reel = { ...t } as J; delete reel.__trans;
    const u = units[n], clip = u[u.length - 1];
    clip.metadata ??= {}; clip.metadata.reel ??= {};
    clip.metadata.reel.in = { __trans: true, ...reel };
    const lead: J[] = [];
    if (n > 0 && e.type !== "cut") {
      const half = Math.round((t.dur * fps) / 2);
      lead.push({ OTIO_SCHEMA: "Transition.1", name: e.type, transition_type: OTIO_TRANS[e.type] ?? "Custom_Transition",
        in_offset: rt(half, fps), out_offset: rt(half, fps), metadata: { reel: { __trans: true, ...reel } } });
    }
    units[n] = [...lead, clip];
    return finish(out, video, units);
  }
  if (e.op === "badge") {
    const u = units[n], clip = u[u.length - 1];
    clip.metadata ??= {}; clip.metadata.reel ??= {};
    if (e.badge === null || e.badge === "") delete clip.metadata.reel.badge;
    else if (typeof e.badge !== "string" || e.badge.length > 12) throw new ReelError("badge must be short text (12 characters max)");
    else clip.metadata.reel.badge = e.badge;
    return finish(out, video, units);
  }
  if (e.op === "duplicate") {
    units.splice(n + 1, 0, structuredClone(units[n]));
    return finish(out, video, units);
  }
  if (e.op === "split") {
    const u = units[n], clip = u[u.length - 1];
    const isTitle = clip.metadata?.reel?.kind === "title";
    const sr = clip.source_range ?? range(0, Math.round((clip.metadata?.reel?.dur ?? 3) * fps), fps);
    const rate: number = sr.duration.rate, total: number = sr.duration.value;
    const k = Math.round(secs(e.at, "at", 0) * rate);
    if (k < 1 || k > total - 1) throw new ReelError(`split point must be inside the clip (0-${(total / rate).toFixed(2)}s)`);
    const a = structuredClone(clip), b = structuredClone(clip);
    a.source_range = range(sr.start_time.value, k, rate);
    const speed: number = isTitle ? 0 : (clip.metadata?.reel?.speed ?? 1);
    b.source_range = range(sr.start_time.value + Math.round(k * speed), total - k, rate);
    if (b.metadata?.reel) b.metadata.reel.in = { type: "cut", dur: 0, color: "#000000", dir: "left" };
    for (const [c, d] of [[a, k], [b, total - k]] as const) {
      if (c.metadata?.reel && "dur" in c.metadata.reel) c.metadata.reel.dur = d / rate;
      if (isTitle && c.media_references?.DEFAULT_MEDIA?.available_range) c.media_references.DEFAULT_MEDIA.available_range = range(0, d, rate);
    }
    units.splice(n, 1, [...u.slice(0, -1), a], [b]);
    return finish(out, video, units);
  }
  if (e.op === "delete") {
    if (units.length === 1) throw new ReelError("can't delete the last clip");
    units.splice(n, 1);
  } else {
    const to = Math.max(0, Math.min(units.length - 1, e.to - 1));
    const [u] = units.splice(n, 1);
    units.splice(to, 0, u);
  }
  return finish(out, video, units);
}
function finish(out: J, video: J, units: J[][]): J {
  // Only the first unit's leading transition needs fixing; others keep theirs.
  const first = units[0], clip = first[first.length - 1];
  const tr = first.find((x) => x.OTIO_SCHEMA?.startsWith("Transition"));
  const r = clip.metadata?.reel;
  if (tr && !FIRST_OK.includes(tr.metadata?.reel?.type)) units[0] = [clip];
  if (r?.in && !FIRST_OK.includes(r.in.type)) r.in = { ...r.in, type: "cut", dur: 0 };
  if (units[0].length > 1 && tr && FIRST_OK.includes(tr.metadata?.reel?.type) && r) r.in = tr.metadata.reel;
  // A unit that was first and moved later has no transition: give it a cut (already the default).
  video.children = units.flat();
  return out;
}
