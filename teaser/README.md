# Proof Checker for Mac: 15-second teaser

`out/proof-checker-for-mac-teaser.mp4`: 1920×1080, 60 fps, 15 s, AAC stereo.

## Source of the feature

The repository has no roadmap file. The teaser follows the work already in
progress in the Approval Proof Checker app: a `Mac app · offline` badge, offline
text reading (`/ocr`) and PDF/TIFF/PSD import (`/convert`). It promises no dates
and nothing beyond those three things.

## Through-line object

**The difference marker box**: the box the checker draws around an error.
It frames the hook word, then becomes the drop zone, the Blink button, the box on
"1 kq", the `Mac app · offline` badge and the full-screen booth. It catches the
typo on the biggest beat and ends as the app icon (with the app's own CMYK mark).

## Storyboard (120 BPM, 1 beat = 0.5 s)

| Beat | Time | What happens |
|---|---|---|
| 0–1 | 0.0–1.0 | "ONE WRONG" / "LETTER" rise in from a mask |
| 2 | 1.0 | "SHIPS." rises in |
| 2.5 | 1.25 | The box snaps around LETTER and its tag 1 grows. SHIPS. retracts at 2.75 |
| 3 | 1.5 | Words exit; the box remains |
| 4 | 2.0 | The box becomes the drop zone and the rail unfolds out of it |
| 5 | 2.5 | The cursor drags `carton_approved.pdf` in |
| 6 | 3.0 | Drop: the file folds into the zone and the thumbnail unmasks |
| 7 | 3.5 | "Opens PDF, / TIFF and PSD." |
| 8 | 4.0 | The box becomes the **Blink** button and the viewer unfolds |
| 9–11 | 4.5–5.5 | Click; the art flips approved/ours every beat; "Blink. Spot the change." |
| 12 | 6.0 | The box jumps onto "1 kq" (tag 2) |
| 13 | 6.5 | The other two differences get boxed |
| 14 | 7.0 | Screen-studio zoom to the letter; click |
| 15 | 7.5 | Approved/ours detail card unfolds: kg vs kq |
| 16 | 8.0 | The box becomes the `Mac app · offline` badge and the text check unfolds |
| 17 | 8.5 | Click "Read both JPEGs & compare text" |
| 18 | 9.0 | Both texts read in, word by word; status shows "Mac reader" |
| 19 | 9.5 | The diff: `kg` and `and` struck, `kq` flagged |
| 20 | 10.0 | The badge grows past all four corners into the full-screen booth |
| 20.5–23.75 | | APPROVED/OURS blink, accelerating with the riser |
| **24** | **12.0** | **Biggest beat: the box collapses from full screen onto "kq"** |
| 25 | 12.5 | The booth folds into the box; the box becomes the app icon |
| 26 | 13.0 | The CMYK mark grows in; "Proof Checker for **Mac**" |
| 27 | 13.5 | "Coming soon" |
| 28 | 14.0 | "Approval Proof Checker" |
| 29 | 14.5 | The header rule draws in, then end |

## Build

```sh
node render.cjs out 4      # soundtrack + video, 4 parallel workers (~10 min)
node beats.cjs <dir> 0.35  # one frame per beat, for checking
```

- `scene.html`: the whole film. Every style is computed in `window.seek(t)` from
  time alone, using spring and exponential easing. Element positions for match
  cuts are measured at runtime, and blur follows camera and box speed.
- `audio.html`: the soundtrack, composed in code with `OfflineAudioContext`. It
  has a kick on every beat, a hit on each scene change, a riser into beat 24,
  and UI clicks and blink ticks on the picture's timeline.
- `render.cjs`: Playwright renders 3 subframes per 60 fps frame, ffmpeg `tmix`
  blends them for motion blur, and the result is muxed with the WAV.
- `reference/`: screenshots of the real app that the vector rebuild was matched against.

Brand: Barlow Condensed for all film type (the app's display face); the rebuilt
UI keeps the app's own Public Sans and JetBrains Mono. The accent `#0a6f8f` is
used only on the box and the word "Mac".
