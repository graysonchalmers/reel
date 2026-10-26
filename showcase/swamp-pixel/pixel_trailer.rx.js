// 10 s pixel cut of the swamp: pxl frog, lit night scene, particles, iso map. Score: swamp_score bars 1-4 (90 bpm, beat 0.667 s).
const F = "footage/", C = "/home/graysonchalmers/Projects-local/z-Git/uilianks/chirp/trials/2026-10-26-swamp-vfx/out/sfx/"
trailer("swamp_pixel", { w: 1280, h: 720, fps: 30, bpm: 90, music: { src: "../swamp/out/music/score.wav", fadeOut: 1.2 },
  fadeIn: 0.4, fadeOut: 0.8 },
  shot(F + "frog.mp4", { beats: 2, move: { zoom: [1, 1.05] } }),
  title("BAYOU NIGHTS", { beats: 2, size: 72, tracking: 0.2, in: fade(0.3) }),
  shot(F + "night.mp4", { beats: 3, in: dip(0.25), move: { zoom: [1, 1.08] } }),
  shot(F + "fireflies.mp4", { beats: 2, sfx: sfx(C + "fx_fireflies.wav", { vol: 0.8 }) }),
  shot(F + "wisp.mp4", { beats: 2, sfx: sfx(C + "fx_wisp.wav", { vol: 0.7 }) }),
  shot(F + "iso.mp4", { beats: 2, in: flash(0.15), move: { zoom: [1.15, 1] }, sfx: sfx(C + "fx_sparkle.wav") }),
  title("SWAMP · ALL CODE", { beats: 2, size: 64, sub: "PXL · VEX · CHIRP · KILN · REEL", in: flash(0.2) }))
