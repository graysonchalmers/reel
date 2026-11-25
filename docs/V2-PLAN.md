# reel v2: local video editor (plan draft, 2026-11-24)

## What reel is today
- A copy of **uilianks/reel** (MIT, 2 commits, Oct 2026, ~2.1k lines TypeScript). Same family as vex, pxl, chirp, kiln.
- "Trailers as code": a `.rx.js` file of shots, titles, transitions, overlays, grades, sfx, cut to the music's beat.
- One JS compositor draws every frame; ffmpeg decodes and encodes (x264). ~50 s to render 35 s at 1080p30 on a desktop CPU.
- Already has: contact sheet + `reel info` (agent "watches" by reading), live viewer on :4340 (scrub, play proxy, pin notes), feedback JSON back to the agent.
- Missing for your goal: no editable timeline file a human NLE opens, no drag/trim UI, no phone layout, no multi-track.

## Verdict
Don't archive it, build on it. reel already does the "Claude writes, tool renders, you leave notes" loop. v2 adds the two things you asked for:
1. **A: OpenTimelineIO bridge.** `reel export x.rx.js --otio` and `reel import x.otio` so the same edit opens in Kdenlive/Shotcut (via OTIO's MLT/Kdenlive adapters, Apache-2.0) and comes back.
2. **C: phone tweak editor.** Upgrade the viewer into a touch UI on the tailnet: trim/nudge cuts, swap a shot, edit title text, reorder, then save back to the timeline file and re-render on Stealth.

## Master file question (the big decision)
| Option | Master | Tradeoff |
|---|---|---|
| A1 ⭐ | `.otio` JSON, reel effects in OTIO metadata | One file Kdenlive, the phone UI and Claude all edit. reel `.rx.js` becomes an optional authoring sugar. |
| A2 | `.rx.js` stays master, OTIO is export-only | Least work, but Kdenlive tweaks don't round-trip. |
| A3 | Kdenlive `.kdenlive` (MLT XML) master | Best for desktop tweaks, worst for phone UI + Claude. |

## Phases (each ends with a gate)
1. Archive: tag `v1-uilianks` + branch `legacy/v1` (no deletes). Rename to v2 in README.
2. OTIO model: `.otio` read/write in Node (plain JSON, no Python needed), round-trip test against `last_cup`.
3. Kdenlive bridge: Python `opentimelineio` + `otio-kdenlive-adapter` on Stealth, open in Kdenlive on Windows, re-import, diff.
4. Phone editor: touch timeline on Stealth tailnet port, neutral grey UI, trim/reorder/text, save, re-render proxy.
5. Demo overlays (timers, 1x/10x speed badge) as a reel clip type, so our GameKit demos come out of reel.

## Open source to pull in (licences)
- OpenTimelineIO (Apache-2.0), otio-kdenlive-adapter / otio-mlt-adapter (MIT/Apache).
- Kdenlive (GPL, used as an app, not linked). MLT `melt` (LGPL) as an optional headless renderer.
- Reference for the web timeline UI: omniclip (MIT), react-timeline-editor (MIT).
