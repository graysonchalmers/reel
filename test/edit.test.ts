import assert from "node:assert/strict";
import { test } from "node:test";
import { clipSpans, reorderClips } from "../src/node/edit.ts";
import { loadSource } from "../src/node/load.ts";

const SRC = `trailer("t", { w: 320, h: 180, fps: 10, fadeIn: 0.5 },
  title("A (one)", { dur: 1 }),
  // the middle
  title("B", { dur: 1, in: fade(0.2) }),
  title("C", { dur: 1, sub: ")" }))
`;
const locs = (src: string) => loadSource(src, "t.rx.js").timeline("t").clips.map((c) => c.def.loc);
const texts = (src: string) => loadSource(src, "t.rx.js").timeline("t").clips.map((c) => (c.def as { text: string }).text);

test("reorder and delete clips by rewriting the source", () => {
  const swapped = reorderClips(SRC, "t.rx.js", locs(SRC), [2, 0, 1]);
  assert.deepEqual(texts(swapped), ["C", "A (one)", "B"]);
  assert.match(swapped, /\/\/ the middle/);
  const cut = reorderClips(SRC, "t.rx.js", locs(SRC), [0, 2]);
  assert.deepEqual(texts(cut), ["A (one)", "C"]);
  assert.throws(() => reorderClips(SRC, "t.rx.js", locs(SRC), []));
});

test("clips made in a loop are not editable", () => {
  const src = `trailer("t", { w: 320, h: 180, fps: 10 }, ["A", "B"].map((s) => title(s, { dur: 1 })))\n`;
  assert.ok("why" in clipSpans(src, "t.rx.js", locs(src)));
});
