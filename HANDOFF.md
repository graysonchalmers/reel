# 🧭 Session Handoff — reel (Grayson's fork, branch `grayson`)

_Last updated: 2026-10-25 8:40 p.m. CT, swamp kit teaser + vertical_

## 🎯 Current state
- `showcase/swamp/`: swamp kit teaser source (`swamp_trailer.rx.js`, two trailers: `swamp_teaser` 16:9 and `swamp_vertical` 9:16), chirp score `swamp_score.cx.js`, README with GIFs in `media/`.
- Working build dir (footage, renders, out/): `../_trials/2026-10-25-swamp-trailer/`. Footage is not in the repo.
- Traps: Envy has no Blender, so kiln renders run on the Legion (`C:\Projects-local\_scratch\kiln-swamp-trailer`, a git-archive snapshot of Tool-Blockout3D). Vertical needs native portrait renders (`footage_v/`, 720x1280); cropping 16:9 cuts pieces off. A full `reel build` of both trailers takes about 7-9 min through envy-heavy. reel's `--gif` on 9:16 is 36 MB: shrink with ffmpeg (270 px, 12 fps).
- `package-lock.json` modified by `npm install`, left uncommitted.

## 📌 Where we stopped
Vertical re-framed and sent (d2caa7a). Grayson happy with both cuts.

## ▶️ Next concrete step
Phone-check the vertical; bump per-shot zoom (second `v2` arg) if any piece reads small.
Alt: add `--gif` size option upstream-style in the fork instead of the ffmpeg shrink.

## ❓ Open questions
- Should the trailer footage live somewhere durable (Moby / Git LFS), or stay in `_trials/`?

## 🗂️ Changed this session
- Branch: `grayson` · Files: `showcase/swamp/*`
- Decisions: re-render portrait in kiln rather than crop-aim in reel (crop can't fit tall + wide pieces); 90 bpm D minor score, toadstool sfx borrowed from the swamp-pxl-vex-chirp session.

---
📜 Full session history: `handoff-log/`
