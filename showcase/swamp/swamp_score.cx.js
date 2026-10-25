// Swamp kit trailer score. chirp build swamp_score.cx.js
// 90 bpm, 1 beat = 0.667 s, 1 bar = 2.667 s. Bars 1-2 drone + frogs (title), 3-6 the pulse (2-beat cuts),
// 7-8 the build (1-beat cuts, riser), bar 9 the drop (BRAAM at 21.33 s, title), bar 10 end card, boom at 24.0 s.
const rest = (bars = 1) => Array(16 * bars).fill(".").join(" ");
const hold = (tok) => [tok, ...Array(15).fill("-")].join(" ");
const rep = (s, n) => Array(n).fill(s).join(" | ");
const DM = "D2+A2+D3+F3", BB = "A#1+F2+A#2+D3", GM = "G1+D2+G2+A#2", AM = "A1+E2+A2+C#3";

inst("pad", { wave: "saw", env: [1.2, 0.4, 0.8, 1.8], vol: 0.07, filter: { type: "lp", cutoff: 700 } })
inst("bass", { wave: "triangle", env: [0.004, 0.18, 0.5, 0.08], vol: 0.3 })
inst("pluck", { wave: "square", duty: 0.2, env: [0.002, 0.15, 0.1, 0.2], vol: 0.07, filter: { type: "lp", cutoff: 1800 } })

sfx("croak", { vol: 0.5 },
  tone({ wave: "square", duty: 0.3, freq: 120, to: 85, dur: 0.18, env: [0.005, 0.08, 0.4, 0.06], filter: { type: "lp", cutoff: 900 } }),
  at(0.22, tone({ wave: "square", duty: 0.3, freq: 110, to: 80, dur: 0.16, env: [0.005, 0.08, 0.4, 0.06], filter: { type: "lp", cutoff: 900 } })))
sfx("bubble", { vol: 0.4 }, tone({ wave: "sine", freq: 300, to: 900, dur: 0.09, env: [0.002, 0.04, 0.3, 0.04] }))
sfx("braam", { vol: 0.4, fx: [drive({ amount: 2.2 }), reverb({ size: 0.9, mix: 0.35 })] },
  tone({ wave: "saw", freq: "D2", dur: 2.4, env: [0.02, 0.6, 0.6, 1.2], filter: { type: "lp", from: 2400, to: 300 } }),
  tone({ wave: "saw", freq: "A2", dur: 2.4, env: [0.02, 0.6, 0.5, 1.2], vol: 0.7, filter: { type: "lp", from: 2000, to: 260 } }),
  tone({ wave: "sine", freq: 73, to: 49, dur: 2, env: [0.005, 0.8, 0.5, 1] }),
  noise({ color: "brown", dur: 0.4, env: [0.001, 0.2, 0.3, 0.4], vol: 0.6 }))
sfx("riser", { vol: 0.35 },
  noise({ color: "white", dur: 5.3, env: [5.1, 0, 1, 0.05], filter: { type: "lp", from: 300, to: 9000 } }),
  tone({ wave: "saw", freq: "D3", to: "D6", dur: 5.3, env: [4.8, 0, 1, 0.05], vol: 0.2 }))
sfx("boom", { vol: 0.5, fx: [reverb({ size: 0.95, mix: 0.45 })] },
  tone({ wave: "sine", freq: 65, to: 28, dur: 3, env: [0.002, 1.4, 0.3, 1.2] }),
  noise({ color: "brown", dur: 0.8, env: [0.001, 0.4, 0.2, 0.8], filter: { type: "lp", from: 3000, to: 120 } }))
sfx("whoosh", { vol: 0.35 },
  noise({ color: "pink", dur: 0.4, env: [0.28, 0.05, 0.6, 0.1], filter: { type: "lp", from: 400, to: 6000 } }))

song("score", { bpm: 90, bars: 11, loop: false, vol: 0.4, fx: [reverb({ size: 0.8, mix: 0.22 })] },
  track("pad", [hold(DM), hold(DM), rep([DM, BB, GM, AM].map(hold).join(" | "), 1), hold(DM), hold(BB), hold(GM), hold(AM), hold(DM), hold(DM)].join(" | ")),
  track("bass", [rest(2), rep("D1 . . D2 . . D1 . . . D1 . A1 . C2 . | A#0 . . A#1 . . A#0 . . . A#0 . F1 . G1 .", 2),
    "D1 . D1 D2 . D1 D1 . D1 . D1 D2 . D1 D1 . | A1 . A1 A2 . A1 A1 . A1 A1 A1 A1 A1 A1 A1 A1", rest(), rest(2)].join(" | ")),
  track("pluck", [rest(4), rep("D4 . F4 . A4 . F4 . D4 . F4 . A4 . C5 .", 2), "D5 . A4 . F4 . D4 . D5 . A4 . F4 . D4 . | A4 . E4 . C#4 . A3 . A4 . E4 . C#4 . E4 .", rest(3)].join(" | ")),
  track("kick", [rest(2), rep("x . . . . . x . x . . . . . . .", 4), rep("x . . . x . . . x . . . x . . .", 1), "x . x . x . x . x x x x x x x x", rest(), rest(2)].join(" | ")),
  track("snare", [rest(2), rep(". . . . x . . . . . . . x . . .", 4), ". . . . x . . . . . . . x . x x", "x . x . x . x . x x x x x! x x! x!", rest(), rest(2)].join(" | "), { vol: 0.7 }),
  track("hat", [rest(2), rep(". . x . . . x . . . x . . . x x", 4), rep("x x x x x x x x x x x x x x x x", 2), rest(), rest(2)].join(" | "), { vol: 0.4 }),
  at(0.4, play("croak")), at(2.9, play("croak", { vol: 0.7 })), at(4.6, play("bubble")), at(9.8, play("croak", { vol: 0.5 })),
  at(16.0, play("riser")),
  at(21.333, play("braam")),
  at(24.0, play("boom")))
