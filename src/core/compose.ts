// The compositor: one trailer frame at a time, from clip frames and text images the caller
// supplies. The live viewer, the contact sheet and the final render all draw through frameAt(),
// so what the agent inspects is exactly what gets encoded.
import { type Clip, type ShotDef, type TextStyle, type Timeline, type TitleDef, ease } from "./project.ts";

/** RGBA, straight alpha. */
export interface Img { w: number; h: number; data: Uint8Array }
export interface TextSpec { text: string; style: TextStyle; /** Wrap width in px. */ maxW: number }

export interface Sources {
  /** The frame a shot shows `u` seconds after it starts (the caller maps u to source time). */
  shot(clip: Clip, u: number): Img;
  text(spec: TextSpec): Img;
}

export function image(w: number, h: number): Img {
  return { w, h, data: new Uint8Array(w * h * 4) };
}

export function rgb(hex: string): [number, number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
}

/** Fill columns [x0, x1) with a color at an opacity. */
export function fill(dst: Img, hex: string, alpha = 1, x0 = 0, x1 = dst.w, y0 = 0, y1 = dst.h): void {
  const [r, g, b, a0] = rgb(hex), a = Math.max(0, Math.min(1, alpha * a0));
  if (a <= 0) return;
  const d = dst.data, ia = 1 - a;
  x0 = Math.max(0, Math.floor(x0)); x1 = Math.min(dst.w, Math.ceil(x1)); y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(dst.h, Math.ceil(y1));
  for (let y = y0; y < y1; y++)
    for (let o = (y * dst.w + x0) * 4, e = (y * dst.w + x1) * 4; o < e; o += 4) {
      d[o] = r * a + d[o] * ia; d[o + 1] = g * a + d[o + 1] * ia; d[o + 2] = b * a + d[o + 2] * ia; d[o + 3] = 255;
    }
}

/**
 * Draw `src` scaled by `s` with its top-left at (tx, ty), over `dst`, at an opacity, limited to
 * columns [0, clipX). Bilinear on premultiplied color, or nearest for pixel art.
 */
export function draw(dst: Img, src: Img, s: number, tx: number, ty: number, alpha = 1, nearest = false, clipX = dst.w): void {
  if (alpha <= 0 || s <= 0) return;
  const x0 = Math.max(0, Math.floor(tx)), x1 = Math.min(dst.w, clipX, Math.ceil(tx + src.w * s));
  const y0 = Math.max(0, Math.floor(ty)), y1 = Math.min(dst.h, Math.ceil(ty + src.h * s));
  if (x1 <= x0 || y1 <= y0) return;
  const sd = src.data, dd = dst.data, sw = src.w, sh = src.h, inv = 1 / s;
  // Per-column source index and weight, computed once.
  const n = x1 - x0, cx0 = new Int32Array(n), cx1 = new Int32Array(n), cfx = new Float32Array(n), cin = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const sx = (x0 + i + 0.5 - tx) * inv - (nearest ? 0 : 0.5);
    cin[i] = sx > -1 && sx < sw ? 1 : 0;
    if (nearest) { cx0[i] = cx1[i] = Math.min(sw - 1, Math.max(0, Math.floor(sx))); cfx[i] = 0; continue; }
    const f = Math.floor(sx);
    cx0[i] = Math.max(0, f); cx1[i] = Math.min(sw - 1, f + 1); cfx[i] = sx - f;
  }
  for (let y = y0; y < y1; y++) {
    const sy = (y + 0.5 - ty) * inv - (nearest ? 0 : 0.5);
    if (sy <= -1 || sy >= sh) continue;
    let r0: number, r1: number, fy: number;
    if (nearest) { r0 = r1 = Math.min(sh - 1, Math.max(0, Math.floor(sy))); fy = 0; }
    else { const f = Math.floor(sy); r0 = Math.max(0, f); r1 = Math.min(sh - 1, f + 1); fy = sy - f; }
    const b0 = r0 * sw * 4, b1 = r1 * sw * 4;
    let o = (y * dst.w + x0) * 4;
    for (let i = 0; i < n; i++, o += 4) {
      if (!cin[i]) continue;
      const p00 = b0 + cx0[i] * 4, p01 = b0 + cx1[i] * 4, p10 = b1 + cx0[i] * 4, p11 = b1 + cx1[i] * 4, fx = cfx[i];
      const w00 = (1 - fx) * (1 - fy) * sd[p00 + 3], w01 = fx * (1 - fy) * sd[p01 + 3], w10 = (1 - fx) * fy * sd[p10 + 3], w11 = fx * fy * sd[p11 + 3];
      const wa = w00 + w01 + w10 + w11;
      if (wa <= 0) continue;
      const a = (wa / 255) * alpha, k = a / wa, ia = 1 - a;
      dd[o] = (sd[p00] * w00 + sd[p01] * w01 + sd[p10] * w10 + sd[p11] * w11) * k + dd[o] * ia;
      dd[o + 1] = (sd[p00 + 1] * w00 + sd[p01 + 1] * w01 + sd[p10 + 1] * w10 + sd[p11 + 1] * w11) * k + dd[o + 1] * ia;
      dd[o + 2] = (sd[p00 + 2] * w00 + sd[p01 + 2] * w01 + sd[p10 + 2] * w10 + sd[p11 + 2] * w11) * k + dd[o + 2] * ia;
      dd[o + 3] = 255;
    }
  }
}

