---
name: reel-trailers
description: Cut video game trailers, teasers, vertical shorts and showreels with reel, a compact JavaScript DSL that edits shots, titles and transitions to the music's beat and renders MP4 with ffmpeg, with contact sheets and a live viewer. Use when asked to make, edit or iterate on a trailer or promo video from game footage, renders or art.
---

# reel: video game trailers as code

You write a small `.rx.js` file of shots (videos, GIFs, images) and title cards; reel times them to
the beat, moves the camera over each one, mixes music and sfx, and renders an MP4 (H.264 + AAC).
Needs Node ≥ 22.18, ffmpeg on PATH, and `npm install` once in this skill's directory.

`REEL` below means `node <this skill's directory>/bin/reel.js`.

## Workflow (you can't watch: read instead)

1. Gather footage: gameplay captures, or renders from the family (kiln camera moves, vex/pxl
   animations as MP4/GIF) and music (a chirp `song`, built to WAV). Paths are relative to the file.
2. Write `trailer.rx.js` (template below). Give the trailer the music's `bpm` and cut in `beats`.
3. `REEL info trailer.rx.js`: every clip with start, length, the beat it starts on and how far off
   the grid it is, the music's loudness and first hit inside it, and warnings (a shot running past
   its source holds the last frame). It also estimates the music's tempo if you don't know it.
   **Music hits** lists the strongest onsets: put big cuts, flashes and title punches on them.
4. **Look at it**: `REEL build trailer.rx.js --proxy` writes `out/_preview/<name>.png`, a contact
   sheet with one frame per clip and a strip of clips × beats × loudness × hits. Check framing (is
   the subject in frame after `move`?), readable titles, and that the energy rises with the music.
   For one exact frame: `REEL frame trailer.rx.js <name> <seconds>`.
5. Let the user watch: start `REEL serve trailer.rx.js` in the background and open the URL. It
   rebuilds on save, renders a half-size proxy with sound, and scrubs exact frames.
   **Feedback**: the user presses `n` (or shift-drags on the strip) to pin notes, then sends them.
   When they say "check the feedback", read `out/_feedback/<name>.json`: each note has `t` (and
   `t1` for a span), their `text`, the `clip` on screen (`n`, `loc` = the source line, `u` = seconds
   into that clip) and the `beat`. Look at `<name>.n<k>.png` for the frame they meant.
6. Ship: `REEL build trailer.rx.js` renders full size to `out/<name>.mp4`; `--gif` adds `out/<name>.gif`
   (480 px wide) for a README, a store page or a post.

Errors name file:line:col and the clip path, and suggest fixes ("did you mean 'fade'?").

## Template

```js
const F = "../footage/";
trailer("teaser", { w: 1920, h: 1080, fps: 30, bpm: 100, music: "out/music/score.wav",
  letterbox: 2.39, fadeIn: 1, fadeOut: 1 },
  shot(F + "establish.mp4", { beats: 8, move: { zoom: [1, 1.08] } }),          // slow push
  title("THE RAIN NEVER STOPS", { beats: 4, size: 72, tracking: 0.18, in: fade(0.3) }),
  shot(F + "hero.mp4", { beats: 2, from: 3.5, move: { zoom: [1.1, 1.25], x: 0.6 }, in: flash(0.15),
    sfx: sfx("out/sfx/whoosh.wav", { vol: 0.6 }) }),
  shot(F + "sprite.gif", { beats: 2, pixel: true, fit: "contain", bg: "#1b1630" }),  // pixel art: nearest
  // build: one cut per beat, ever closer
  [1, 4, 8, 6].map((from, i) => shot(F + "fight.mp4", { beats: 1, from, move: { zoom: 1.1 + i * 0.08 } })),
  title("LAST CUP", { beats: 4, size: 150, anim: "punch" }),                    // the drop
  shot(F + "boss.mp4", { beats: 4, speed: 0.5, caption: "Coming to Steam" }),   // slow motion
  title("LAST CUP", { beats: 6, size: 130, sub: "WISHLIST NOW · 2027", in: flash(0.3) }))
```

## Essentials

- **trailer(name, opts, ...clips)**: `w h fps` (even sizes), `bpm beat0`, `music` (path or
  `{ src, from, vol, fadeOut }`), `letterbox` (aspect, e.g. 2.39), `fadeIn fadeOut`. Several
  trailers per file (a 16:9 cut and a 9:16 one); clips may be nested arrays.
- **shot(src, opts)**: `dur` (s) or `beats`; `from` (source s), `speed`, `fit` ("cover" | "contain"),
  `bg`, `pixel`, `move: { zoom, x, y, ease }` (each a value or `[start, end]`; `x y` are the focus
  point in the source, 0..1, kept in frame), `audio` (volume of the source's own sound),
  `caption` (string or `{ text, size, pos, ... }`), `sfx`, `in`.
- **title(text, opts)**: `dur | beats`, `sub`, `size font weight color tracking pos shadow bg`,
  `anim` ("push" slow zoom, "punch" slam in, "none"), `sfx`, `in`. `\n` breaks lines; long lines wrap.
- **Transitions** (`in:` of the incoming clip, over its first seconds): `"cut"`, `fade(d)`,
  `dip(d, color)`, `flash(d, color)`, `wipe(d)`, `slide(d, "left" | "right" | "up" | "down")` (push),
  `zoom(d)` (the old shot grows while the new one fades in). Clips stay back to back; cuts are frame-exact.
- **sfx(src, { at, vol })**: at seconds into the clip.
- **overlay** on any clip: `{ src, x, y, w, at, dur, opacity, pixel }` or a list: logos, sprites (a pxl
  GIF keeps looping), picture-in-picture, HUD mockups, drawn under captions and titles.
- **grade** on a clip or the trailer: `{ brightness, contrast, saturation, gamma, tint, tintAmount,
  vignette }`: a look (teal-orange, bleached, night) in a few numbers.

Full API: [reference.md](reference.md).

## Habits that make better trailers

- Cut on the beat, and change the rhythm with the music: long takes in the intro, 2-beat cuts when
  the drums enter, 1-beat cuts in the build, a hard stop (title on black) on the drop.
- Hook in the first 3 seconds; title the game at the drop; end card with the call to action
  (wishlist, date, platforms) held 3+ seconds.
- Every shot moves: a slow push (`zoom: [1, 1.08]`) beats a static frame. Push in as tension rises.
- Few words on title cards, wide tracking, big type. One idea per card.
- For vertical (9:16) cuts, re-aim every shot with `move.x` and check the contact sheet: subjects
  fall out of frame easily.
- Leave headroom in the music (peaks ≤ -2 dBFS); sfx on cuts sit 6+ dB under the music.
