// reel live viewer. Plain browser JS, no build step.
const $ = (id) => document.getElementById(id);
const vid = $("vid"), still = $("still"), cv = $("tl"), g = cv.getContext("2d");
let sel; try { sel = localStorage.getItem("reel.sel") || undefined; } catch {}
let state, t = 1, proxyKey = "", lastClip, trimOpen = 0, selN = 0;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const cur = () => state?.trailers.find((x) => x.name === sel);
const ready = () => cur()?.proxy.state === "ready";
const clipAtT = (tr, s) => tr && [...tr.clips].reverse().find((c) => c.start <= s + 1e-6);
const selected = () => { const tr = cur(); return tr?.clips.find((c) => c.n === selN) ?? clipAtT(tr, t); };
const canEdit = () => !!state?.editable && !!cur() && !cur().error;

// ---------------------------------------------------------------- picture
// The proxy video plays with sound; while it isn't ready (or when stepping), the server's exact
// composed frame is shown instead.
// While scrubbing, cheap 240 px frames (one request in flight, the newest wins); the exact
// 960 px frame when the finger lifts.
let stillTimer, fastBusy = false, fastWant;
const frameUrl = (tr, w) => `/api/frame?name=${encodeURIComponent(tr.name)}&t=${t.toFixed(4)}&w=${w}&v=${state.version}`;
function showStill(fast) {
  const tr = cur(); if (!tr || tr.error) return;
  clearTimeout(stillTimer);
  $("stage").classList.add("still");
  if (fast) {
    fastWant = frameUrl(tr, 240);
    if (!fastBusy) { fastBusy = true; still.src = fastWant; fastWant = undefined; }
    return;
  }
  fastWant = undefined;
  stillTimer = setTimeout(() => { still.src = frameUrl(tr, 960); }, 40);
}
still.onload = still.onerror = () => { fastBusy = false; if (fastWant) { fastBusy = true; still.src = fastWant; fastWant = undefined; } };
function seek(nt, exact, fast) {
  const tr = cur(); if (!tr) return;
  t = Math.max(0, Math.min(tr.dur - 1 / tr.fps, nt));
  if (ready() && !exact && !fast) { vid.currentTime = t; $("stage").classList.remove("still"); }
  else showStill(fast);
  draw();
}
function toggle() {
  if (!ready()) return;
  setShuttle(0);
  if (vid.paused) { vid.playbackRate = 1; vid.currentTime = t; $("stage").classList.remove("still"); vid.play(); } else vid.pause();
}
vid.ontimeupdate = () => { if (!vid.paused) { t = vid.currentTime; draw(); } };
vid.onplay = () => ($("play").textContent = "❚❚ pause");
vid.onpause = () => ($("play").textContent = "▶ play");
$("play").onclick = toggle;

// J/K/L shuttle: L plays forward (again = faster), J plays backward (stepped stills), K stops.
let shuttle = 0, revTimer;
function setShuttle(s) {
  shuttle = s; clearInterval(revTimer);
  if (s > 0 && ready()) { vid.playbackRate = s; vid.currentTime = t; $("stage").classList.remove("still"); vid.play(); }
  else if (s < 0) {
    vid.pause();
    revTimer = setInterval(() => { if (t <= 0) return setShuttle(0); seek(t + s * 0.1, !ready()); }, 100);
  } else vid.pause();
}

// ---------------------------------------------------------------- timeline: view, zoom, thumbnails
const PAD = 8, RULER = 16, CY = 20;
let zoom = 1, view0 = 0;
const CH = () => (cv.clientHeight >= 160 || (cv.clientHeight >= 100 && !cur()?.music) ? 70 : cv.clientHeight >= 140 ? 60 : 44);
const pps = () => ((cv.clientWidth - PAD * 2) / cur().dur) * zoom;
const visDur = () => cur().dur / zoom;
const clampView = () => { const tr = cur(); if (tr) view0 = Math.max(0, Math.min(tr.dur - visDur(), view0)); };
const xOf = (s) => PAD + (s - view0) * pps();
const tOf = (px) => view0 + (px - PAD) / pps();
function zoomAt(f, px) {
  const tr = cur(); if (!tr?.dur) return;
  const at = tOf(px ?? xOf(t));
  zoom = Math.max(1, Math.min(40, zoom * f));
  view0 = at - (( px ?? xOf(t)) - PAD) / pps();
  clampView(); draw();
}
$("zoomin").onclick = () => zoomAt(1.6);
$("zoomout").onclick = () => zoomAt(1 / 1.6);
// Keep the playhead in view while playing.
function follow() {
  if (zoom === 1) return;
  if (t < view0 || t > view0 + visDur()) { view0 = t - visDur() * 0.1; clampView(); }
}