/** Where a shot's frame lands: scale and top-left, from fit, zoom and the focus point. */
export function shotPlacement(d: ShotDef, srcW: number, srcH: number, W: number, H: number, p: number): { s: number; tx: number; ty: number } {
  const e = ease(d.move.ease, p), lerp = (r: [number, number]) => r[0] + (r[1] - r[0]) * e;
  const base = d.fit === "cover" ? Math.max(W / srcW, H / srcH) : Math.min(W / srcW, H / srcH);
  const s = base * lerp(d.move.zoom), w = srcW * s, h = srcH * s;
  // Put the focus point at the frame centre, then keep a covering image from showing its edges.
  const place = (size: number, view: number, focus: number) => {
    const t = view / 2 - focus * size;
    return size >= view ? Math.min(0, Math.max(view - size, t)) : (view - size) / 2;
  };
  return { s, tx: place(w, W, lerp(d.move.x)), ty: place(h, H, lerp(d.move.y)) };
}

const TEXT_FADE = 0.2;

function drawText(dst: Img, src: Sources, spec: TextSpec, cx: number, y: number, alpha: number, scale = 1): number {
  const im = src.text(spec);
  // Unscaled text lands on whole pixels, so it stays as sharp as it was rendered.
  const x = cx - (im.w * scale) / 2, top = y - (im.h * scale) / 2;
  draw(dst, im, scale, scale === 1 ? Math.round(x) : x, scale === 1 ? Math.round(top) : top, alpha);
  return im.h;
}

/** Vertical band text sits in: inside the letterbox, if any. */
function safe(tl: Timeline): { top: number; bot: number } {
  const { w, h, letterbox } = tl.def;
  const bar = letterbox ? Math.max(0, (h - w / letterbox) / 2) : 0;
  return { top: bar, bot: h - bar };
}

/** Mix `top` over `dst` at an opacity (both opaque, same size). */
function mix(dst: Img, top: Img, a: number): void {
  const d = dst.data, t = top.data, ia = 1 - a;
  for (let i = 0; i < d.length; i += 4) { d[i] = t[i] * a + d[i] * ia; d[i + 1] = t[i + 1] * a + d[i + 1] * ia; d[i + 2] = t[i + 2] * a + d[i + 2] * ia; }
}

let scratch: Img | undefined;

function drawClip(dst: Img, tl: Timeline, src: Sources, c: Clip, u: number, alpha: number, clipX = dst.w): void {
  // A clip fading in is drawn whole, then mixed: its background must not darken what is under it.
  if (alpha < 1) {
    if (!scratch || scratch.w !== dst.w || scratch.h !== dst.h) scratch = image(dst.w, dst.h);
    drawClip(scratch, tl, src, c, u, 1, clipX);
    mix(dst, scratch, alpha);
    return;
  }
  const { w: W, h: H } = tl.def, d = c.def, p = u / c.dur;
  fill(dst, d.bg, alpha, 0, clipX);
  if (d.kind === "shot") {
    const im = src.shot(c, u);
    const { s, tx, ty } = shotPlacement(d, im.w, im.h, W, H, p);
    draw(dst, im, s, tx, ty, alpha, d.pixel, clipX);
    if (d.caption) {
      const fade = Math.min(1, u / TEXT_FADE, (c.dur - u) / TEXT_FADE);
      const band = safe(tl), st = d.caption.style;
      const y = st.pos === "top" ? band.top + H * 0.1 : st.pos === "bottom" ? band.bot - H * 0.1 : H / 2;
      if (clipX >= W) drawText(dst, src, { text: d.caption.text, style: st, maxW: W * 0.85 }, W / 2, y, alpha * fade);
    }
  } else if (clipX >= W) drawTitle(dst, tl, src, c, d, u, alpha);
}

