# TIFF Plate Checker

A local, offline tool for the engraving department to manually check separated
TIFF plates against print/proof — no Photoshop channel-merging required.

Replaces the old flow of: open each separation in Photoshop → merge channels →
assign a color to each one by hand → toggle colors on/off against the printed
sheet to check black overprint, trapping and continuity.

## How to use it

1. Open `index.html` in Chrome or Edge (Windows or Mac — nothing to install).
   Everything runs locally in the browser; no file is uploaded anywhere.
2. **Choose Job Folder** and pick the folder with the job's separated TIFFs
   (and, if you have one, the prepress JPEG proof in the same folder).
3. If the folder has TIFFs at more than one pixel size, you'll be asked which
   set to use — pick the one that matches the job (normally the 200 dpi set).
   The others are usually hi-res originals and would misalign if mixed in.
4. **Assign a color to each plate.** The app guesses from the filename (C/M/Y/K,
   White, Varnish…) — click the swatch on any plate to override it, either with
   the CMYK sliders, the color wheel, or a preset. White ink is shown as a
   light-blue tint on screen (real white ink is invisible against white stock).
5. **Open Composite View.** All plates are stacked using a multiply blend, the
   same way real ink overprints, so black-over-color, trapping gaps and
   registration issues look like they would on the printed sheet.
   - Drag plates in the left panel to change the print sequence.
   - Use the bottom toggle pills to switch any color on/off; **Alt-click** a
     pill to solo it. "All on" / "All off" reset quickly.
   - Zoom with the scroll wheel or the +/− buttons; drag to pan.
6. **Save Colors** writes a small `<job>_plate-colors.json` file you can keep
   in the job folder — **Load Saved Colors** on the assign screen restores the
   same colors/order next time without re-assigning everything.
7. **Export Snapshot** saves the current composite as a PNG for the QC record.
8. **Compare with JPEG** opens the prepress proof JPEG next to the composite:
   click the image or press **Space** to blink between them, or drag the
   slider to cross-fade/wipe between the two.

## Known limitations (MVP)

- Each plate is assumed to be a single-channel grayscale separation (the
  normal case). A TIFF with more than one channel is shown as-is, untinted,
  and flagged "multi-channel" — it's not treated as an ink plate.
- Colors are for on-screen visual checking only (fast CMYK→RGB math), not
  color-managed proofing.
- Very large plates (tens of megapixels) may take a few seconds to decode —
  this runs in plain JavaScript with no server, so there's no progress beyond
  the on-screen "decoding plate N of M" status.
- The JPEG proof is scaled to the composite's pixel size for comparison; it
  won't correct for a proof that's cropped differently from the plates.

## Files

- `index.html` / `styles.css` / `app.js` — the app.
- `vendor/UTIF.js`, `vendor/pako_inflate.min.js` — vendored, MIT-licensed TIFF
  decoder (UTIF2) and its Deflate dependency, bundled so the shop floor
  computer doesn't need internet access.