const thumbs = new Map(), byText = new Map();
function thumb(tr, c) {
  const k = `${tr.name}|${state.version}|${c.n}`;
  if (thumbsLocal) return byText.get(`${tr.name}|${c.text}`) ?? null;
  let im = thumbs.get(k);
  if (!im) {
    if (thumbs.size > 200) thumbs.clear();
    im = new Image();
    im.onload = () => { byText.set(`${tr.name}|${c.text}`, im); draw(); };
    im.src = `/api/frame?name=${encodeURIComponent(tr.name)}&t=${(c.start + c.dur * 0.5).toFixed(3)}&w=192&v=${state.version}`;
    thumbs.set(k, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}
const beats = (tr) => { const b = []; if (tr.bpm) for (let s = tr.beat0; s <= tr.dur + 1e-6; s += 60 / tr.bpm) b.push(s); return b; };
function snap(s, skip) {
  const tr = cur(), lim = 8 / pps();
  let best = s, d = lim;
  const cand = [...beats(tr), t];
  for (const c of tr.clips) if (c.n !== skip) cand.push(c.start, c.start + c.dur);
  for (const v of cand) if (Math.abs(v - s) < d) { d = Math.abs(v - s); best = v; }
  return { s: best, snapped: best !== s };
}

function block(x0, x1, y, h, r) {
  g.beginPath(); g.roundRect ? g.roundRect(x0, y, Math.max(1, x1 - x0), h, r) : g.rect(x0, y, Math.max(1, x1 - x0), h);
}
function draw() {
  const tr = cur(), dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  $("time").textContent = `${t.toFixed(2)}s  frame ${tr ? Math.round(t * tr.fps) : 0}`;
  if (!tr || tr.error || !tr.dur) return;
  if (!vid.paused || shuttle) follow();
  const ch = CH(), wy = CY + ch + 6;
  g.font = "11px ui-monospace, monospace"; g.textBaseline = "alphabetic";
  // ruler + beat grid
  const bs = beats(tr);
  bs.forEach((s, b) => {
    const x = xOf(s); if (x < 0 || x > w) return;
    g.strokeStyle = `rgba(255,255,255,${b % 4 ? 0.07 : 0.22})`; g.beginPath(); g.moveTo(x, b % 4 ? 10 : 4); g.lineTo(x, h); g.stroke();
  });
  const step = [0.5, 1, 2, 5, 10, 20, 30, 60].find((s) => s * pps() > 60) ?? 60;
  g.fillStyle = "#7a7a7a";
  for (let s = Math.ceil(view0 / step) * step; s <= view0 + visDur(); s += step) g.fillText(`${+s.toFixed(1)}s`, xOf(s) + 3, 12);
  // clip blocks with thumbnails
  for (const c of tr.clips) {
    let s0 = c.start, s1 = c.start + c.dur;
    if (drag?.kind === "trim" && drag.c.n === c.n) { s0 = drag.s0; s1 = drag.s1; }
    const x0 = xOf(s0) + 1, x1 = xOf(s1) - 1;
    if (x1 < 0 || x0 > w) continue;
    const ghost = drag?.kind === "move" && drag.on && drag.c.n === c.n;
    g.save(); g.globalAlpha = ghost ? 0.3 : 1;
    block(x0, x1, CY, ch, 5); g.fillStyle = c.kind === "title" ? "#3e3e3e" : "#2e2e2e"; g.fill();
    g.save(); block(x0, x1, CY, ch, 5); g.clip();
    const im = thumb(tr, c);
    if (im) {
      const tw = ch * (im.naturalWidth / im.naturalHeight);
      for (let x = x0; x < x1; x += tw) g.drawImage(im, x, CY, tw, ch);
      g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(x0, CY, x1 - x0, 16);
    }
    if (c.inDur) { g.fillStyle = "rgba(255,255,255,0.55)"; g.beginPath(); g.moveTo(x0, CY + ch); g.lineTo(x0 + Math.min(x1 - x0, c.inDur * pps()), CY + ch); g.lineTo(x0, CY + ch - 10); g.fill(); }
    if (c.in !== "cut" && x1 - x0 > 60) { const lbl = `${c.in} ${c.inDur.toFixed(2)}`; g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect(x0, CY + ch - 15, g.measureText(lbl).width + 16, 15); g.fillStyle = "#d8d8d8"; g.fillText(lbl, x0 + 12, CY + ch - 4); }
    if (c.badge && x1 - x0 > 40) { const bw = g.measureText(c.badge).width + 8; g.fillStyle = "#2a2a2a"; g.fillRect(x1 - bw - 3, CY + ch - 17, bw, 14); g.fillStyle = "#ffffff"; g.fillText(c.badge, x1 - bw + 1, CY + ch - 6); }
    g.fillStyle = "#f0f0f0"; if (x1 - x0 > 18) g.fillText(x1 - x0 > 70 ? `${c.n} ${c.text}`.slice(0, Math.floor((x1 - x0 - 6) / 7)) : String(c.n), x0 + 4, CY + 12);
    g.restore();
    const isSel = selN === c.n;
    block(x0, x1, CY, ch, 5); g.strokeStyle = isSel ? "#ffb454" : "#4a4a4a"; g.lineWidth = isSel ? 2 : 1; g.stroke(); g.lineWidth = 1;
    if (isSel && x1 - x0 > 24) { g.fillStyle = "#ffb454"; g.fillRect(x0 + 2, CY + ch / 2 - 9, 3, 18); g.fillRect(x1 - 5, CY + ch / 2 - 9, 3, 18); }
    g.restore();
    if (drag?.kind === "trim" && drag.c.n === c.n) { g.fillStyle = "#ffb454"; g.fillText(`${(s1 - s0).toFixed(2)}s`, Math.max(4, x0 + 4), CY + ch - 6); }
  }
  // dragged clip follows the pointer; amber line where it lands
  if (drag?.kind === "move" && drag.on) {
    const c = drag.c, x0 = drag.x - drag.grabDx, x1 = x0 + c.dur * pps();
    g.save(); g.globalAlpha = 0.85; block(x0, x1, CY - 4, ch, 5); g.fillStyle = "#4a4a4a"; g.fill();
    const im = thumb(tr, c); if (im) { g.save(); block(x0, x1, CY - 4, ch, 5); g.clip(); g.drawImage(im, x0, CY - 4, ch * im.naturalWidth / im.naturalHeight, ch); g.restore(); }
    g.strokeStyle = "#ffb454"; g.lineWidth = 2; block(x0, x1, CY - 4, ch, 5); g.stroke(); g.restore();
    const lx = xOf(slotTime(drag.to)); g.fillStyle = "#ffb454"; g.fillRect(lx - 2, CY - 8, 4, ch + 14);
  }
  // music
  if (tr.music) {
    const y = (db) => h - 6 - Math.max(0, Math.min(1, (db + 60) / 60)) * (h - wy - 10);
    g.strokeStyle = "#7a7a7a"; g.lineWidth = 1.2; g.beginPath();
    tr.music.db.forEach((db, i) => { const x = xOf(i * tr.music.hop); i ? g.lineTo(x, y(db)) : g.moveTo(x, y(db)); });
    g.stroke(); g.lineWidth = 1;
    g.fillStyle = "#bdbdbd";
    for (const s of tr.music.hits.slice(0, 12)) { const x = xOf(s); g.beginPath(); g.moveTo(x - 4, h - 1); g.lineTo(x, h - 8); g.lineTo(x + 4, h - 1); g.fill(); }
  }
  for (const [i, n] of marks().notes.entries()) {
    g.fillStyle = "rgba(255,255,255,0.12)"; if (n.t1 != null) g.fillRect(xOf(n.t), wy, xOf(n.t1) - xOf(n.t), h - wy);
    g.fillStyle = "#d0d0d0"; g.fillText("n" + (i + 1), xOf(n.t) + 2, wy + 12);
  }
  if (drag?.kind === "note" && drag.t1 !== undefined) { g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(xOf(Math.min(drag.t0, drag.t1)), wy, Math.abs(xOf(drag.t1) - xOf(drag.t0)), h - wy); }
  if (drag?.snapX != null) { g.strokeStyle = "rgba(255,180,84,0.6)"; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(drag.snapX, 0); g.lineTo(drag.snapX, h); g.stroke(); g.setLineDash([]); }
  // playhead
  const px = xOf(t);
  g.strokeStyle = "#ffb454"; g.lineWidth = 2; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, h); g.stroke(); g.lineWidth = 1;
  g.fillStyle = "#ffb454"; g.beginPath(); g.moveTo(px - 6, 0); g.lineTo(px + 6, 0); g.lineTo(px, 8); g.fill();
  // zoom scrollbar
  if (zoom > 1) { const sw = w - PAD * 2; g.fillStyle = "#555"; g.fillRect(PAD + (view0 / tr.dur) * sw, h - 3, sw / zoom, 3); }
  const c = clipAtT(tr, t);
  if (c && c.n !== lastClip) { lastClip = c.n; renderClips(); }
  if (c) $("clip").textContent = `#${c.n}  ${c.start.toFixed(2)}–${(c.start + c.dur).toFixed(2)}s  ${c.in !== "cut" ? c.in + " " + c.inDur + "s · " : ""}${c.text}  ${c.loc ?? ""}`;
}
// Where clip slot `to` (1-based, after removing the dragged clip) starts, for the drop marker.
function slotTime(to) {
  const rest = cur().clips.filter((c) => c.n !== drag.c.n);
  return to - 1 < rest.length ? rest[to - 1].start : cur().dur;
}

// ---------------------------------------------------------------- timeline: pointer editing
let drag, press;
const pointers = new Map();
let pinch;
function hit(x, y, touch) {
  const tr = cur(); if (!tr?.dur) return;
  if (y < CY - 2 || y > CY + CH() + 2) return;
  const c = tr.clips.find((c) => x >= xOf(c.start) && x < xOf(c.start + c.dur));
  if (!c) return;
  const x0 = xOf(c.start), x1 = xOf(c.start + c.dur), e = Math.min(touch ? 16 : 7, (x1 - x0) / 3);
  return { c, edge: x - x0 < e ? "left" : x1 - x < e ? "right" : null };
}
cv.addEventListener("pointerdown", (e) => {
  if (!cur()?.dur) return;
  closeMenu();
  pointers.set(e.pointerId, e.offsetX);
  cv.setPointerCapture(e.pointerId);
  if (pointers.size === 2) {
    // two fingers: pinch zoom, cancel anything else
    clearTimeout(press); drag = undefined;
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.abs(a - b) || 1, z: zoom, mid: (a + b) / 2, t: tOf((a + b) / 2) };
    return;
  }
  if (e.button === 2) return;
  const h = hit(e.offsetX, e.offsetY, e.pointerType === "touch");
  vid.pause(); setShuttle(0);
  if (h && canEdit()) {
    selN = h.c.n; renderClips();
    if (h.edge) drag = { kind: "trim", c: h.c, edge: h.edge, s0: h.c.start, s1: h.c.start + h.c.dur, x: e.offsetX };
    else drag = { kind: "move", c: h.c, x0: e.offsetX, x: e.offsetX, grabDx: e.offsetX - xOf(h.c.start), on: false, to: h.c.n };
    if (e.pointerType !== "mouse") press = setTimeout(() => { const d = drag; drag = undefined; draw(); if (d) openMenu(d.c, e.clientX, e.clientY); }, 520);
    draw();
  } else if (h) { selN = h.c.n; seek(h.c.start + Math.min(0.5, h.c.dur / 2), true); renderClips(); }
  else { const s = tOf(e.offsetX); drag = { kind: e.shiftKey ? "note" : "scrub", t0: s }; seek(s, true, true); }
});
cv.addEventListener("pointermove", (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e.offsetX);
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    zoom = Math.max(1, Math.min(40, pinch.z * (Math.abs(a - b) || 1) / pinch.d));
    view0 = pinch.t - ((a + b) / 2 - PAD) / pps(); clampView(); draw();
    return;
  }
  if (!drag) {
    const h = hit(e.offsetX, e.offsetY, false);
    cv.style.cursor = !h || !canEdit() ? "crosshair" : h.edge ? "ew-resize" : "grab";
    return;
  }
  const s = tOf(e.offsetX);
  if (drag.kind === "scrub") seek(s, true, true);
  else if (drag.kind === "note") { drag.t1 = s; seek(s, true, true); }
  else if (drag.kind === "trim") {
    clearTimeout(press);
    const c = drag.c, fps = cur().fps, sn = snap(s, c.n);
    drag.snapX = sn.snapped ? xOf(sn.s) : null;
    if (drag.edge === "right") drag.s1 = Math.max(c.start + 1 / fps, sn.s);
    else {
      const minStart = c.kind === "shot" ? c.start - (c.from ?? 0) : -Infinity;
      drag.s0 = Math.max(minStart, Math.min(c.start + c.dur - 1 / fps, sn.s));
    }
    draw();
  } else if (drag.kind === "move") {
    drag.x = e.offsetX;
    if (!drag.on && Math.abs(e.offsetX - drag.x0) > 6) { drag.on = true; clearTimeout(press); cv.style.cursor = "grabbing"; }
    if (drag.on) {
      const mid = tOf(drag.x - drag.grabDx) + drag.c.dur / 2;
      const rest = cur().clips.filter((c) => c.n !== drag.c.n);
      drag.to = rest.filter((c) => c.start + c.dur / 2 < mid).length + 1;
      // scroll the zoomed view near the edges
      if (zoom > 1 && (e.offsetX < 30 || e.offsetX > cv.clientWidth - 30)) { view0 += (e.offsetX < 30 ? -1 : 1) * visDur() * 0.02; clampView(); }
      draw();
    }
  }
});
function endPointer(e, cancel) {
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = undefined; return; }
  clearTimeout(press);
  const d = drag; drag = undefined;
  if (d && (d.kind === "scrub" || d.kind === "note")) seek(t, true);
  if (!d || cancel) return draw();
  if (d.kind === "note" && d.t1 !== undefined && Math.abs(d.t1 - d.t0) > 0.05) addNote(Math.min(d.t0, d.t1), Math.max(d.t0, d.t1));
  else if (d.kind === "trim") {
    const c = d.c, s0 = d.s0, s1 = d.s1;
    if (Math.abs(s0 - c.start) > 1e-4 || Math.abs(s1 - (c.start + c.dur)) > 1e-4) {
      const body = { op: "trim", n: c.n, dur: +(s1 - s0).toFixed(4) };
      if (c.kind === "shot" && Math.abs(s0 - c.start) > 1e-4) body.from = +Math.max(0, (c.from ?? 0) + (s0 - c.start)).toFixed(4);
      edit(body);
    }
  } else if (d.kind === "move") {
    if (d.on && d.to !== d.c.n) edit({ op: "move", n: d.c.n, to: d.to });
    else if (!d.on) seek(d.c.start + Math.min(0.5, d.c.dur / 2), true);
  }
  draw();
}
cv.addEventListener("pointerup", (e) => endPointer(e));
cv.addEventListener("pointercancel", (e) => endPointer(e, true));
cv.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const h = hit(e.offsetX, e.offsetY, false);
  if (h) { selN = h.c.n; renderClips(); draw(); openMenu(h.c, e.clientX, e.clientY); }
});
cv.addEventListener("wheel", (e) => {
  if (!cur()?.dur) return;
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.01), e.offsetX); }
  else if (zoom > 1) { e.preventDefault(); view0 += ((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / pps()); clampView(); draw(); }
}, { passive: false });
addEventListener("resize", () => { placeMedia(); draw(); });

