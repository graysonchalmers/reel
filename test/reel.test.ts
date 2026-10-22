import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { type Img, type Sources, frameAt, image, needs, shotPlacement } from "../src/core/compose.ts";
import { loadSource } from "../src/node/load.ts";
import { probe } from "../src/node/media.ts";
import { analyzeMusic } from "../src/node/music.ts";
import { renderMp4 } from "../src/node/render.ts";
import { report } from "../src/node/report.ts";
import { serve } from "../src/node/server.ts";

const throwsMsg = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: Error) => re.test(e.message));
const dir = mkdtempSync(join(tmpdir(), "reel-"));
after(() => rmSync(dir, { recursive: true, force: true }));

/** Test media made by ffmpeg: a red still, a 2 s video that is blue then green, a 120 bpm click track. */
const ff = (...a: string[]) => assert.equal(spawnSync("ffmpeg", ["-y", "-v", "error", ...a]).status, 0);
ff("-f", "lavfi", "-i", "color=c=red:s=64x36", "-frames:v", "1", join(dir, "red.png"));
ff("-f", "lavfi", "-i", "color=c=blue:s=64x36:d=1:r=30", "-f", "lavfi", "-i", "color=c=lime:s=64x36:d=1:r=30",
  "-filter_complex", "[0][1]concat=n=2:v=1", "-pix_fmt", "yuv420p", join(dir, "bg.mp4"));
ff("-f", "lavfi", "-i", "aevalsrc='if(lt(mod(t,0.5),0.02),sin(2*PI*1000*t),0)':s=22050:d=6", join(dir, "click.wav"));

const solid = (r: number, g: number, b: number, w = 4, h = 4): Img => {
  const im = image(w, h);
  for (let i = 0; i < w * h; i++) im.data.set([r, g, b, 255], i * 4);
  return im;
};
const px = (im: Img, x: number, y: number) => Array.from(im.data.subarray((y * im.w + x) * 4, (y * im.w + x) * 4 + 3));

test("beats become frame-exact clip times", () => {
  const p = loadSource(`trailer("t", { w: 64, h: 36, fps: 30, bpm: 100 }, shot("a.png", { beats: 2 }), title("HI", { beats: 1 }), shot("a.png", { dur: 1 }))`, "t.rx.js", dir);
  const tl = p.timeline("t");
  assert.deepEqual(tl.clips.map((c) => [c.start, c.frames]), [[0, 36], [1.2, 18], [1.8, 30]]);
  assert.equal(tl.frames, 84);
  assert.equal(tl.beats[3], 1.8);
});

