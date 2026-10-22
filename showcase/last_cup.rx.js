// LAST CUP: a 35 s teaser cut from the family's own renders (kiln 3D, vex vector) to a chirp
// score. Build the score first:  chirp build trailer_score.cx.js --only score,whoosh
// Sources sit in the sibling repos (~/Projetos/{kiln,vex}), so this file expects that layout.
const KILN = "../../kiln/docs/media/", VEX = "../../vex/docs/media/";
const C3D = KILN + "last_cup_3d.mp4", SIP3D = KILN + "last_cup_3d_sip.mp4", ISO = KILN + "last_cup_iso.mp4";
const NOIR = VEX + "last_cup.mp4", SIP = VEX + "last_cup_sip.mp4";
const WHOOSH = "out/sfx/whoosh.wav";

const big = { size: 96, tracking: 0.18 };

trailer("last_cup", { w: 1920, h: 1080, fps: 30, bpm: 100, music: { src: "out/music/score.wav", fadeOut: 2 },
  letterbox: 2.39, fadeIn: 1.5, fadeOut: 1.2 },

  // Bars 1-4: rain and pads, slow pushes.
  shot(C3D, { beats: 8, move: { zoom: [1, 1.08] } }),
  title("THE RAIN NEVER STOPS", { beats: 4, ...big, size: 72, in: fade(0.3) }),
  shot(NOIR, { beats: 4, from: 2, move: { zoom: [1.18, 1], x: [0.4, 0.5] }, in: fade(0.4) }),

  // Bars 5-8: the pulse. Two-beat cuts.
  shot(ISO, { beats: 2, from: 1, in: flash(0.15), sfx: sfx(WHOOSH, { vol: 0.6 }) }),
  shot(SIP, { beats: 2, from: 3, move: { zoom: [1.1, 1.2], x: 0.55 } }),
  title("ONE ROBOT", { beats: 2, ...big, anim: "punch" }),
  shot(SIP3D, { beats: 2, from: 4, move: { zoom: [1.05, 1.2] } }),
  title("ONE LAST CUP", { beats: 2, ...big, anim: "punch" }),
  shot(C3D, { beats: 2, from: 6, move: { zoom: [1.3, 1.45], x: 0.45, y: 0.55 } }),
  shot(NOIR, { beats: 2, from: 6, move: { zoom: [1, 1.15], x: 0.6 } }),
  shot(ISO, { beats: 2, from: 5, move: { zoom: [1.1, 1.25] } }),

  // Bars 9-10: the riser. A cut on every beat, ever closer.
  [[SIP3D, 1], [NOIR, 4], [C3D, 8], [SIP, 6], [ISO, 7], [SIP3D, 7], [NOIR, 8], [C3D, 9]].map(([src, from], i) =>
    shot(src, { beats: 1, from, move: { zoom: [1.1 + i * 0.06, 1.16 + i * 0.07] }, ...(i === 0 ? { in: flash(0.12) } : {}) })),

  // Bar 11: the drop. BRAAM at 24.0 s.
  title("LAST CUP", { beats: 4, size: 150, tracking: 0.3, anim: "punch" }),

  // Bars 12-13: the theme, long takes.
  shot(SIP3D, { beats: 4, from: 2, move: { zoom: [1, 1.1] }, caption: "A cyberpunk noir diorama, built entirely as code" }),
  shot(SIP, { beats: 4, from: 4, move: { zoom: [1.15, 1.05] }, in: fade(0.3) }),

  // Final hit at 31.2 s: end card.
  title("LAST CUP", { beats: 6, size: 130, tracking: 0.3, sub: "WISHLIST NOW  ·  2027", in: flash(0.3) }))

// A 9:16 cutdown for shorts and reels: same score, centre-cropped and re-framed shots.
trailer("last_cup_vertical", { w: 1080, h: 1920, fps: 30, bpm: 100, music: { src: "out/music/score.wav", from: 19.2, fadeOut: 1.5 }, fadeOut: 1 },
  [[SIP3D, 1, 0.5], [NOIR, 4, 0.45], [C3D, 8, 0.5], [SIP, 6, 0.55], [ISO, 7, 0.5], [SIP3D, 7, 0.5], [NOIR, 8, 0.6], [C3D, 9, 0.68]].map(([src, from, x], i) =>
    shot(src, { beats: 1, from, move: { zoom: [1 + i * 0.04, 1.06 + i * 0.05], x } })),
  title("LAST\nCUP", { beats: 4, size: 200, tracking: 0.2, anim: "punch" }),
  shot(SIP3D, { beats: 4, from: 2, move: { zoom: [1, 1.1], x: 0.55 }, caption: { text: "Wishlist now", pos: "bottom", size: 64 } }),
  title("LAST\nCUP", { beats: 5, size: 180, tracking: 0.2, sub: "WISHLIST NOW", in: flash(0.3) }))
