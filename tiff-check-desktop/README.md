# TIFF Plate Checker — Desktop

A standalone Windows/Mac app version of the browser tool in `../tiff-check/`,
for the engraving department's manual QC check of separated TIFF plates.
Same checking workflow (color assignment, multiply-blend composite, mirror
view, ruler, JPEG compare with DPI auto-scaling and auto-blink) — the
desktop version adds:

- A native "Choose Job Folder…" dialog instead of a browser file picker.
- **Reports and saved colors write straight to disk**, automatically, into
  `<job folder>/QC Reports/<operator name>/` — no browser download, no
  manual filing. That's the folder-per-person log this was built to replace
  a spreadsheet/paper process for.
- No browser needed day-to-day — double-click the installed app.

It does **not** remove the hard browser-canvas size ceiling described in
`../tiff-check/README.md` (Electron still renders with Chromium under the
hood), so extremely large plates are still shown/exported at a capped,
clearly-labeled resolution rather than literally native pixel size. If you
need true pixel-perfect viewing/export of files that large, that would need
a different rendering approach (a tiled viewer, or compositing via a native
image library instead of a browser canvas) — a bigger follow-up, not
included here yet.

## Running it during development

```bash
cd tiff-check-desktop
npm install
npm start
```

This opens the app exactly as the installed version would. Any change to
the UI is just editing `renderer/*`, same as the web version.

## Building an installer

```bash
cd tiff-check-desktop
npm install
npm run build:win   # produces dist/*.exe (NSIS installer) - can be built on any OS
npm run build:mac   # produces dist/*.dmg - must be run ON a Mac
npm run build:all   # both, if running on a Mac
```

**electron-builder cannot produce a macOS build from Windows or Linux** —
that step genuinely has to run on a Mac, or in CI with a macOS runner.

### Automatic builds via GitHub Actions

`.github/workflows/build-desktop.yml` builds both installers on every push
that touches this folder, using a Windows runner and a macOS runner — so you
get a real `.exe` and `.dmg` without needing your own Windows/Mac dev
machine.

**Get them from the repo's Releases page** (fastest, no extra zip to
extract): every successful build publishes both installers to a single
rolling release tagged `desktop-latest` — that link always has the newest
build, and it's the repo's "Latest release" too, so it's one click from the
repo's main page. Downloading from a GitHub *release* is also noticeably
faster than downloading a CI *artifact* (what the old flow used): releases
are served the same way as any normal GitHub download, while Actions
artifacts go through a slower path and get wrapped in an extra zip around a
file that's often already compressed. The per-run workflow artifacts (in the
"Actions" tab) still exist alongside this, mainly useful for debugging one
specific run.

**The macOS build is unsigned** (no Apple Developer certificate is
configured, and setting one up isn't something that can be done from here).
Gatekeeper will warn that it's from an "unidentified developer" the first
time it's opened — right-click (or Control-click) the app and choose
**Open**, confirm once, and it will run normally after that. The Windows
build is similarly unsigned, so Windows SmartScreen may show a one-time
"Windows protected your PC" prompt — click **More info → Run anyway**.
Proper code signing (recommended before handing this to non-technical
users shop-floor-wide) needs an Apple Developer account and/or a Windows
code-signing certificate, which only you can set up/purchase.

## Files

- `main.js` — Electron main process: native dialogs, reading job files
  from disk, writing reports/colors/snapshots into
  `<job folder>/QC Reports/<operator>/`.
- `preload.js` — the small, explicit bridge the renderer uses to call the
  above (`window.desktop.*`), with Node access otherwise fully disabled in
  the UI for safety.
- `renderer/` — the same UI/app logic as `../tiff-check/`, adapted to read
  files and save reports through `window.desktop.*` instead of browser
  File/download APIs.
