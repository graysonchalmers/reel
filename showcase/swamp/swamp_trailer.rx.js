// Swamp kit teaser: kiln camera moves (footage/) cut to swamp_score.cx.js (90 bpm, bar = 2.667 s).
// Bars 1-2 establish + title, 3-6 eight 2-beat cuts, 7-8 one cut per beat (night pieces), bar 9 drop title, bar 10 end card.
const F = "footage/", X = "out/sfx/", T = "../2026-10-25-swamp-toadstools/chirp/out/sfx/";
const s2 = (n, o = {}) => shot(F + n + ".mp4", { beats: 2, from: 0.3, ...o });
trailer("swamp_teaser", { w: 1920, h: 1080, fps: 30, bpm: 90, music: { src: "out/music/score.wav", fadeOut: 1.5 },
  fadeIn: 1, fadeOut: 1.2, grade: { saturation: 1.08, vignette: 0.25 } },
  shot(F + "bald_cypress.mp4", { beats: 4, speed: 0.9, move: { zoom: [1, 1.06] } }),
  title("SOMETHING GROWS IN THE BAYOU", { beats: 4, size: 64, tracking: 0.18, in: fade(0.4), sfx: sfx(X + "croak.wav", { vol: 0.6 }) }),
  s2("dead_snag", { in: dip(0.3) }),
  s2("mangrove_roots", { move: { zoom: [1.05, 1.12] } }),
  s2("cattails"),
  s2("lily_pads", { sfx: sfx(T + "cap_drip.wav", { vol: 0.7 }) }),
  s2("mossy_boulders", { move: { zoom: [1.05, 1.1] } }),
  s2("fungus_stump", { sfx: sfx(X + "bubble.wav") }),
  s2("log_bridge"),
  s2("boardwalk", { sfx: sfx(X + "whoosh.wav") }),
  [["stilt_hut", 0.4], ["lantern_post", 0.6], ["glow_toadstools", 0.4], ["stilt_hut", 1.6],
   ["lantern_post", 1.8], ["glow_toadstools", 1.5], ["stilt_hut", 2.0], ["glow_toadstools", 1.9]]
    .map(([n, from], i) => shot(F + n + ".mp4", { beats: 1, from, move: { zoom: 1 + i * 0.02 }, in: i ? undefined : flash(0.15),
      sfx: n === "glow_toadstools" && i === 2 ? sfx(T + "spore_puff.wav", { vol: 0.8 }) : undefined })),
  title("SWAMP KIT", { beats: 4, size: 160, anim: "punch", in: flash(0.3) }),
  title("SWAMP KIT", { beats: 4, size: 120, sub: "14 PIECES · ALL CODE · KILN + CHIRP + REEL", in: fade(0.2) }))

// 9:16 cutdown: same score and cut grid, shots re-rendered portrait; second arg = zoom (wide pieces stay low so their ends are not clipped).
const FV = "footage_v/";  // native 720x1280 kiln renders, so tall and wide pieces fit whole
const v2 = (n, z, o = {}) => shot(FV + n + ".mp4", { beats: 2, from: 0.3, move: { zoom: [z, z * 1.06], y: 0.55 }, ...o });
trailer("swamp_vertical", { w: 1080, h: 1920, fps: 30, bpm: 90, music: { src: "out/music/score.wav", fadeOut: 1.5 },
  fadeIn: 1, fadeOut: 1.2, grade: { saturation: 1.08, vignette: 0.25 } },
  shot(FV + "bald_cypress.mp4", { beats: 4, speed: 0.9, move: { zoom: [1.1, 1.22], y: 0.5 } }),
  title("SOMETHING GROWS IN THE BAYOU", { beats: 4, size: 70, tracking: 0.14, in: fade(0.4), sfx: sfx(X + "croak.wav", { vol: 0.6 }) }),
  v2("dead_snag", 1.2, { in: dip(0.3) }),
  v2("mangrove_roots", 1.2),
  v2("cattails", 1.25),
  v2("lily_pads", 1.3, { sfx: sfx(T + "cap_drip.wav", { vol: 0.7 }) }),
  v2("mossy_boulders", 1.3),
  v2("fungus_stump", 1.3, { sfx: sfx(X + "bubble.wav") }),
  v2("log_bridge", 1.2),
  v2("boardwalk", 1.25, { sfx: sfx(X + "whoosh.wav") }),
  [["stilt_hut", 0.4, 1.3], ["lantern_post", 0.6, 1.15], ["glow_toadstools", 0.4, 1.3], ["stilt_hut", 1.6, 1.35],
   ["lantern_post", 1.8, 1.2], ["glow_toadstools", 1.5, 1.4], ["stilt_hut", 2.0, 1.45], ["glow_toadstools", 1.9, 1.5]]
    .map(([n, from, z], i) => shot(FV + n + ".mp4", { beats: 1, from, move: { zoom: z, y: 0.55 }, in: i ? undefined : flash(0.15),
      sfx: n === "glow_toadstools" && i === 2 ? sfx(T + "spore_puff.wav", { vol: 0.8 }) : undefined })),
  title("SWAMP KIT", { beats: 4, size: 150, anim: "punch", in: flash(0.3) }),
  title("SWAMP KIT", { beats: 4, size: 120, sub: "14 PIECES · ALL CODE\nKILN + CHIRP + REEL", in: fade(0.2) }))