// ---------------------------------------------------------------- clip menu (right-click / long-press)
const menu = $("menu");
function openMenu(c, x, y) {
  if (!canEdit()) return;
  const inside = t > c.start + 1 / cur().fps && t < c.start + c.dur - 1 / cur().fps;
  const items = [
    ["trim…", "Open exact trim fields for this clip in the inspector", () => { trimOpen = c.n; showTab("clips"); openSheet(); renderClips(); }],
    ...(c.kind === "title" ? [["edit title…", "Change this title's text, sub line and length", () => openInspector(c.n)]] : []),
    ["transition…", `Pick the transition into this clip (now: ${c.in}${c.inDur ? " " + c.inDur.toFixed(2) + "s" : ""})`, () => openInspector(c.n)],
    [c.badge === "10x" ? "badge: 10x → 1x" : c.badge === "1x" ? "badge: 1x → off" : "badge: off → 10x", "Cycle the corner speed badge drawn over this clip: 10x, 1x, off", () => edit({ op: "badge", n: c.n, badge: c.badge === "10x" ? "1x" : c.badge === "1x" ? null : "10x" }, `clip ${c.n} badge ${c.badge === "10x" ? "1x" : c.badge === "1x" ? "off" : "10x"}`)],
    ["duplicate", "Put a copy of this clip right after it", () => edit({ op: "duplicate", n: c.n })],
    ["split at playhead", inside ? "Cut this clip in two at the playhead" : "Move the playhead inside this clip to split it", () => edit({ op: "split", n: c.n, at: +(t - c.start).toFixed(4) }), !inside],
    ["move earlier", "Swap this clip with the one before it (Alt-↑)", () => edit({ op: "move", n: c.n, to: c.n - 1 }), c.n === 1],
    ["move later", "Swap this clip with the one after it (Alt-↓)", () => edit({ op: "move", n: c.n, to: c.n + 1 }), c.n === cur().clips.length],
    ["delete", "Remove this clip from the edit (Delete). Undo brings it back", () => edit({ op: "delete", n: c.n }), cur().clips.length === 1, "del"],
  ];
  menu.innerHTML = `<div class="mh">clip ${c.n} · ${esc(c.text).slice(0, 28)}</div>`;
  for (const [label, tip, fn, off, cls] of items) {
    const b = document.createElement("button");
    b.textContent = label; b.title = tip; b.disabled = !!off; if (cls) b.className = cls;
    b.onclick = () => { closeMenu(); fn(); };
    menu.appendChild(b);
  }
  menu.classList.add("open");
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x)) + "px";
  menu.style.top = Math.max(8, Math.min(innerHeight - r.height - 8, y - r.height - 10)) + "px";
}
function closeMenu() { menu.classList.remove("open"); }
addEventListener("pointerdown", (e) => { if (!menu.contains(e.target) && e.target !== cv) closeMenu(); });