function drawTitle(dst: Img, tl: Timeline, src: Sources, c: Clip, d: TitleDef, u: number, alpha: number): void {
  const { w: W, h: H } = tl.def, p = u / c.dur;
  const fadeIn = d.anim === "punch" ? 1 : Math.min(1, u / TEXT_FADE), fadeOut = Math.min(1, (c.dur - u) / TEXT_FADE);
  const a = alpha * Math.min(fadeIn, fadeOut);
  const scale = d.anim === "push" ? 1 + 0.06 * p : d.anim === "punch" ? 1 + 0.25 * (1 - ease("out", u / 0.18)) : 1;
  const main: TextSpec = { text: d.text, style: d.style, maxW: W * 0.86 };
  const sub: TextSpec | undefined = d.sub ? { text: d.sub, style: { ...d.style, size: Math.round(d.style.size * 0.5), weight: 500, tracking: Math.max(d.style.tracking, 0.12) }, maxW: W * 0.86 } : undefined;
  const mh = src.text(main).h * scale, sh = sub ? src.text(sub).h : 0, gap = sub ? d.style.size * 0.35 : 0;
  const band = safe(tl), total = mh + gap + sh;
  const top = d.style.pos === "top" ? band.top + H * 0.08 : d.style.pos === "bottom" ? band.bot - H * 0.08 - total : (H - total) / 2;
  drawText(dst, src, main, W / 2, top + mh / 2, a, scale);
  if (sub) drawText(dst, src, sub, W / 2, top + mh + gap + sh / 2, a);
}

/** The clip on screen at time t (the incoming one during a transition). */
export function clipAt(tl: Timeline, t: number): Clip {
  let lo = 0, hi = tl.clips.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tl.clips[mid].start <= t + 1e-9) lo = mid; else hi = mid - 1;
  }
  return tl.clips[lo];
}

/** The clips a frame at time t needs, with their local times: [incoming, outgoing?]. */
export function needs(tl: Timeline, t: number): { clip: Clip; u: number }[] {
  const c = clipAt(tl, t), u = t - c.start, prev = tl.clips[c.i - 1];
  const out = [{ clip: c, u }];
  if (prev && c.def.in.type !== "cut" && c.def.in.type !== "flash" && u < c.def.in.dur) out.push({ clip: prev, u: t - prev.start });
  return out;
}

/** Compose the frame at time t (seconds) into a W×H image. */
export function frameAt(tl: Timeline, t: number, src: Sources, dst = image(tl.def.w, tl.def.h)): Img {
  const { w: W, h: H, letterbox, fadeIn, fadeOut } = tl.def;
  const c = clipAt(tl, t), u = t - c.start, tr = c.def.in, prev = tl.clips[c.i - 1];
  const p = tr.dur > 0 ? Math.min(1, u / tr.dur) : 1;
  dst.data.fill(0);
  fill(dst, "#000000");
  if (p >= 1 || tr.type === "cut") drawClip(dst, tl, src, c, u, 1);
  else if (tr.type === "flash") { drawClip(dst, tl, src, c, u, 1); fill(dst, tr.color, (1 - p) ** 2); }
  else if (tr.type === "fade") { if (prev) drawClip(dst, tl, src, prev, t - prev.start, 1); drawClip(dst, tl, src, c, u, p); }
  else if (tr.type === "wipe") { if (prev) drawClip(dst, tl, src, prev, t - prev.start, 1); drawClip(dst, tl, src, c, u, 1, Math.round(W * ease("inOut", p))); }
  else if (tr.type === "dip") {
    if (p < 0.5) { if (prev) drawClip(dst, tl, src, prev, t - prev.start, 1); fill(dst, tr.color, prev ? p * 2 : 1); }
    else { drawClip(dst, tl, src, c, u, 1); fill(dst, tr.color, (1 - p) * 2); }
  }
  if (letterbox) {
    const bar = Math.max(0, (H - W / letterbox) / 2);
    if (bar > 0) { fill(dst, "#000000", 1, 0, W, 0, bar); fill(dst, "#000000", 1, 0, W, H - bar, H); }
  }
  if (fadeIn > 0 && t < fadeIn) fill(dst, "#000000", 1 - t / fadeIn);
  if (fadeOut > 0 && t > tl.dur - fadeOut) fill(dst, "#000000", (t - (tl.dur - fadeOut)) / fadeOut);
  return dst;
}

/** The same timeline drawn k times smaller (proxies, thumbnails): canvas and text sizes scale. */
export function scaled(tl: Timeline, k: number): Timeline {
  if (k === 1) return tl;
  const even = (v: number) => Math.max(2, Math.round((v * k) / 2) * 2);
  const st = (s: TextStyle) => ({ ...s, size: Math.max(4, s.size * k) });
  const def = { ...tl.def, w: even(tl.def.w), h: even(tl.def.h) };
  def.clips = tl.def.clips.map((c) => c.kind === "title" ? { ...c, style: st(c.style) } : { ...c, caption: c.caption && { ...c.caption, style: st(c.caption.style) } });
  return { ...tl, def, clips: tl.clips.map((c) => ({ ...c, def: def.clips[c.i] })) };
}
