// reel live viewer. Plain browser JS, no build step.
const $ = (id) => document.getElementById(id);
const vid = $("vid"), still = $("still"), cv = $("tl"), g = cv.getContext("2d");
let state, sel = localStorage.getItem("reel.sel") || undefined, t = 0, proxyKey = "";

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const cur = () => state?.trailers.find((x) => x.name === sel);
const ready = () => cur()?.proxy.state === "ready";

// ---------------------------------------------------------------- picture
// The proxy video plays with sound; while it isn't ready (or when stepping), the server's exact
// composed frame is shown instead.
let stillTimer;
function showStill() {
  const tr = cur(); if (!tr || tr.error) return;
  clearTimeout(stillTimer);
  stillTimer = setTimeout(() => { still.src = `/api/frame?name=${encodeURIComponent(tr.name)}&t=${t.toFixed(4)}&w=960&v=${state.version}`; }, 40);
  $("stage").classList.add("still");
}
function seek(nt, exact) {
  const tr = cur(); if (!tr) return;
  t = Math.max(0, Math.min(tr.dur - 1 / tr.fps, nt));
  if (ready() && !exact) { vid.currentTime = t; $("stage").classList.remove("still"); }
  else showStill();
  draw();
}
function toggle() {
  if (!ready()) return;
  if (vid.paused) { vid.currentTime = t; $("stage").classList.remove("still"); vid.play(); } else vid.pause();
}
vid.ontimeupdate = () => { if (!vid.paused) { t = vid.currentTime; draw(); } };
vid.onplay = () => ($("play").textContent = "❚❚ pause");
vid.onpause = () => ($("play").textContent = "▶ play");
$("play").onclick = toggle;

// ---------------------------------------------------------------- timeline strip
const PAD = 8;
const xOf = (s) => PAD + (s / cur().dur) * (cv.clientWidth - PAD * 2);
const tOf = (px) => ((px - PAD) / (cv.clientWidth - PAD * 2)) * cur().dur;
function draw() {
  const tr = cur(), dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  $("time").textContent = `${t.toFixed(2)}s  frame ${tr ? Math.round(t * tr.fps) : 0}`;
  if (!tr || tr.error || !tr.dur) return;
  g.font = "11px ui-monospace, monospace";
  for (const c of tr.clips) {
    const x0 = xOf(c.start), x1 = xOf(c.start + c.dur);
    g.fillStyle = c.kind === "title" ? "#4a3a6a" : "#2d4a5a"; g.fillRect(x0, 6, Math.max(1, x1 - x0 - 1), 26);
    if (c.inDur) { g.fillStyle = "#ffb454"; g.fillRect(x0, 32, xOf(c.start + c.inDur) - x0, 3); }
    g.fillStyle = "#e8e4f0"; if (x1 - x0 > 14) g.fillText(String(c.n), x0 + 3, 23);
  }
  if (tr.bpm) for (let s = tr.beat0, b = 0; s <= tr.dur; s += 60 / tr.bpm, b++) {
    g.strokeStyle = `rgba(255,255,255,${b % 4 ? 0.1 : 0.3})`; g.beginPath(); g.moveTo(xOf(s), 38); g.lineTo(xOf(s), h - 6); g.stroke();
  }
  if (tr.music) {
    const y = (db) => h - 8 - Math.max(0, Math.min(1, (db + 60) / 60)) * (h - 52);
    g.strokeStyle = "#7bd88f"; g.lineWidth = 1.3; g.beginPath();
    tr.music.db.forEach((db, i) => { const x = xOf(i * tr.music.hop); i ? g.lineTo(x, y(db)) : g.moveTo(x, y(db)); });
    g.stroke(); g.lineWidth = 1;
    g.fillStyle = "#ff6b7a";
    for (const s of tr.music.hits.slice(0, 12)) { const x = xOf(s); g.beginPath(); g.moveTo(x - 4, h - 1); g.lineTo(x, h - 8); g.lineTo(x + 4, h - 1); g.fill(); }
  }
  for (const [i, n] of marks().notes.entries()) {
    g.fillStyle = "#ffb45455"; if (n.t1 != null) g.fillRect(xOf(n.t), 38, xOf(n.t1) - xOf(n.t), h - 44);
    g.fillStyle = "#ffb454"; g.fillText("n" + (i + 1), xOf(n.t) + 2, 50);
  }
  g.strokeStyle = "#ff3df0"; g.lineWidth = 2; g.beginPath(); g.moveTo(xOf(t), 0); g.lineTo(xOf(t), h); g.stroke(); g.lineWidth = 1;
  const c = [...tr.clips].reverse().find((c) => c.start <= t + 1e-6);
  if (c) $("clip").textContent = `#${c.n}  ${c.start.toFixed(2)}–${(c.start + c.dur).toFixed(2)}s  ${c.in !== "cut" ? c.in + " " + c.inDur + "s · " : ""}${c.text}  ${c.loc ?? ""}`;
}
let drag;
cv.onpointerdown = (e) => {
  if (!cur()?.dur) return;
  vid.pause(); drag = { t0: tOf(e.offsetX), shift: e.shiftKey };
  cv.setPointerCapture(e.pointerId); seek(drag.t0);
};
cv.onpointermove = (e) => { if (drag) { seek(tOf(e.offsetX)); drag.t1 = tOf(e.offsetX); } };
cv.onpointerup = () => {
  if (drag?.shift && drag.t1 !== undefined && Math.abs(drag.t1 - drag.t0) > 0.05) addNote(Math.min(drag.t0, drag.t1), Math.max(drag.t0, drag.t1));
  drag = undefined;
};
addEventListener("resize", draw);

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
    li.innerHTML = `<b>n${i + 1}</b><span>${n.t.toFixed(2)}s${n.t1 != null ? "–" + n.t1.toFixed(2) + "s" : ""} ${esc(n.text)}</span><a title="remove">×</a>`;
    li.querySelector("span").onclick = () => seek(n.t, true);
    li.lastChild.onclick = () => { m.notes.splice(i, 1); save(m); renderNotes(); draw(); };
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