// ---------------------------------------------------------------- notes: feedback for Claude
const key = () => "reel.notes." + sel;
function marks() {
  let m; try { m = JSON.parse(localStorage.getItem(key()) || "null"); } catch {}
  return m || { notes: [], comment: "" };
}
const save = (m) => { try { localStorage.setItem(key(), JSON.stringify(m)); } catch {} };
function addNote(t0, t1) {
  const text = prompt(`Note for Claude at ${t0.toFixed(2)}s${t1 != null ? `–${t1.toFixed(2)}s` : ""}:`);
  if (!text?.trim()) return;
  const m = marks(); m.notes.push({ t: t0, t1: t1 ?? null, text: text.trim() }); save(m); renderNotes(); draw();
}
function renderNotes() {
  const m = marks();
  $("items").innerHTML = "";
  m.notes.forEach((n, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<b>n${i + 1}</b><span title="Jump to this note">${n.t.toFixed(2)}s${n.t1 != null ? "–" + n.t1.toFixed(2) + "s" : ""} ${esc(n.text)}</span><button title="Remove this note">✕</button>`;
    li.querySelector("span").onclick = () => seek(n.t, true);
    li.querySelector("button").onclick = () => { m.notes.splice(i, 1); save(m); renderNotes(); draw(); };
    $("items").appendChild(li);
  });
  $("comment").value = m.comment;
}
$("comment").oninput = () => { const m = marks(); m.comment = $("comment").value; save(m); };
$("send").onclick = async () => {
  const m = marks();
  const r = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: sel, ...m }) });
  const j = await r.json();
  $("sent").textContent = r.ok ? `sent ${j.summary}. Tell Claude to "check the feedback".` : `failed: ${j.error}`;
};

// ---------------------------------------------------------------- keyboard
addEventListener("keydown", (e) => {
  if (/^(TEXTAREA|INPUT)$/.test(e.target.tagName) || !cur()) return;
  const tr = cur(), mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === "y") { e.preventDefault(); redo(); return; }
  if (mod) return;
  if (e.key === "Escape") { closeMenu(); if (drag) { drag = undefined; draw(); } return; }
  if (e.key === " ") { e.preventDefault(); toggle(); }
  else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    const c = selected(); if (!c || !canEdit()) return;
    const to = c.n + (e.key === "ArrowUp" ? -1 : 1);
    if (to >= 1 && to <= tr.clips.length) { selN = to; edit({ op: "move", n: c.n, to }); }
  } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") { vid.pause(); setShuttle(0); seek(Math.round(t * tr.fps) / tr.fps + (e.key === "ArrowRight" ? 1 : -1) / tr.fps, true); }
  else if (e.key === "." || e.key === ",") {
    vid.pause();
    const starts = tr.clips.map((c) => c.start);
    const nt = e.key === "." ? starts.find((s) => s > t + 1e-3) : [...starts].reverse().find((s) => s < t - 1e-3);
    if (nt !== undefined) seek(nt, true);
  } else if (k === "l") setShuttle(shuttle > 0 ? Math.min(8, shuttle * 2) : 1);
  else if (k === "k") setShuttle(0);
  else if (k === "j") setShuttle(shuttle < 0 ? Math.max(-8, shuttle * 2) : -1);
  else if ((k === "i" || k === "o") && canEdit()) {
    // trim the clip under the playhead so it starts (I) or ends (O) here
    const c = clipAtT(tr, t); if (!c) return;
    const off = t - c.start;
    if (k === "o") { if (off >= 1 / tr.fps) edit({ op: "trim", n: c.n, dur: +off.toFixed(4) }, `clip ${c.n} out point set`); }
    else if (off >= 1 / tr.fps && c.dur - off >= 1 / tr.fps) {
      const body = { op: "trim", n: c.n, dur: +(c.dur - off).toFixed(4) };
      if (c.kind === "shot") body.from = +((c.from ?? 0) + off).toFixed(4);
      edit(body, `clip ${c.n} in point set`);
    }
  } else if ((e.key === "Delete" || e.key === "Backspace") && canEdit()) {
    const c = selected(); if (c && tr.clips.length > 1) { e.preventDefault(); edit({ op: "delete", n: c.n }); }
  } else if (k === "n") addNote(t);
});

// ---------------------------------------------------------------- list + tabs + sheet
function renderList() {
  $("list").innerHTML = "";
  for (const tr of state?.trailers ?? []) {
    const row = document.createElement("div");
    row.className = "row" + (tr.name === sel ? " sel" : "");
    row.title = `Open trailer ${tr.name}`;
    row.innerHTML = `<span class="nm">${esc(tr.name)}</span><span class="d">${tr.dur ? tr.dur.toFixed(1) + "s" : ""}</span>${tr.error ? '<span class="dot"></span>' : ""}`;
    row.onclick = () => { sel = tr.name; try { localStorage.setItem("reel.sel", sel); } catch {} proxyKey = ""; t = 1; zoom = 1; view0 = 0; selN = 0; update(); };
    $("list").appendChild(row);
  }
}
function showTab(name) {
  for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("on", b.dataset.tab === name);
  for (const p of document.querySelectorAll(".panel")) p.classList.toggle("on", p.id === "p-" + name);
  if (name === "music") loadMedia();
}
for (const b of document.querySelectorAll("#tabs button")) b.onclick = () => showTab(b.dataset.tab);
// Desktop shows the media bin on the left; narrower layouts keep it as a tab.
const wide = () => matchMedia("(min-width: 1100px)").matches;
function placeMedia() {
  const box = $("addbox"), want = wide() ? $("bin") : $("addsheet");
  if (box.parentElement !== want) want.appendChild(box);
  if (wide()) $("addsheet").classList.remove("open");
}
// Bottom sheet (phone/tablet portrait): swipe the handle up to open, down to close.
const openSheet = () => { if (!wide()) document.body.classList.add("sheet"); };
let sheetY;
$("grab").addEventListener("pointerdown", (e) => { sheetY = e.clientY; $("grab").setPointerCapture(e.pointerId); });
$("grab").addEventListener("pointerup", (e) => {
  if (sheetY == null) return;
  const dy = e.clientY - sheetY; sheetY = undefined;
  if (dy < -30) document.body.classList.add("sheet");
  else if (dy > 30) document.body.classList.remove("sheet");
  else document.body.classList.toggle("sheet");
});

// ---------------------------------------------------------------- edits, undo/redo, toast
const opText = (b) => ({
  title: `clip ${b.n} title edited`, trans: `clip ${b.n} transition: ${b.type}`, music: "music changed", badge: `clip ${b.n} badge`,
  move: `clip ${b.n} moved to ${b.to}`, delete: `clip ${b.n} deleted`, trim: `clip ${b.n} trimmed`,
  duplicate: `clip ${b.n} duplicated`, split: `clip ${b.n} split`, insert: `clip added at ${b.at}`,
})[b.op] ?? "edited";
let toastTimer;
function toast(msg, opts = {}) {
  $("toastmsg").textContent = msg;
  $("toast").classList.toggle("bad", !!opts.bad);
  $("toastundo").style.display = opts.undo ? "" : "none";
  $("toastredo").style.display = opts.redo ? "" : "none";
  $("toast").classList.add("open");
  clearTimeout(toastTimer);
  if (opts.bad) toastTimer = setTimeout(() => $("toast").classList.remove("open"), 6000);
}
$("toastx").onclick = () => $("toast").classList.remove("open");
$("toastundo").onclick = () => undo();
$("toastredo").onclick = () => redo();
async function post(path, body) {
  vid.pause(); setShuttle(0);
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) toast(`${path === "/api/edit" ? "edit" : path.slice(5)} failed: ${j.error ?? r.status}`, { bad: true });
  return r.ok ? j : null;
}
// Optimistic: reshape the strip at once; the server's rebuild replaces it when it lands.
let pending = 0, snapshot;
function local(body) {
  const tr = cur(); if (!tr) return;
  const cs = tr.clips.map((c) => ({ ...c })), i = body.n - 1, c = cs[i];
  if (body.op === "move" && c) { cs.splice(i, 1); cs.splice(Math.max(0, Math.min(cs.length, body.to - 1)), 0, c); }
  else if (body.op === "delete" && c) cs.splice(i, 1);
  else if (body.op === "duplicate" && c) cs.splice(i + 1, 0, { ...c });
  else if (body.op === "split" && c) { const a = { ...c, dur: body.at }, b = { ...c, dur: c.dur - body.at, in: "cut", inDur: 0, from: c.from != null ? c.from + body.at * (c.speed ?? 1) : c.from }; cs.splice(i, 1, a, b); }
  else if ((body.op === "trim" || body.op === "title") && c) { if (body.dur) c.dur = body.dur; if (body.from != null) c.from = body.from; if (body.text) c.text = `title "${body.text}"`; }
  else if (body.op === "insert") cs.splice(Math.max(0, Math.min(cs.length, body.at - 1)), 0, { kind: "shot", text: `shot ${body.file}`, dur: body.dur, in: "cut", inDur: 0, start: 0 });
  else return;
  let s = 0; cs.forEach((x, k) => { x.n = k + 1; x.start = s; s += x.dur; });
  snapshot ??= JSON.stringify(state);
  tr.clips = cs; tr.dur = s; tr.local = true;
  thumbsLocal = true;
  renderClips(); draw();
}
let thumbsLocal = false;
function chip() {
  const tr = cur(), p = tr?.proxy, el = $("rchip");
  const txt = pending ? "saving edit…" : p?.state === "rendering" ? `rendering ${Math.round(p.progress * 100)}%` : p?.state === "waiting" ? "rendering…" : "";
  el.textContent = txt; el.classList.toggle("on", !!txt);
}
async function edit(body, msg) {
  if (!canEdit()) return;
  pending++; local(body); chip();
  const ok = await post("/api/edit", body);
  pending--;
  if (!ok && snapshot) { state = JSON.parse(snapshot); snapshot = undefined; update(); }
  chip();
  if (ok) {
    if (body.op === "move") selN = body.to; else if (body.op === "duplicate" || body.op === "split") selN = body.n + 1;
    toast(msg ?? opText(body), { undo: true });
  }
}
async function undo() { const j = state?.undo && (await post("/api/undo")); if (j) toast("undone", { redo: true, undo: j.undo > 0 }); }
async function redo() { if (state?.redo && (await post("/api/redo"))) toast("redone", { undo: true }); }
$("undo").onclick = undo;
$("redo").onclick = redo;

// ---------------------------------------------------------------- inspector: clip rows (button fallback)
function renderClips() {
  renderInspector(); renderMusic();
  const tr = cur(), ul = $("clips");
  ul.innerHTML = "";
  $("undo").disabled = !state?.editable || !state.undo;
  $("redo").disabled = !state?.editable || !state.redo;
  $("edithint").textContent = state?.editable ? "Drag clips on the timeline, or use ✎ trim · ↑ ↓ move · ⧉ duplicate · ✕ delete. Changes save to the .otio and re-render." : "Read only: serve the .otio file to edit.";
  if (!tr || tr.error) return;
  const now = clipAtT(tr, t);
  for (const c of tr.clips) {
    const li = document.createElement("li");
    if ((selN || now?.n) === c.n) li.className = "on";
    const last = c.n === tr.clips.length, ro = !state.editable;
    li.innerHTML = `<span class="k">${c.n}</span><span class="tx" title="Jump to clip ${c.n}">${esc(c.text)}</span><span class="d">${c.dur.toFixed(1)}s</span><span class="btns">` +
      `<button ${ro ? "disabled" : ""} title="Trim: set exact start and length">✎</button><button ${ro || c.n === 1 ? "disabled" : ""} title="Move earlier">↑</button><button ${ro || last ? "disabled" : ""} title="Move later">↓</button><button ${ro ? "disabled" : ""} title="Duplicate: copy right after">⧉</button><button class="del" ${ro || tr.clips.length === 1 ? "disabled" : ""} title="Delete this clip (undo brings it back)">✕</button></span>`;
    const [tb, up, dn, dup, del] = li.querySelectorAll("button");
    tb.onclick = () => { trimOpen = trimOpen === c.n ? 0 : c.n; renderClips(); };
    li.querySelector(".tx").onclick = () => { selN = c.n; seek(c.start + Math.min(0.5, c.dur / 2), true); renderClips(); };
    up.onclick = () => edit({ op: "move", n: c.n, to: c.n - 1 });
    dn.onclick = () => edit({ op: "move", n: c.n, to: c.n + 1 });
    dup.onclick = () => edit({ op: "duplicate", n: c.n });
    del.onclick = () => edit({ op: "delete", n: c.n });
    ul.appendChild(li);
    if (trimOpen === c.n) {
      const row = document.createElement("li");
      row.className = "trim";
      const shot = c.kind === "shot";
      const strip = shot && c.srcDur > 0;
      row.innerHTML = (strip ? `<div style="width:100%"><div class="strip" id="strip" title="Source filmstrip: drag the amber handles to set the in and out points, or drag the lit part to slide the clip through its source"></div><div class="striplbl"><span>0s</span><span id="striptxt"></span><span>${c.srcDur.toFixed(1)}s</span></div></div>` : "") +
        (shot ? `<label title="Where in the source media this clip starts">start ${stepper("tr-from", c.from ?? 0, 0.1, 0, "start in source")}</label>` : "") +
        `<label title="How long the clip plays">length ${stepper("tr-dur", c.dur, 0.1, 1 / (tr.fps || 30), "clip length")}</label><button class="primary" title="Save this trim">apply</button>`;
      row.querySelector("button.primary").onclick = () => {
        const body = { op: "trim", n: c.n, dur: Number($("tr-dur").value) };
        if (shot) body.from = Number($("tr-from").value);
        trimOpen = 0;
        edit(body);
      };
      wireSteppers(row);
      if (strip) setTimeout(() => filmstrip(c), 0);
      ul.appendChild(row);
    }
  }
}

// ---------------------------------------------------------------- −/+ steppers (instead of spinners)
function stepper(id, v, step, min, what) {
  return `<span class="step"><button type="button" data-step="-${step}" data-for="${id}" title="Decrease the ${what} by ${step}s">−</button>` +
    `<input type="text" inputmode="decimal" id="${id}" value="${Number(v).toFixed(2)}" data-min="${min}" title="The ${what} in seconds"><button type="button" data-step="${step}" data-for="${id}" title="Increase the ${what} by ${step}s">+</button></span>`;
}
function wireSteppers(root) {
  for (const b of root.querySelectorAll("button[data-step]")) b.onclick = () => {
    const inp = $(b.dataset.for), min = Number(inp.dataset.min || 0);
    inp.value = Math.max(min, (Number(inp.value) || 0) + Number(b.dataset.step)).toFixed(2);
    inp.dispatchEvent(new Event("input"));
  };
}
// ---------------------------------------------------------------- trim filmstrip
function filmstrip(c) {
  const el = $("strip"); if (!el) return;
  const W = el.clientWidth, n = Math.max(4, Math.round(W / 80)), D = c.srcDur, sp = c.speed ?? 1, fps = cur().fps || 30;
  const frames = [];
  for (let k = 0; k < n; k++) frames.push(`<img alt="" draggable="false" src="/api/srcframe?name=${encodeURIComponent(sel)}&n=${c.n}&t=${((k + 0.5) * D / n).toFixed(2)}&w=160" style="left:${(k / n) * 100}%;width:${100 / n + 0.2}%">`);
  el.innerHTML = frames.join("") + `<div class="selr"></div><div class="hdl" data-h="in" title="In point: drag to change where the clip starts in its source"></div><div class="hdl" data-h="out" title="Out point: drag to change where the clip ends"></div>`;
  const selr = el.querySelector(".selr"), [hin, hout] = el.querySelectorAll(".hdl");
  let from = Number($("tr-from").value), len = Number($("tr-dur").value) * sp;
  const px = (s) => (s / D) * W;
  const paint = () => {
    selr.style.left = px(from) + "px"; selr.style.width = Math.max(2, px(len)) + "px";
    hin.style.left = px(from) + "px"; hout.style.left = px(from + len) + "px";
    $("striptxt").textContent = `${from.toFixed(2)}–${(from + len).toFixed(2)}s`;
  };
  const sync = () => { $("tr-from").value = from.toFixed(2); $("tr-dur").value = (len / sp).toFixed(2); paint(); };
  $("tr-from").oninput = () => { from = Math.max(0, Math.min(D - 1 / fps, Number($("tr-from").value) || 0)); paint(); };
  $("tr-dur").oninput = () => { len = Math.max(1 / fps, (Number($("tr-dur").value) || 0) * sp); paint(); };
  let dr;
  el.onpointerdown = (e) => {
    const h = e.target.closest(".hdl")?.dataset.h ?? (e.target.closest(".selr") ? "move" : null);
    if (!h) return;
    dr = { h, x0: e.clientX, from, len }; el.setPointerCapture(e.pointerId); e.preventDefault();
  };
  el.onpointermove = (e) => {
    if (!dr) return;
    const ds = ((e.clientX - dr.x0) / W) * D, min = 1 / fps;
    if (dr.h === "in") { const end = dr.from + dr.len; from = Math.max(0, Math.min(end - min, dr.from + ds)); len = end - from; }
    else if (dr.h === "out") len = Math.max(min, Math.min(D - dr.from, dr.len + ds));
    else from = Math.max(0, Math.min(D - dr.len, dr.from + ds));
    sync();
  };
  el.onpointerup = el.onpointercancel = () => { dr = undefined; };
  paint();
}

// ---------------------------------------------------------------- add-clip picker: search, folders, preview
let mediaFiles = [], addFolder = "all", addPick;
let mediaLoaded = false;
async function loadMedia(force) {
  if (mediaLoaded && !force) return renderPicker();
  mediaLoaded = true;
  const files = await (await fetch("/api/media")).json().catch(() => []);
  audioFiles = files.filter((f) => f.audio);
  mediaFiles = files.filter((f) => !f.audio);
  renderMusic();
  renderPicker();
}
function renderPicker() {
  const dirs = ["all", ...new Set(mediaFiles.map((f) => f.dir))];
  $("addfolders").innerHTML = dirs.length > 2 ? dirs.map((d) => `<button data-d="${esc(d)}" class="${d === addFolder ? "on" : ""}" title="${d === "all" ? "Show files from every media folder" : "Show only files in " + esc(d)}">${esc(d)}</button>`).join("") : "";
  for (const b of $("addfolders").querySelectorAll("button")) b.onclick = () => { addFolder = b.dataset.d; renderPicker(); };
  const q = $("addq").value.trim().toLowerCase();
  const list = mediaFiles.filter((f) => (addFolder === "all" || f.dir === addFolder) && (!q || f.name.toLowerCase().includes(q)));
  const pk = $("picker");
  pk.innerHTML = "";
  for (const f of list) {
    const fig = document.createElement("figure");
    fig.title = `Preview ${f.name}, then insert it as a 3 s shot`;
    if (addPick && addPick.name === f.name && addPick.dir === f.dir) fig.className = "on";
    fig.innerHTML = `<img loading="lazy" alt="" src="/api/thumb?d=${encodeURIComponent(f.dir)}&f=${encodeURIComponent(f.name)}"><figcaption>${esc(f.dir)}/${esc(f.name)}</figcaption>`;
    fig.onclick = () => { addPick = f; renderPicker(); preview(); };
    pk.appendChild(fig);
  }
  if (!addPick) $("pickhint").textContent = !state?.editable ? "Read only: serve the .otio file to add clips." : list.length ? "Tap a file to preview it, then insert." : mediaFiles.length ? "No file matches the search." : "No media files found next to the edit.";
}
$("addq").oninput = () => renderPicker();
function preview() {
  const f = addPick, box = $("addprev"); if (!f) return;
  const now = clipAtT(cur(), t), at = now ? now.n + 1 : 1;
  const src = `/api/mediafile?d=${encodeURIComponent(f.dir)}&f=${encodeURIComponent(f.name)}`;
  const still = /\.(png|jpe?g|gif)$/i.test(f.name);
  box.innerHTML = (still ? `<img alt="" src="${src}">` : `<video muted playsinline autoplay preload="auto" src="${src}"></video>`) +
    `<div class="rowf"><span class="hint" style="flex:1">${esc(f.dir)}/${esc(f.name)}</span><button class="primary" id="addgo" title="Insert this file as a 3 s shot after clip ${at - 1 || "start"}" ${canEdit() ? "" : "disabled"}>insert after clip ${at - 1 || "start"}</button></div>`;
  const v = box.querySelector("video");
  if (v) {
    // play a few seconds from 40% in, on a loop
    let a = 0;
    v.onloadedmetadata = () => { a = (v.duration || 0) * 0.4; v.currentTime = a; v.play().catch(() => {}); };
    v.ontimeupdate = () => { if (v.currentTime > a + 3) v.currentTime = a; };
  }
  $("addgo").onclick = () => { edit({ op: "insert", at, file: f.name, dir: f.dir, dur: 3 }); closeAdd(); };
}
function closeAdd() { $("addsheet").classList.remove("open"); const v = $("addprev").querySelector("video"); if (v) v.pause(); if (!wide()) { addPick = undefined; $("addprev").innerHTML = `<div class="hint" id="pickhint"></div>`; } }
$("addclose").onclick = closeAdd;
$("addsheet").addEventListener("pointerdown", (e) => { if (e.target === $("addsheet")) closeAdd(); });
$("addbtn").onclick = () => { loadMedia(); if (wide()) $("addq").focus(); else $("addsheet").classList.add("open"); };
function renderMediaHint() { if (!addPick) renderPicker(); }

// ---------------------------------------------------------------- render full (opt-in, one at a time)
function renderFull() {
  const f = state?.full, el = $("fullinfo"), b = $("renderfull");
  const busy = f && (f.state === "rendering" || f.state === "publishing");
  b.disabled = !!busy || !cur() || !!cur().error;
  if (!f) { el.textContent = ""; return; }
  if (f.state === "rendering") el.textContent = `full render ${Math.round(f.progress * 100)}%`;
  else if (f.state === "publishing") el.textContent = "publishing…";
  else if (f.state === "failed") el.innerHTML = `<span style="color:var(--bad)">full render failed: ${esc(f.error ?? "")}</span>`;
  else el.innerHTML = `${esc(f.note ?? "done")}${f.url ? ` <a href="${esc(f.url)}" target="_blank" rel="noopener" title="Open the rendered MP4 in the Screens gallery">gallery</a>` : ""}${f.video ? ` <a href="${esc(f.video)}" target="_blank" rel="noopener" title="Play the published full-resolution MP4">video</a>` : ""}${f.file ? ` <a href="/api/full?f=${encodeURIComponent(f.file)}" title="Download the full-resolution MP4">download</a>` : ""}`;
}
$("renderfull").onclick = async () => {
  if (!cur()) return;
  const r = await fetch(`/api/render?name=${encodeURIComponent(sel)}`, { method: "POST" });
  if (!r.ok) { const j = await r.json().catch(() => ({})); toast(`render failed: ${j.error ?? r.status}`, { bad: true }); }
};

// ---------------------------------------------------------------- inspector: title, transition, badge
const TRANS = [["cut", "Hard cut, no blend"], ["fade", "Cross-fade from the previous clip"], ["dip", "Dip through a colour (black) between clips"], ["flash", "A white flash on the cut"], ["wipe", "Wipe across from the previous clip"], ["slide", "The new clip slides in from a side"], ["zoom", "Zoom through into the new clip"]];
const FIRST_OK = ["cut", "flash", "dip", "slide", "zoom"];
const TDEF = { cut: 0, fade: 0.5, dip: 0.6, flash: 0.25, wipe: 0.4, slide: 0.4, zoom: 0.5 };
let draftTrans; // { n, type, version } picked but not applied yet
function openInspector(n) { selN = n; showTab("clip"); openSheet(); renderClips(); draw(); }
function renderInspector() {
  const box = $("insp"), tr = cur(), c = selected();
  if (!tr || tr.error || !c) { box.innerHTML = `<div class="hint">Select a clip on the timeline.</div>`; return; }
  if (box.contains(document.activeElement) && document.activeElement.tagName === "INPUT" && box.dataset.key === `${c.n}|${state.version}`) return;
  box.dataset.key = `${c.n}|${state.version}`;
  const ro = !state.editable ? "disabled" : "";
  if (draftTrans && (draftTrans.n !== c.n || draftTrans.version !== state.version)) draftTrans = undefined;
  const ty = draftTrans?.type ?? c.in;
  let h = `<h3>clip ${c.n} <span class="hint" style="text-transform:none;letter-spacing:0">${esc(c.text)}</span></h3>`;
  if (c.kind === "title") h += `<div class="sec"><h3>title</h3>
    <label class="fld" title="The big title text">text<input type="text" id="it-text" value="${esc(c.title ?? "")}" ${ro}></label>
    <label class="fld" title="Smaller line under the title; leave empty for none">sub line<input type="text" id="it-sub" value="${esc(c.sub ?? "")}" placeholder="(none)" ${ro}></label>
    <div class="rowf"><label class="fld" title="How long the title stays on screen">length (s)${stepper("it-dur", c.dur, 0.1, 0.1, "title length")}</label>
    <button class="primary" id="it-apply" title="Save the title text, sub line and length" ${ro}>apply title</button></div></div>`;
  h += `<div class="sec"><h3>transition in</h3><div class="seg" id="it-trans">` +
    TRANS.map(([k, tip]) => `<button data-t="${k}" class="${k === ty ? "on" : ""}" title="${tip}${c.n === 1 && !FIRST_OK.includes(k) ? " (not on the first clip)" : ""}" ${ro || (c.n === 1 && !FIRST_OK.includes(k)) ? "disabled" : ""}>${k}</button>`).join("") + `</div>
    <div class="rowf">${ty === "cut" ? "" : `<label class="fld" title="Transition length in seconds">duration (s)${stepper("it-tdur", ty === c.in ? c.inDur : TDEF[ty], 0.05, 0.01, "transition length")}</label>`}
    <label class="fld" title="Side the new clip slides in from" style="${ty === "slide" ? "" : "display:none"}">from<select id="it-dir" ${ro}>${["left", "right", "up", "down"].map((d) => `<option ${d === (c.inDir ?? "left") ? "selected" : ""}>${d}</option>`).join("")}</select></label>
    <button class="primary" id="it-tapply" title="Save the transition into this clip" ${ro}>apply transition</button></div></div>`;
  h += `<div class="sec"><h3>speed badge</h3><div class="seg" id="it-badge">` +
    [["", "off", "No badge"], ["1x", "1x", "Show a 1x badge in the top-right corner"], ["10x", "10x", "Show a 10x badge in the top-right corner (sped-up footage)"]]
      .map(([v, l, tip]) => `<button data-b="${v}" class="${(c.badge ?? "") === v ? "on" : ""}" title="${tip}" ${ro}>${l}</button>`).join("") + `</div>
    <div class="hint">A grey plate with white text, drawn over the clip in the render.</div></div>`;
  box.innerHTML = h;
  wireSteppers(box);
  if (c.kind === "title") $("it-apply").onclick = () => {
    const body = { op: "title", n: c.n, dur: Number($("it-dur").value) };
    if ($("it-text").value !== c.title) body.text = $("it-text").value;
    if ($("it-sub").value !== (c.sub ?? "")) body.sub = $("it-sub").value || null;
    edit(body, `clip ${c.n} title edited`);
  };
  for (const b of box.querySelectorAll("#it-trans button")) b.onclick = () => { draftTrans = { n: c.n, type: b.dataset.t, version: state.version }; box.dataset.key = ""; renderInspector(); };
  $("it-tapply").onclick = () => {
    const body = { op: "trans", n: c.n, type: ty };
    if (ty !== "cut") body.dur = Number($("it-tdur").value);
    if (ty === "slide") body.dir = $("it-dir").value;
    draftTrans = undefined;
    edit(body, `clip ${c.n} transition: ${ty}`);
  };
  for (const b of box.querySelectorAll("#it-badge button")) b.onclick = () => edit({ op: "badge", n: c.n, badge: b.dataset.b || null }, `clip ${c.n} badge ${b.dataset.b || "off"}`);
}
// ---------------------------------------------------------------- music panel
let audioFiles = [], musicPick;
function renderMusic() {
  const box = $("musicbox"), tr = cur();
  if (!tr || tr.error) { box.innerHTML = ""; return; }
  if (box.contains(document.activeElement) && document.activeElement.type === "range") return;
  const ro = !state.editable ? "disabled" : "", curName = tr.musicSrc ?? "";
  const pick = musicPick ?? curName;
  const vol = tr.musicVol ?? 1;
  box.innerHTML = `<h3>music</h3><div class="hint" style="margin-bottom:8px">Now: ${tr.musicSrc ? esc(tr.musicSrc) + " at " + Math.round(vol * 100) + "%" : "no music"}</div>
    <div class="tracks">` +
    `<button data-f="" class="${pick === "" ? "on" : ""}" title="No music track" ${ro}>none</button>` +
    audioFiles.map((f) => `<button data-f="${esc(f.name)}" data-d="${esc(f.dir)}" class="${pick === f.name ? "on" : ""}" title="Use ${esc(f.name)} as the trailer's music" ${ro}>♪ ${esc(f.dir)}/${esc(f.name)}</button>`).join("") +
    (audioFiles.length ? "" : `<div class="hint">No audio files (wav, mp3, ogg, m4a) found in the media folders.</div>`) + `</div>
    <label class="fld" title="Music volume: 100% is as recorded">volume <span id="m-vl">${Math.round(vol * 100)}%</span><input type="range" id="m-vol" min="0" max="200" step="5" value="${Math.round(vol * 100)}" ${ro}></label>
    <button class="primary" id="m-apply" title="Save the music track and volume" ${ro}>apply music</button>`;
  for (const b of box.querySelectorAll(".tracks button")) b.onclick = () => { musicPick = b.dataset.f; musicDir = b.dataset.d; renderMusic(); };
  $("m-vol").oninput = () => ($("m-vl").textContent = $("m-vol").value + "%");
  $("m-apply").onclick = () => {
    const v = Number($("m-vol").value) / 100;
    if (pick === "") { if (tr.musicSrc) edit({ op: "music", src: null }, "music removed"); musicPick = undefined; return; }
    const body = { op: "music", vol: v };
    if (pick !== curName) { const f = audioFiles.find((x) => x.name === pick && (!musicDir || x.dir === musicDir)); body.file = f.name; body.dir = f.dir; }
    musicPick = undefined;
    edit(body, pick !== curName ? `music: ${pick}` : `music volume ${Math.round(v * 100)}%`);
  };
}
let musicDir;

// ---------------------------------------------------------------- build events
function update() {
  renderList();
  renderClips();
  const tr = cur(), err = state?.error ?? tr?.error;
  $("err").style.display = err ? "block" : "none";
  $("err").textContent = err?.message ?? "";
  if (!tr) return;
  document.body.style.setProperty("--ar", `${tr.w} / ${tr.h}`);
  document.body.classList.toggle("nomusic", !tr.music);
  $("report").textContent = tr.report;
  if (selN > tr.clips.length) selN = 0;
  const p = tr.proxy;
  $("proxy").textContent = p.state === "rendering" ? `proxy ${Math.round(p.progress * 100)}%` : p.state === "ready" ? "proxy ready" : p.state === "failed" ? "proxy failed" : "proxy …";
  $("proxy").className = "pill " + (p.state === "failed" ? "bad" : "");
  if (p.state === "failed" && p.error && !err) { $("err").style.display = "block"; $("err").textContent = p.error; }
  const k = `${tr.name}|${p.version}`;
  if (p.state === "ready" && proxyKey !== k) {
    proxyKey = k;
    vid.src = `/api/proxy?name=${encodeURIComponent(tr.name)}&v=${p.version}`;
    vid.onloadeddata = () => { vid.currentTime = t; $("stage").classList.remove("still"); };
  } else if (p.state !== "ready") { vid.pause(); showStill(); }
  if (t > tr.dur) t = Math.max(0, tr.dur - 1 / tr.fps);
  chip(); renderFull();
  clampView();
  renderNotes();
  renderMediaHint();
  draw();
}

placeMedia();
loadMedia();
const es = new EventSource("/events");
es.addEventListener("build", (e) => {
  const prev = state?.version;
  state = JSON.parse(e.data); snapshot = undefined; thumbsLocal = false;
  $("file").textContent = `${state.file}  v${state.version}  ${state.ms}ms`;
  const bad = state.error ? 1 : state.trailers.filter((x) => x.error).length;
  $("status").textContent = bad ? `${bad} error${bad > 1 ? "s" : ""}` : "ok";
  $("status").className = "pill " + (bad ? "bad" : "");
  if (!sel || !state.trailers.some((x) => x.name === sel)) sel = state.trailers[0]?.name;
  if (prev !== state.version) showStill();
  update();
});
es.onerror = () => { $("status").textContent = "disconnected"; $("status").className = "pill bad"; };
// for proof scripts
window.reelViewer = { openMenuAt: (n) => { const c = cur()?.clips.find((c) => c.n === n); if (c) { const r = cv.getBoundingClientRect(); selN = n; draw(); openMenu(c, r.left + xOf(c.start + c.dur / 2), r.top + CY); } } };