test("errors carry the file location and the clip path", () => {
  throwsMsg(() => loadSource(`trailer("t", {}, shot("a.png", { zom: 2 }))`, "t.rx.js"), /t\.rx\.js:1:\d+: .*shot: unknown option 'zom'/);
  throwsMsg(() => loadSource(`trailer("t", {}, shot("a.png", { move: { zoom: [1, 1.2] }, in: "fdae" }))`, "t.rx.js"), /did you mean 'fade'/);
  const p = loadSource(`trailer("t", {},\n  shot("a.png", { beats: 2 }))`, "t.rx.js");
  throwsMsg(() => p.timeline("t"), /t\.rx\.js:2:3: clip 1 \(shot a\.png\) > trailer 't'|t\.rx\.js:2:3: .*beats: 2 needs the trailer's bpm/);
  const q = loadSource(`trailer("t", { w: 64, h: 36 }, shot("missing.mp4"))`, "t.rx.js", dir);
  throwsMsg(() => report(q.timeline("t")), /no such file/);
});

test("cover keeps the frame filled and puts the focus point in the middle", () => {
  const p = loadSource(`trailer("t", {}, shot("a.png", { move: { zoom: 2, x: 0, y: 0.5 } }))`, "t.rx.js", dir);
  const d = p.trailers.get("t")!.clips[0];
  if (d.kind !== "shot") throw new Error();
  const { s, tx, ty } = shotPlacement(d, 100, 100, 200, 100, 0);
  assert.equal(s, 4);
  assert.equal(tx, 0);              // focus at the left edge, clamped so no black shows
  assert.equal(ty, -150);           // vertical focus 0.5 -> centred
});

test("transitions blend the outgoing and incoming clips", () => {
  const p = loadSource(`trailer("t", { w: 16, h: 16, fps: 10 }, shot("a.png", { dur: 1 }), shot("b.png", { dur: 1, in: fade(1) }), shot("c.png", { dur: 1, in: dip(1, "#ffffff") }))`, "t.rx.js", dir);
  const tl = p.timeline("t");
  const colors: Record<string, Img> = { "a.png": solid(255, 0, 0), "b.png": solid(0, 0, 255), "c.png": solid(0, 255, 0) };
  const src: Sources = { shot: (c) => colors[(c.def as { src: string }).src.replace(/^.*\//, "")], text: () => image(1, 1) };
  assert.deepEqual(needs(tl, 1.5).map((n) => n.clip.i), [1, 0]);
  const mid = px(frameAt(tl, 1.5, src), 4, 4);
  assert.ok(Math.abs(mid[0] - 128) < 3 && Math.abs(mid[2] - 128) < 3, `fade midpoint ${mid}`);
  assert.deepEqual(px(frameAt(tl, 2.5, src), 4, 4), [255, 255, 255]);   // dip peak
  assert.deepEqual(px(frameAt(tl, 0.5, src), 4, 4), [255, 0, 0]);
});

test("music analysis finds the tempo and the clicks", () => {
  const mi = analyzeMusic({ src: join(dir, "click.wav"), from: 0, vol: 1, fadeOut: 0 }, 6);
  assert.ok(mi.bpm && Math.abs(mi.bpm - 120) <= 1.5, `bpm ${mi.bpm}`);
  for (const h of mi.hits.slice(0, 6)) assert.ok(Math.abs(h.t / 0.5 - Math.round(h.t / 0.5)) < 0.1, `hit ${h.t} off the 0.5 s grid`);
});

test("the report checks beat alignment and source length", () => {
  const p = loadSource(`trailer("t", { w: 64, h: 36, bpm: 120, music: "click.wav" }, shot("bg.mp4", { dur: 1.3 }), shot("bg.mp4", { dur: 1.3, from: 1 }))`, "t.rx.js", dir);
  const r = report(p.timeline("t"));
  assert.match(r.text, /1 cut\(s\) off the beat grid/);
  assert.ok(r.warnings.some((w) => /holds the last frame/.test(w)), r.warnings.join("\n"));
});

test("renders an MP4 with the right length, size, picture and sound", async () => {
  const p = loadSource(`trailer("t", { w: 64, h: 36, fps: 30, music: "click.wav" },
    shot("bg.mp4", { dur: 1 }), shot("red.png", { dur: 0.5, in: fade(0.2) }), title("GO", { dur: 0.5, size: 20 }))`, "t.rx.js", dir);
  const out = join(dir, "t.mp4");
  await renderMp4(p.timeline("t"), out);
  const pr = probe(out);
  assert.equal(pr.w, 64); assert.equal(pr.h, 36); assert.ok(pr.audio);
  assert.ok(Math.abs(pr.dur! - 2) < 0.08, `duration ${pr.dur}`);
  // Frame 15 (0.5 s) is still the blue half of bg.mp4; frame 40 (1.33 s) is the red still.
  const at = (t: number) => Array.from(spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", out, "-frames:v", "1", "-vf", "crop=2:2:31:17,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]).stdout);
  const blue = at(0.5), red = at(1.33);
  assert.ok(blue[2] > 180 && blue[0] < 60, `blue ${blue}`);
  assert.ok(red[0] > 180 && red[2] < 60, `red ${red}`);
});

test("the live viewer serves state, exact frames and feedback", async () => {
  const file = join(dir, "live.rx.js");
  spawnSync("sh", ["-c", `printf '%s' 'trailer("t", { w: 64, h: 36 }, shot("red.png", { dur: 1 }))' > ${file}`]);
  const s = await serve(file, { port: 0, log: () => {} });
  try {
    const frame = await fetch(s.url + "api/frame?name=t&t=0.5&w=64");
    assert.equal(frame.headers.get("content-type"), "image/png");
    const r = await fetch(s.url + "api/feedback", { method: "POST", body: JSON.stringify({ name: "t", notes: [{ t: 0.4, text: "more red" }] }) });
    assert.equal(r.status, 200);
    const fb = JSON.parse(readFileSync(join(dir, "out", "_feedback", "t.json"), "utf8"));
    assert.equal(fb.notes[0].clip.n, 1);
    assert.match(fb.notes[0].clip.loc, /live\.rx\.js:1:\d+/);
  } finally {
    s.close();
  }
});

test("beat cuts stay on the grid at any tempo, and clips point at the line that made them", () => {
  const p = loadSource(`const play = (b) => shot("a.png", { beats: b })
trailer("t", { w: 64, h: 36, fps: 30, bpm: 84 },
  play(1), play(2), play(3),
  ${"play(2), ".repeat(40)}play(1))`, "t.rx.js", dir);
  const tl = p.timeline("t"), spb = 60 / 84;
  for (const c of tl.clips) {
    const beats = c.start / spb;
    assert.ok(Math.abs(beats - Math.round(beats)) * spb <= 0.5 / 30 + 1e-9, `clip ${c.i + 1} starts ${c.start} off the grid`);
  }
  assert.match(tl.clips[1].def.loc!, /^t\.rx\.js:3:/);
});