addEventListener("keydown", (e) => {
  if (e.target.tagName === "TEXTAREA" || !cur()) return;
  const tr = cur();
  if (e.key === " ") { e.preventDefault(); toggle(); }
  else if (e.key === "ArrowRight" || e.key === "ArrowLeft") { vid.pause(); seek(Math.round(t * tr.fps) / tr.fps + (e.key === "ArrowRight" ? 1 : -1) / tr.fps, true); }
  else if (e.key === "." || e.key === ",") {
    vid.pause();
    const starts = tr.clips.map((c) => c.start);
    const nt = e.key === "." ? starts.find((s) => s > t + 1e-3) : [...starts].reverse().find((s) => s < t - 1e-3);
    if (nt !== undefined) seek(nt, true);
  } else if (e.key === "n") addNote(t);
});

// ---------------------------------------------------------------- list + build events
function renderList() {
  $("list").innerHTML = "";
  for (const tr of state?.trailers ?? []) {
    const row = document.createElement("div");
    row.className = "row" + (tr.name === sel ? " sel" : "");
    row.innerHTML = `<span class="nm">${esc(tr.name)}</span><span class="d">${tr.dur ? tr.dur.toFixed(1) + "s" : ""}</span>${tr.error ? '<span class="dot"></span>' : ""}`;
    row.onclick = () => { sel = tr.name; localStorage.setItem("reel.sel", sel); proxyKey = ""; t = 0; update(); };
    $("list").appendChild(row);
  }
}
function update() {
  renderList();
  const tr = cur(), err = state?.error ?? tr?.error;
  $("err").style.display = err ? "block" : "none";
  $("err").textContent = err?.message ?? "";
  if (!tr) return;
  $("stage").style.aspectRatio = `${tr.w} / ${tr.h}`;
  $("report").textContent = tr.report;
  const p = tr.proxy;
  $("proxy").textContent = p.state === "rendering" ? `proxy ${Math.round(p.progress * 100)}%` : p.state === "ready" ? "proxy ready" : p.state === "failed" ? "proxy failed" : "proxy …";
  $("proxy").className = "pill " + (p.state === "ready" ? "ok" : p.state === "failed" ? "bad" : "");
  if (p.state === "failed" && p.error && !err) { $("err").style.display = "block"; $("err").textContent = p.error; }
  const k = `${tr.name}|${p.version}`;
  if (p.state === "ready" && proxyKey !== k) {
    proxyKey = k;
    vid.src = `/api/proxy?name=${encodeURIComponent(tr.name)}&v=${p.version}`;
    vid.onloadeddata = () => { vid.currentTime = t; $("stage").classList.remove("still"); };
  } else if (p.state !== "ready") { vid.pause(); showStill(); }
  renderNotes();
  draw();
}

const es = new EventSource("/events");
es.addEventListener("build", (e) => {
  const prev = state?.version;
  state = JSON.parse(e.data);
  $("file").textContent = `${state.file}  v${state.version}  ${state.ms}ms`;
  const bad = state.error ? 1 : state.trailers.filter((x) => x.error).length;
  $("status").textContent = bad ? `${bad} error${bad > 1 ? "s" : ""}` : "ok";
  $("status").className = "pill " + (bad ? "bad" : "ok");
  if (!sel || !state.trailers.some((x) => x.name === sel)) sel = state.trailers[0]?.name;
  if (prev !== state.version) showStill();
  update();
});
es.onerror = () => { $("status").textContent = "disconnected"; $("status").className = "pill bad"; };
