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
7. **Export Snapshot** saves the current composite as a full-resolution PNG
   for the QC record (mirrored too, if "View: Reverse" is on).
8. **Compare with JPEG** opens the prepress proof JPEG next to the composite:
   click the image or press **Space** to blink between them, or drag the
   slider to cross-fade/wipe between the two.
9. **View: Surface / Reverse** flips the whole composite left-right. ArtPro
   mirrors files for engraving, so use **Reverse** to view it as delivered,
   or **Surface** to view it the normal reading way (e.g. to compare against
   a printed sheet/photo proof, which always reads normally). This affects
   the live view, the compare-with-JPEG overlay, and Export Snapshot.
10. **Ruler** — click it on, then click-drag on the canvas to measure any
    distance. Shows pixels, inches and mm (using the job's dpi), and stays
    accurate even when a big file is being shown at reduced screen quality
    (see Performance below).
11. **Prepress checklist** (right panel) — tick off standard checks as you go
    (logo, barcode, legal text, trapping, mirror orientation, etc.), add your
    own items, and attach a note to any item. Fill in **Checked by** with your
    name. The checklist and name are remembered per job folder (in this
    browser) so reopening the same job later restores where you left off.
12. **Save QC Report** exports a single, self-contained HTML file — checklist
    results, operator name/date, the plate list and a snapshot image — named
    `<job>_<operator>_<date>_QC-Report.html`. Keep it with the job as your
    sign-off record.

## Performance on real (large) files

The composite view runs at **full native resolution by default** — fine
prepress detail (hairlines, small type, barcodes, trapping) must stay
checkable, so quality is never silently reduced. Toggling colors should
already be noticeably faster than an earlier version of this tool, which
had a real bug: it was resizing the canvas on every single click even when
the size hadn't changed, forcing a full reallocation each time.

If a specific job is genuinely heavy (tens of megapixels per plate) and
toggling still feels slow, turn on **Fast Preview** in the bottom bar — it
switches the interactive view to a capped-resolution copy (long edge
≤1600px) purely for speed. This is an explicit, visible choice you make per
job, not something the app decides for you. Either way, the **ruler**
measures in the original file's real pixels/inches/mm.

### Hard ceiling on extremely large plates

Browsers silently fail to hold pixel data in a `<canvas>` past a certain
size — confirmed in testing: a 23400×14500px (~339 megapixel) plate came
back completely blank with no error at all. To prevent that, every canvas
this app builds is capped at 8000px on the long edge (`CANVAS_SAFE_DIM` in
`app.js`). A plate over that size is shown at a reduced (but correct, not
blank/corrupted) resolution, flagged on its card in the Assign screen with
the real vs. shown size. The ruler and the dpi shown always refer to the
**real** file size regardless; **Export Snapshot** is capped the same way,
since there's no way to build a browser canvas past this ceiling for
export either — for a job this large, a snapshot this tool exports will
not be pixel-for-pixel the original file size.

## Known limitations (MVP)

- Each plate is assumed to be a single-channel grayscale separation (the
  normal case). A TIFF with more than one channel is shown as-is, untinted,
  and flagged "multi-channel" — it's not treated as an ink plate.
- Colors are for on-screen visual checking only (fast CMYK→RGB math), not
  color-managed proofing.
- Very large plates (tens of megapixels) may take a few seconds to decode on
  first load — this runs in plain JavaScript with no server, so there's no
  progress beyond the on-screen "decoding plate N of M" status.
- The JPEG proof is scaled to the composite's pixel size for comparison; it
  won't correct for a proof that's cropped differently from the plates.
- Checklist/operator name are saved in the browser's local storage, keyed by
  job folder name — they don't follow the job if opened on a different
  computer or in a different browser. The exported QC report is the portable
  record.
- No real folder/log auto-creation: the browser can't write to arbitrary
  folders on disk. Each report/snapshot is a normal download with a
  job+operator+date filename, meant to be filed into the job folder by hand
  (or a shared "QC Reports" folder).

## Files

- `index.html` / `styles.css` / `app.js` — the app.
- `vendor/UTIF.js`, `vendor/pako_inflate.min.js` — vendored, MIT-licensed TIFF
  decoder (UTIF2) and its Deflate dependency, bundled so the shop floor
  computer doesn't need internet access.
