// OpenTimelineIO bridge: a reel trailer <-> an .otio timeline (plain JSON, no Python needed).
// The .otio file is the master edit: Kdenlive/Shotcut (via OTIO adapters), the web editor and the
// agent all edit it. Standard OTIO fields carry what an NLE can change (order, names, trims, media,
// transitions); reel-only settings (moves, grades, titles, overlays) ride in metadata.reel.
// Pure: no file system.
import { ReelError } from "./errors.ts";
import type { ClipDef, Timeline, TrailerDef, TransType } from "./project.ts";

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
