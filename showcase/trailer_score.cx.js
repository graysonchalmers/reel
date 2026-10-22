// LAST CUP trailer score: a chirp file (build it with chirp, reel cuts the picture to it).
//   chirp build trailer_score.cx.js --only score,whoosh
// 100 bpm, 1 beat = 0.6 s, 1 bar = 2.4 s. Bars 1-4 rain and pads, 5-8 the pulse, 9-10 the build
// (riser), 11 the drop (BRAAM at 24.0 s, near silence), 12-13 everything, final hit at 31.2 s.
const rest = (bars = 1) => Array(16 * bars).fill(".").join(" ");
const hold = (tok) => [tok, ...Array(15).fill("-")].join(" ");
const rep = (s, n) => Array(n).fill(s).join(" | ");
const AM = "A2+E3+A3+C4", FM = "F2+C3+F3+A3", CM = "C3+G3+C4+E4", GM = "G2+D3+G3+B3";

inst("pad", { wave: "saw", env: [0.9, 0.4, 0.8, 1.6], vol: 0.07, filter: { type: "lp", cutoff: 900 } })
inst("bass", { wave: "saw", env: [0.004, 0.12, 0.6, 0.06], vol: 0.22, filter: { type: "lp", cutoff: 500 } })
inst("lead", { wave: "square", duty: 0.25, env: [0.01, 0.2, 0.5, 0.4], vol: 0.09, vibrato: [5, 0.12] })

sfx("braam", { vol: 0.55, fx: [drive({ amount: 2.2 }), reverb({ size: 0.9, mix: 0.35 })] },
  tone({ wave: "saw", freq: "A1", dur: 2.2, env: [0.02, 0.6, 0.6, 1.2], filter: { type: "lp", from: 2400, to: 300 } }),
  tone({ wave: "saw", freq: "E2", dur: 2.2, env: [0.02, 0.6, 0.5, 1.2], vol: 0.7, filter: { type: "lp", from: 2000, to: 260 } }),
  tone({ wave: "sine", freq: 55, to: 41, dur: 2, env: [0.005, 0.8, 0.5, 1] }),
  noise({ color: "brown", dur: 0.4, env: [0.001, 0.2, 0.3, 0.4], vol: 0.6 }))
sfx("riser", { vol: 0.35 },
  noise({ color: "white", dur: 4.8, env: [4.6, 0, 1, 0.05], filter: { type: "lp", from: 300, to: 9000 } }),
  tone({ wave: "saw", freq: "A2", to: "A5", dur: 4.8, env: [4.2, 0, 1, 0.05], vol: 0.25 }))
sfx("boom", { vol: 0.75, fx: [reverb({ size: 0.95, mix: 0.4 })] },
  tone({ wave: "sine", freq: 70, to: 28, dur: 3, env: [0.002, 1.4, 0.3, 1.2] }),
  noise({ color: "brown", dur: 0.8, env: [0.001, 0.4, 0.2, 0.8], filter: { type: "lp", from: 3000, to: 120 } }),
  play("braam", { vol: 0.8 }))
sfx("whoosh", { vol: 0.4 },
  noise({ color: "pink", dur: 0.45, env: [0.3, 0.05, 0.6, 0.12], filter: { type: "lp", from: 400, to: 7000 } }))

song("score", { bpm: 100, bars: 15, loop: false, vol: 0.38, fx: [reverb({ size: 0.7, mix: 0.18 })] },
  track("pad", [rep([AM, FM, CM, GM].map(hold).join(" | "), 2), hold(AM), hold(FM), rest(), hold(AM), hold(FM), rest(2)].join(" | ")),
  track("bass", [rest(4), rep("A1 . A1 . A2 . A1 . A1 . A1 . A2 . A1 . | F1 . F1 . F2 . F1 . F1 . F1 . F2 . F1 .", 3), rest(),
    "A1 . A1 A1 A2 . A1 . A1 . A1 A1 A2 . A1 . | F1 . F1 F1 F2 . F1 . F1 . F1 F1 F2 . F1 .", rest(2)].join(" | ")),
  track("lead", [rest(11), "A4 - - - C5 - - - E5 - - - D5 - C5 - | A4 - - - - - - - - - - - - - - -", rest(2)].join(" | ")),
  track("kick", [rep("x! " + rest().slice(2), 4), rep("x . . . x . . . x . . . x . . .", 6), rest(),
    rep("x! . . x x . . . x! . . x x . x .", 2), rest(2)].join(" | ")),
  track("snare", [rest(4), rep(". . . . x . . . . . . . x . . .", 4), "x . x . x . x . x . x . x . x .", "x x x x x x x x x! x x x x! x x x!", rest(),
    rep(". . . . x! . . . . . . . x! . . x", 2), rest(2)].join(" | "), { vol: 0.8 }),
  track("hat", [rep("x . . . x . . . x . . . x . . .", 4), rep(". . x . . . x . . . x . . . x .", 6), rest(), rep("x x x x x x x x x x x x x x x x", 2), rest(2)].join(" | "), { vol: 0.5 }),
  at(19.2, play("riser")),
  at(24, play("braam")),
  at(31.2, play("boom")))
