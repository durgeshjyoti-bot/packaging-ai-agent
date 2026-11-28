"use strict";

/* ============================================================
   State
   ============================================================ */
const state = {
  jobName: "",
  jobFolderPath: "",      // absolute path on disk - used to save reports/colors right next to the job
  allFiles: [],           // every {name, path, size} from the chosen folder
  headerInfo: [],        // [{file, name, width, height, dpi, samplesPerPixel}] - cheap header read
  selectedGroupKey: null,
  plates: [],            // finalized plate objects (see makePlate)
  jpegFiles: [],         // candidate proof JPEGs found in the folder
  order: [],             // array of plate ids, bottom -> top
  scale: 1,
  panX: 0,
  panY: 0,
  compare: { mode: "slider", blinkShowJpeg: false, jpegImg: null, jpegOffsetX: 0, jpegOffsetY: 0, jpegScale: 1, positioning: false },
  fallbackIdx: 0,
  mirrored: false,
  rotation: 0, // 0 | 90 | 180 | 270 - baked into the composite canvas itself, see rotateCanvas()
  rulerMode: false,
  operatorName: "",
  vegLogoChecked: false,
  densityMode: false,
  fastPreview: false, // opt-in only: full resolution is the default so fine detail (barcodes, small text, trapping) is never silently blurred
  // Deep-zoom crop mode (see evaluateCropMode()): for a plate too large for a
  // single safe canvas, mainCanvas normally holds the whole (downsampled)
  // composite. Zoomed in far enough, it instead holds a true full-resolution
  // crop of just the visible region, re-centered here as the new origin.
  cropMode: false,
  cropOrigin: { x: 0, y: 0 },
  cropScale: 1, // real file pixels per mainCanvas pixel (whole-file mode recomputes this each build)
  cropBounds: null, // {x0,y0,x1,y1} the current crop covers, in real file pixels
  hasCappedPlates: false
};

const FALLBACK_PALETTE = ["#808080", "#ff8c00", "#8a2be2", "#8b4513", "#20b2aa", "#dc143c", "#2e8b57", "#4169e1"];
const FAST_PREVIEW_DIM = 1600; // long-edge cap used only when Fast Preview is explicitly turned on
// Browsers silently fail to hold pixel data in a <canvas> once its area gets large enough -
// confirmed in testing: a 23400x14500 (~339 megapixel) canvas comes back completely blank
// with no error. This cap keeps every canvas we build safely under that ceiling; plate.width/
// plate.height (the true native pixel size, from the TIFF header) are never changed by it, so
// dpi/ruler/export-size math and mismatch detection stay correct against the real file.
const CANVAS_SAFE_DIM = 8000;

/* ============================================================
   Small helpers
   ============================================================ */
function $(id) { return document.getElementById(id); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function extOf(name) { const m = /\.([a-z0-9]+)$/i.exec(name); return m ? m[1].toLowerCase() : ""; }
function uid() { return "p" + Math.random().toString(36).slice(2, 10); }

// Approximate on-screen appearance of real process ink (SWOP-ish reference
// colors), not pure RGB primaries - plain (1-c)*(1-k) math makes cyan/magenta/
// yellow look like saturated RGB screen colors, nothing like actual ink on
// stock. Each channel is mixed in as a partial multiply-tint toward its ink's
// real color, the same way plates are composited onto each other, so a
// slider value of e.g. 40% cyan looks like 40% ink coverage, not 40% of a
// cartoon-cyan RGB value.
const INK_RGB = { c: [0, 174, 239], m: [236, 0, 140], y: [255, 242, 0], k: [35, 31, 32] };
function cmykToRgb(c, m, y, k) {
  let r = 255, g = 255, b = 255;
  for (const [ch, amt] of [["c", c], ["m", m], ["y", y], ["k", k]]) {
    const a = clamp(amt, 0, 100) / 100;
    if (a <= 0) continue;
    const [ir, ig, ib] = INK_RGB[ch];
    r = r * (1 - a) + (r * ir / 255) * a;
    g = g * (1 - a) + (g * ig / 255) * a;
    b = b * (1 - a) + (b * ib / 255) * a;
  }
  return [Math.round(r), Math.round(g), Math.round(b)];
}
function rgbToApproxCmyk(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const k = 1 - Math.max(r, g, b);
  const d = 1 - k;
  const c = d > 0.0001 ? (1 - r - k) / d : 0;
  const m = d > 0.0001 ? (1 - g - k) / d : 0;
  const y = d > 0.0001 ? (1 - b - k) / d : 0;
  return { c: Math.round(c * 100), m: Math.round(m * 100), y: Math.round(y * 100), k: Math.round(k * 100) };
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}
function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function rgbToHex(r, g, b) { return "#" + [r, g, b].map(v => clamp(v, 0, 255).toString(16).padStart(2, "0")).join(""); }
function cmykHex(cmyk) { return rgbToHex(...cmykToRgb(cmyk.c, cmyk.m, cmyk.y, cmyk.k)); }

function guessColorFromName(filenameNoExt) {
  const tokens = filenameNoExt.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const has = arr => tokens.some(t => arr.includes(t));
  if (has(["varnish", "gloss", "matte", "coat", "coating", "uv"])) return { kind: "varnish", cmyk: { c: 0, m: 0, y: 0, k: 0 } };
  if (has(["white", "wht", "wh"])) return { kind: "white", cmyk: { c: 0, m: 0, y: 0, k: 0 } };
  if (has(["black", "blk", "k"])) return { kind: "normal", cmyk: { c: 0, m: 0, y: 0, k: 100 } };
  if (has(["cyan", "c"])) return { kind: "normal", cmyk: { c: 100, m: 0, y: 0, k: 0 } };
  if (has(["magenta", "m"])) return { kind: "normal", cmyk: { c: 0, m: 100, y: 0, k: 0 } };
  if (has(["yellow", "y"])) return { kind: "normal", cmyk: { c: 0, m: 0, y: 100, k: 0 } };
  return null;
}

function formatDpi(headerInfo) {
  if (headerInfo.dpi == null) return "dpi unknown";
  return "~" + Math.round(headerInfo.dpi) + " dpi";
}

function showToast(message, revealPath) {
  const t = $("toast");
  t.innerHTML = `<div>${escapeHtml(message)}</div>` + (revealPath ? `<button id="toastReveal">Show in folder</button>` : "");
  t.classList.remove("hidden");
  if (revealPath) $("toastReveal").addEventListener("click", () => window.desktop.revealInFolder(revealPath));
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add("hidden"), 7000);
}

function showScreen(id) {
  for (const s of document.querySelectorAll(".screen")) s.classList.add("hidden");
  $(id).classList.remove("hidden");
}

/* ============================================================
   Step 1: choose folder, read TIFF headers cheaply
   ============================================================ */
$("btnChooseFolder").addEventListener("click", chooseFolder);
$("dropZone").addEventListener("click", (e) => { if (e.target.tagName !== "BUTTON") chooseFolder(); });

async function chooseFolder() {
  const result = await window.desktop.chooseJobFolder();
  if (!result) return; // user cancelled the native dialog
  const files = result.files;
  state.allFiles = files;
  state.jobFolderPath = result.folderPath;
  state.jobName = result.folderName || "Job";

  const tiffFiles = files.filter(f => ["tif", "tiff"].includes(extOf(f.name)));
  state.jpegFiles = files.filter(f => ["jpg", "jpeg"].includes(extOf(f.name)));

  if (!tiffFiles.length) {
    $("loadStatus").textContent = "No .tif/.tiff files found in that folder.";
    return;
  }

  $("loadStatus").textContent = `Reading ${tiffFiles.length} TIFF header(s)…`;
  const headers = [];
  for (const file of tiffFiles) {
    try {
      const buf = await window.desktop.readFile(file.path);
      const ifds = UTIF.decode(buf);
      const page = ifds[0];
      // UTIF.decode() only parses tags; .width/.height are set later by
      // decodeImage(), so read the raw ImageWidth/ImageLength tags here.
      const width = page["t256"][0], height = page["t257"][0];
      let dpi = null;
      const unit = page["t296"] ? page["t296"][0] : 2;
      if (page["t282"] && unit !== 1) {
        const [num, den] = page["t282"][0];
        let val = den ? num / den : num;
        if (unit === 3) val *= 2.54; // cm -> inch
        dpi = val;
      }
      headers.push({
        file, buf, ifds, page,
        name: file.name,
        width, height,
        dpi,
        samplesPerPixel: page["t277"] ? page["t277"][0] : 1
      });
    } catch (err) {
      console.warn("Could not read header for", file.name, err);
    }
  }
  state.headerInfo = headers;

  const groups = new Map();
  for (const h of headers) {
    const key = h.width + "x" + h.height;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }

  if (groups.size <= 1) {
    finalizePlateSelection(headers);
  } else {
    showResolutionPicker(groups);
  }
}

/* ============================================================
   Step 2 (optional): pick which resolution group to use
   ============================================================ */
function showResolutionPicker(groups) {
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const wrap = $("resGroups");
  wrap.innerHTML = "";
  sorted.forEach(([key, items], i) => {
    const dpi = items[0].dpi ? Math.round(items[0].dpi) : null;
    const row = document.createElement("label");
    row.className = "res-group";
    row.innerHTML = `
      <input type="radio" name="resGroup" value="${key}" ${i === 0 ? "checked" : ""}>
      <div>
        <div><strong>${key} px</strong> ${dpi ? `(~${dpi} dpi)` : ""} — ${items.length} file(s)</div>
        <div class="flag">${items.map(it => it.name).join(", ")}</div>
      </div>`;
    wrap.appendChild(row);
  });
  state._resGroups = groups;
  showScreen("screen-res");
}
$("resBack").addEventListener("click", () => showScreen("screen-load"));
$("resContinue").addEventListener("click", () => {
  const key = document.querySelector('input[name="resGroup"]:checked').value;
  finalizePlateSelection(state._resGroups.get(key));
});

/* ============================================================
   Step 3: fully decode chosen plates, build thumbnails, assign colors
   ============================================================ */
async function finalizePlateSelection(headerList) {
  showScreen("screen-assign");
  $("assignGrid").innerHTML = "";
  $("assignCount").textContent = `Decoding ${headerList.length} plate(s)…`;

  // mismatch reference = the most common exact size among the chosen set
  const sizeCounts = new Map();
  for (const h of headerList) {
    const k = h.width + "x" + h.height;
    sizeCounts.set(k, (sizeCounts.get(k) || 0) + 1);
  }
  const refSize = [...sizeCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  state.plates = [];
  state.fallbackIdx = 0;
  state.hasCappedPlates = false; // decodePlate() sets this back to true per-plate as needed
  let i = 0;
  for (const h of headerList) {
    i++;
    $("assignCount").textContent = `Decoding plate ${i} of ${headerList.length}…`;
    try {
      const plate = await decodePlate(h, refSize);
      state.plates.push(plate);
    } catch (err) {
      console.error("Failed to decode", h.name, err);
    }
    // yield to the browser so the status text actually paints
    await new Promise(r => setTimeout(r, 0));
  }

  state.order = state.plates.map(p => p.id);
  $("assignCount").textContent = `${state.plates.length} plate(s)`;
  renderAssignGrid();
}

async function decodePlate(h, refSize) {
  UTIF.decodeImage(h.buf, h.page, h.ifds);
  const rawRgba = UTIF.toRGBA8(h.page);
  const w = h.page.width, h_ = h.page.height;
  const isComposite = h.samplesPerPixel > 1;

  // plate.width/height below stay the TRUE native size from the TIFF header, always -
  // used for dpi/ruler math and mismatch detection. render{Width,Height} are what we
  // actually build a canvas at, which CANVAS_SAFE_DIM may reduce for an extreme file.
  const render = computeRenderDims(w, h_);
  const rgba = render.capped ? downsampleRGBA(rawRgba, w, h_, render.w, render.h) : rawRgba;
  // When capped, also keep the TRUE full-resolution data (compact single-channel
  // for an ink plate, since that's all buildLayerCanvas needs) so deep zoom can
  // rebuild just the visible region at real pixel fidelity - see evaluateCropMode().
  let fullGray = null, fullRgba = null;
  if (render.capped) {
    if (isComposite) fullRgba = rawRgba;
    else fullGray = extractGrayChannel(rawRgba, w, h_);
    state.hasCappedPlates = true;
  }

  const nameNoExt = h.name.replace(/\.[^.]+$/, "");
  const guess = guessColorFromName(nameNoExt);
  let cmyk, kind;
  if (guess) { cmyk = guess.cmyk; kind = guess.kind; }
  else {
    const hex = FALLBACK_PALETTE[state.fallbackIdx % FALLBACK_PALETTE.length];
    state.fallbackIdx++;
    const [r, g, b] = hex.match(/\w\w/g).map(x => parseInt(x, 16));
    cmyk = rgbToApproxCmyk(r, g, b);
    kind = "unassigned";
  }

  const plate = {
    id: uid(),
    name: h.name,
    width: w, height: h_,
    renderWidth: render.w, renderHeight: render.h,
    safetyCapped: render.capped,
    dpi: h.dpi,
    mismatch: (w + "x" + h_) !== refSize,
    isComposite,
    rgba,                 // raw decoded RGBA at render size (used directly for composite TIFFs)
    fullGray, fullRgba,    // present only when safetyCapped - true native-resolution source data
    color: cmyk,
    colorKind: kind,      // "normal" | "white" | "varnish" | "unassigned"
    visible: true,
    layerCanvas: null      // built lazily / on color change
  };
  buildLayerCanvas(plate);
  return plate;
}

// Keeps every canvas we build at or under CANVAS_SAFE_DIM on its long edge, preserving
// aspect ratio. plate.width/height (the real file size) are never touched by this.
function computeRenderDims(w, h) {
  const maxDim = Math.max(w, h);
  if (maxDim <= CANVAS_SAFE_DIM) return { w, h, capped: false };
  const s = CANVAS_SAFE_DIM / maxDim;
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), capped: true };
}

// Plain nearest-neighbor downsample on the typed array itself (no canvas involved,
// so it isn't subject to the same canvas-area ceiling this is working around).
// Pulls just the R channel (R=G=B for grayscale after toRGBA8 normalization)
// into a compact 1-byte-per-pixel array - a quarter the size of the full RGBA,
// which matters when this is the only copy of a huge plate's true resolution.
function extractGrayChannel(rgba, w, h) {
  const out = new Uint8Array(w * h);
  for (let p = 0, n = w * h; p < n; p++) out[p] = rgba[p * 4];
  return out;
}

// Area-averages each destination pixel over its full block of source pixels
// (a box filter), not nearest-neighbor. This matters beyond just display
// quality: ink "density" at a halftone screen is inherently a local-area
// coverage percentage, not any single native pixel's binary value - nearest-
// neighbor was effectively picking one arbitrary pixel from each block, so
// the Density tool's readings jumped around instead of reporting a stable,
// representative coverage percentage.
function downsampleRGBA(src, srcW, srcH, dstW, dstH) {
  const dst = new Uint8Array(dstW * dstH * 4);
  const xRatio = srcW / dstW, yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy0 = Math.floor(y * yRatio);
    const sy1 = Math.min(srcH, Math.max(sy0 + 1, Math.floor((y + 1) * yRatio)));
    for (let x = 0; x < dstW; x++) {
      const sx0 = Math.floor(x * xRatio);
      const sx1 = Math.min(srcW, Math.max(sx0 + 1, Math.floor((x + 1) * xRatio)));
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        const rowOff = sy * srcW;
        for (let sx = sx0; sx < sx1; sx++) {
          const so = (rowOff + sx) * 4;
          r += src[so]; g += src[so + 1]; b += src[so + 2]; a += src[so + 3];
          count++;
        }
      }
      const dOff = (y * dstW + x) * 4;
      if (count > 0) {
        dst[dOff] = r / count; dst[dOff + 1] = g / count; dst[dOff + 2] = b / count; dst[dOff + 3] = a / count;
      }
    }
  }
  return dst;
}

/* Tint a decoded grayscale separation with its assigned color, using
   ink coverage (dark = more ink) as the alpha channel so layers can be
   multiply-blended like real overprinting ink. */
function buildLayerCanvas(plate) {
  const w = plate.renderWidth, h = plate.renderHeight;
  const cnv = document.createElement("canvas");
  cnv.width = w; cnv.height = h;
  const ctx = cnv.getContext("2d");

  if (plate.isComposite) {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(plate.rgba.buffer.slice(0)), w, h), 0, 0);
    plate.layerCanvas = cnv;
    refreshWorkCanvas(plate);
    return;
  }

  let [r, g, b] = cmykToRgb(plate.color.c, plate.color.m, plate.color.y, plate.color.k);
  // pure white ink is invisible against the white "stock" background on screen,
  // so show it as a light tint purely for on-screen checking purposes
  if (plate.colorKind === "white" && r > 245 && g > 245 && b > 245) [r, g, b] = [130, 190, 255];

  const src = plate.rgba; // RGBA, R=G=B for grayscale after toRGBA8 normalization
  const out = new Uint8ClampedArray(w * h * 4);
  for (let p = 0, n = w * h; p < n; p++) {
    const o = p * 4;
    const ink = 255 - src[o]; // 0 = no ink (white), 255 = full ink density
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = ink;
  }
  ctx.putImageData(new ImageData(out, w, h), 0, 0);
  plate.layerCanvas = cnv;
  refreshWorkCanvas(plate);
}

/* The interactive view is built from workLayerCanvas. By default that's the
   SAME canvas as layerCanvas (no further quality loss beyond the safety cap
   above), since fine prepress detail — hairlines, small type, barcodes —
   must stay checkable. Fast Preview is an explicit opt-in for when a
   specific job is too heavy to toggle smoothly even at that size. */
function refreshWorkCanvas(plate) {
  plate.workLayerCanvas = state.fastPreview ? downscaleCanvas(plate.layerCanvas, FAST_PREVIEW_DIM) : plate.layerCanvas;
}

function downscaleCanvas(fullCanvas, targetDim) {
  const w = fullCanvas.width, h = fullCanvas.height;
  const maxDim = Math.max(w, h);
  if (maxDim <= targetDim) return fullCanvas;
  const s = targetDim / maxDim;
  const wc = document.createElement("canvas");
  wc.width = Math.max(1, Math.round(w * s));
  wc.height = Math.max(1, Math.round(h * s));
  wc.getContext("2d").drawImage(fullCanvas, 0, 0, wc.width, wc.height);
  return wc;
}

function setFastPreview(on) {
  state.fastPreview = on;
  state.plates.forEach(refreshWorkCanvas);
  recomposite();
}

/* ============================================================
   Assign-colors screen
   ============================================================ */
function renderAssignGrid() {
  const grid = $("assignGrid");
  grid.innerHTML = "";
  for (const plate of state.plates) {
    const card = document.createElement("div");
    card.className = "plate-card" + (plate.mismatch ? " mismatch" : "");
    card.dataset.id = plate.id;

    const thumb = document.createElement("canvas");
    thumb.className = "thumb";
    drawThumb(thumb, plate);

    const dpiLabel = plate.dpi ? `~${Math.round(plate.dpi)} dpi` : "dpi unknown";
    const kindLabel = plate.isComposite ? "multi-channel (shown as-is)" :
      plate.colorKind === "unassigned" ? "<span style='color:#e0a736'>unassigned — pick a color</span>" :
      plate.colorKind === "white" ? "White ink (tinted for visibility)" :
      plate.colorKind === "varnish" ? "Varnish/coating" : "";

    card.innerHTML = `
      ${plate.mismatch ? `<div class="warn-badge" title="Different pixel size than the rest of the set">SIZE</div>` : ""}
      <div class="name">${plate.name}</div>
      <div class="meta">${plate.width}×${plate.height}px · ${dpiLabel}</div>
      <div class="meta">${kindLabel}</div>
      ${plate.safetyCapped ? `<div class="meta" style="color:#e0a736;">Shown at ${plate.renderWidth}×${plate.renderHeight}px — this file is too large for a browser canvas at full size. Ruler/dpi still use the real ${plate.width}×${plate.height}px.</div>` : ""}
    `;
    card.prepend(thumb);

    if (!plate.isComposite) {
      const row = document.createElement("div");
      row.className = "color-row";
      const sw = document.createElement("div");
      sw.className = "swatch";
      sw.style.background = cmykHex(plate.color);
      sw.addEventListener("click", (ev) => openColorPopover(ev.currentTarget, plate, () => {
        sw.style.background = cmykHex(plate.color);
        plate.colorKind = plate.colorKind === "unassigned" ? "normal" : plate.colorKind;
        buildLayerCanvas(plate);
        drawThumb(thumb, plate);
      }));
      row.appendChild(sw);
      const label = document.createElement("span");
      label.className = "meta";
      label.textContent = "click swatch to set CMYK / pick color";
      row.appendChild(label);
      card.appendChild(row);
    }

    grid.appendChild(card);
  }
}

function drawThumb(canvasEl, plate) {
  const maxW = 220, maxH = 130;
  const scale = Math.min(maxW / plate.width, maxH / plate.height, 1);
  canvasEl.width = Math.max(1, Math.round(plate.width * scale));
  canvasEl.height = Math.max(1, Math.round(plate.height * scale));
  const ctx = canvasEl.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.drawImage(plate.workLayerCanvas, 0, 0, canvasEl.width, canvasEl.height);
}

$("assignBack").addEventListener("click", () => showScreen("screen-load"));
$("assignContinue").addEventListener("click", enterViewer);

/* ============================================================
   Color popover (CMYK sliders + hue/sat wheel + presets)
   ============================================================ */
// the standard process-color quick picks, as clearly-labeled named buttons
// rather than just colored swatches
const NAMED_COLORS = [
  { label: "C", title: "Process Cyan", cmyk: { c: 100, m: 0, y: 0, k: 0 } },
  { label: "M", title: "Process Magenta", cmyk: { c: 0, m: 100, y: 0, k: 0 } },
  { label: "Y", title: "Process Yellow", cmyk: { c: 0, m: 0, y: 100, k: 0 } },
  { label: "K", title: "Process Black", cmyk: { c: 0, m: 0, y: 0, k: 100 } },
  { label: "White", title: "White ink (tinted for visibility)", cmyk: { c: 0, m: 0, y: 0, k: 0 }, kind: "white" },
  { label: "Varnish", title: "Varnish/coating", cmyk: { c: 0, m: 0, y: 0, k: 0 }, kind: "varnish" }
];
const PRESETS = [
  { label: "Orange", cmyk: { c: 0, m: 50, y: 100, k: 0 } },
  { label: "Green", cmyk: { c: 75, m: 0, y: 100, k: 0 } },
  { label: "Violet", cmyk: { c: 60, m: 70, y: 0, k: 0 } },
  { label: "Brown", cmyk: { c: 20, m: 60, y: 90, k: 40 } },
  { label: "Gray 50%", cmyk: { c: 0, m: 0, y: 0, k: 50 } }
];

let _popoverCleanup = null;
function openColorPopover(anchorEl, plate, onApply) {
  if (_popoverCleanup) _popoverCleanup();
  const pop = $("colorPopover");
  const rect = anchorEl.getBoundingClientRect();
  let working = { ...plate.color };
  const drag = { active: false };
  let currentPick = null;

  function rgbNow() { return cmykToRgb(working.c, working.m, working.y, working.k); }

  function syncSpans() {
    ["C", "M", "Y", "K"].forEach(ch => {
      const row = pop.querySelector("#s" + ch).parentElement;
      row.querySelector("span").textContent = working[ch.toLowerCase()];
    });
  }

  function render() {
    const [r, g, b] = rgbNow();
    pop.innerHTML = `
      <h3>Color for this plate</h3>
      <div class="pv-big" style="background:${rgbToHex(r, g, b)}"><span class="pv-hex">${rgbToHex(r, g, b).toUpperCase()}</span></div>
      <div class="pv-section-label">Quick picks</div>
      <div class="named-colors" id="pvNamed"></div>
      <div class="pv-section-label">Hue &amp; saturation</div>
      <div class="wheel-wrap">
        <canvas id="pvWheel" width="120" height="120"></canvas>
        <div style="flex:1;">
          <div class="cmyk-row"><label>V</label><input type="range" id="pvValue" min="0" max="100" value="${Math.round(rgbToHsv(r,g,b).v*100)}"><span></span></div>
          <div class="meta" style="color:#9aa1ab;">Click the wheel for hue/saturation</div>
        </div>
      </div>
      <div class="pv-section-label">CMYK</div>
      <div class="cmyk-row"><label>C</label><input type="range" id="sC" min="0" max="100" value="${working.c}"><span>${working.c}</span></div>
      <div class="cmyk-row"><label>M</label><input type="range" id="sM" min="0" max="100" value="${working.m}"><span>${working.m}</span></div>
      <div class="cmyk-row"><label>Y</label><input type="range" id="sY" min="0" max="100" value="${working.y}"><span>${working.y}</span></div>
      <div class="cmyk-row"><label>K</label><input type="range" id="sK" min="0" max="100" value="${working.k}"><span>${working.k}</span></div>
      <div class="pv-section-label">Presets</div>
      <div class="presets" id="pvPresets"></div>
      <div class="close-row"><button id="pvClose" class="primary">Done</button></div>
    `;
    ["C", "M", "Y", "K"].forEach(ch => {
      const input = pop.querySelector("#s" + ch);
      input.addEventListener("input", () => {
        working[ch.toLowerCase()] = +input.value;
        syncSpans(); drawWheel(); applyLive();
      });
    });
    pop.querySelector("#pvValue").addEventListener("input", (e) => {
      const hsv = rgbToHsv(...rgbNow());
      const [r2, g2, b2] = hsvToRgb(hsv.h, hsv.s, (+e.target.value) / 100);
      const c2 = rgbToApproxCmyk(r2, g2, b2);
      working = c2;
      pop.querySelector("#sC").value = c2.c; pop.querySelector("#sM").value = c2.m;
      pop.querySelector("#sY").value = c2.y; pop.querySelector("#sK").value = c2.k;
      syncSpans(); drawWheel(); applyLive();
    });

    function pickColor(cmyk, kind) {
      working = { ...cmyk };
      if (kind) plate.colorKind = kind;
      pop.querySelector("#sC").value = working.c; pop.querySelector("#sM").value = working.m;
      pop.querySelector("#sY").value = working.y; pop.querySelector("#sK").value = working.k;
      syncSpans(); render2(); applyLive();
    }

    const namedWrap = pop.querySelector("#pvNamed");
    NAMED_COLORS.forEach(nc => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = nc.label;
      btn.title = nc.title;
      const [nr, ng, nb] = cmykToRgb(nc.cmyk.c, nc.cmyk.m, nc.cmyk.y, nc.cmyk.k);
      btn.style.background = rgbToHex(nr, ng, nb);
      btn.style.color = (nr * 299 + ng * 587 + nb * 114) / 1000 > 140 ? "#111" : "#fff";
      btn.style.borderColor = "rgba(0,0,0,.35)";
      btn.addEventListener("click", () => pickColor(nc.cmyk, nc.kind));
      namedWrap.appendChild(btn);
    });

    const presetsWrap = pop.querySelector("#pvPresets");
    PRESETS.forEach(p => {
      const sw = document.createElement("div");
      sw.className = "swatch";
      sw.title = p.label;
      sw.style.background = cmykHex(p.cmyk);
      sw.addEventListener("click", () => pickColor(p.cmyk, p.kind));
      presetsWrap.appendChild(sw);
    });

    pop.querySelector("#pvClose").addEventListener("click", () => closePopover());
    drawWheel();
    syncSpans();
  }

  function render2() { render(); } // re-render after preset pick (rebuilds wheel too)

  function drawWheel() {
    const cnv = pop.querySelector("#pvWheel");
    const ctx = cnv.getContext("2d");
    const cx = 60, cy = 60, radius = 58;
    const img = ctx.createImageData(120, 120);
    const [r, g, b] = rgbNow();
    const hsv = rgbToHsv(r, g, b);
    for (let y = 0; y < 120; y++) {
      for (let x = 0; x < 120; x++) {
        const dx = x - cx, dy = y - cy, dist = Math.sqrt(dx * dx + dy * dy);
        const o = (y * 120 + x) * 4;
        if (dist > radius) { img.data[o + 3] = 0; continue; }
        let ang = Math.atan2(dy, dx) * 180 / Math.PI; if (ang < 0) ang += 360;
        const sat = Math.min(1, dist / radius);
        const [pr, pg, pb] = hsvToRgb(ang, sat, hsv.v || 1);
        img.data[o] = pr; img.data[o + 1] = pg; img.data[o + 2] = pb; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // selection marker
    const markR = (hsv.s || 0) * radius;
    const markAng = (hsv.h || 0) * Math.PI / 180;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(markAng) * markR, cy + Math.sin(markAng) * markR, 5, 0, Math.PI * 2);
    ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke();

    function pick(ev) {
      const liveCnv = pop.querySelector("#pvWheel");
      const r2 = liveCnv.getBoundingClientRect();
      const x = ev.clientX - r2.left, y = ev.clientY - r2.top;
      const dx = x - cx, dy = y - cy, dist = Math.min(radius, Math.sqrt(dx * dx + dy * dy));
      let ang = Math.atan2(dy, dx) * 180 / Math.PI; if (ang < 0) ang += 360;
      const sat = dist / radius;
      const curHsv = rgbToHsv(...rgbNow());
      const [nr, ng, nb] = hsvToRgb(ang, sat, curHsv.v || 1);
      working = rgbToApproxCmyk(nr, ng, nb);
      pop.querySelector("#sC").value = working.c; pop.querySelector("#sM").value = working.m;
      pop.querySelector("#sY").value = working.y; pop.querySelector("#sK").value = working.k;
      syncSpans();
      pop.querySelector(".pv-big").style.background = rgbToHex(nr, ng, nb);
      drawWheel();
      applyLive();
    }
    currentPick = pick;
    cnv.onmousedown = (ev) => { drag.active = true; pick(ev); };
  }

  function applyLive() {
    plate.color = { ...working };
    if (plate.colorKind === "unassigned") plate.colorKind = "normal";
    const hex = rgbToHex(...rgbNow());
    pop.querySelector(".pv-big").style.background = hex;
    pop.querySelector(".pv-hex").textContent = hex.toUpperCase();
    onApply();
  }

  function onWinMove(ev) { if (drag.active && currentPick) currentPick(ev); }
  function onWinUp() { drag.active = false; }
  function onDocClick(ev) {
    // a preset/named-color click rebuilds the popover's DOM (innerHTML) synchronously,
    // so by the time this bubbles up here ev.target may already be detached from pop -
    // composedPath() captures the path at dispatch time, before that mutation, so it
    // still correctly shows the click originated inside the popover
    const path = ev.composedPath ? ev.composedPath() : [ev.target];
    if (!path.includes(pop) && ev.target !== anchorEl) closePopover();
  }
  function closePopover() {
    pop.classList.add("hidden");
    window.removeEventListener("mousemove", onWinMove);
    window.removeEventListener("mouseup", onWinUp);
    document.removeEventListener("click", onDocClick);
  }

  _popoverCleanup = closePopover;
  window.addEventListener("mousemove", onWinMove);
  window.addEventListener("mouseup", onWinUp);

  pop.style.left = clamp(rect.left, 8, window.innerWidth - 280) + "px";
  pop.style.top = clamp(rect.bottom + 6, 8, window.innerHeight - 420) + "px";
  pop.classList.remove("hidden");
  render();

  setTimeout(() => document.addEventListener("click", onDocClick), 0);
}

/* ============================================================
   Save / load color session
   ============================================================ */
$("btnSaveSession")?.addEventListener("click", saveSession);
$("btnLoadSession").addEventListener("click", async () => {
  const result = await window.desktop.chooseJsonFile(state.jobFolderPath);
  if (!result) return;
  try {
    applySession(JSON.parse(result.text));
  } catch (err) {
    alert("Could not read that file as saved colors: " + err.message);
  }
});

async function saveSession() {
  const data = {
    job: state.jobName,
    savedAt: new Date().toISOString(),
    order: state.order,
    plates: state.plates.map(p => ({ name: p.name, color: p.color, colorKind: p.colorKind, visible: p.visible }))
  };
  const savedPath = await window.desktop.saveReportFile({
    jobFolderPath: state.jobFolderPath,
    operatorName: state.operatorName,
    filename: `${state.jobName}_plate-colors.json`,
    data: JSON.stringify(data, null, 2),
    isText: true
  });
  showToast("Colors saved to " + savedPath, savedPath);
}

function applySession(data) {
  const byName = new Map(state.plates.map(p => [p.name, p]));
  (data.plates || []).forEach(saved => {
    const p = byName.get(saved.name);
    if (!p) return;
    p.color = saved.color;
    p.colorKind = saved.colorKind;
    p.visible = saved.visible !== false;
    buildLayerCanvas(p);
  });
  if (data.order && data.order.every(id => state.plates.some(p => p.id === id))) {
    state.order = data.order;
  }
  renderAssignGrid();
  if (!$("screen-viewer").classList.contains("hidden")) {
    renderLayerList(); recomposite();
  }
}

/* ============================================================
   Viewer screen
   ============================================================ */
function enterViewer() {
  showScreen("screen-viewer");
  $("viewerJobName").textContent = state.jobName;
  const dpi = state.plates[0] && state.plates[0].dpi;
  $("layerPanelSub").textContent = `${state.plates.length} plate${state.plates.length === 1 ? "" : "s"}${dpi ? " · ~" + Math.round(dpi) + " dpi" : ""}`;
  renderLayerList();
  state.scale = null; // force a fit on first paint
  state.mirrored = false;
  $("btnMirrorLabel").textContent = "View: Surface (normal)";
  $("btnMirror").classList.remove("active");
  state.rotation = 0;
  state.rulerMode = false;
  $("btnRuler").classList.remove("active");
  $("canvasStage").classList.remove("ruler-active");
  $("rulerSvg").classList.remove("active");
  $("rulerSvg").innerHTML = "";
  state.fastPreview = false;
  $("btnFastPreview").textContent = "Fast Preview: Off";
  $("btnFastPreview").classList.remove("active");
  state.plates.forEach(refreshWorkCanvas);
  state.densityMode = false;
  $("btnDensity").classList.remove("active");
  state.cropMode = false;
  state.cropBounds = null;
  state.cropOrigin = { x: 0, y: 0 };
  state.cropScale = 1;
  loadChecklistState();
  recomposite();
  scheduleCropEvaluation();
}
$("btnBackToAssign").addEventListener("click", () => showScreen("screen-assign"));

function plateById(id) { return state.plates.find(p => p.id === id); }

function renderLayerList() {
  const wrap = $("layerList");
  wrap.innerHTML = "";
  // top of list = top of stack, so render in reverse order
  [...state.order].reverse().forEach((id, i) => {
    const plate = plateById(id);
    const row = document.createElement("div");
    row.className = "layer-item";
    row.draggable = true;
    row.dataset.id = id;
    row.innerHTML = `
      <span class="drag-handle">⠿</span>
      <span class="seq">${i + 1}</span>
      <input type="checkbox" ${plate.visible ? "checked" : ""}>
      <span class="swatch" style="background:${cmykHex(plate.color)}"></span>
      <span class="lname" title="${plate.name}">${plate.name}</span>
      <button class="solo-btn" title="Solo this plate">◎</button>
    `;
    row.querySelector('input[type="checkbox"]').addEventListener("change", (e) => {
      plate.visible = e.target.checked;
      recomposite();
    });
    row.querySelector(".solo-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      state.plates.forEach(p => p.visible = (p.id === id));
      renderLayerList(); recomposite();
    });
    row.addEventListener("dragstart", () => row.classList.add("dragging"));
    row.addEventListener("dragend", () => { row.classList.remove("dragging"); persistOrderFromDom(); });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      const dragging = wrap.querySelector(".dragging");
      if (!dragging || dragging === row) return;
      const rect = row.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      wrap.insertBefore(dragging, before ? row : row.nextSibling);
    });
    wrap.appendChild(row);
  });
}

function persistOrderFromDom() {
  const ids = [...$("layerList").children].map(r => r.dataset.id).reverse();
  state.order = ids;
  recomposite();
}

$("allOn").addEventListener("click", () => { state.plates.forEach(p => p.visible = true); renderLayerList(); recomposite(); });
$("allOff").addEventListener("click", () => { state.plates.forEach(p => p.visible = false); renderLayerList(); recomposite(); });

/* ---- compositing ----
   Interactive view is drawn from each plate's capped workLayerCanvas so
   toggling/reordering stays fast regardless of the original file size. */
function compositeOnto(ctx, w, h, layerKey) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  state.order.forEach(id => {
    const plate = plateById(id);
    if (!plate.visible) return;
    ctx.globalCompositeOperation = plate.isComposite ? "source-over" : "multiply";
    ctx.drawImage(plate[layerKey], 0, 0);
  });
  ctx.globalCompositeOperation = "source-over";
}

// Rotation is baked into the actual canvas pixel content (unlike mirror,
// which is a live CSS flip) because a 90/270 rotation swaps width/height,
// which is much simpler to get right as a one-time redraw than as part of
// the live pan/zoom CSS transform.
function rotateCanvas(src, degrees) {
  if (!degrees) return src;
  const swapped = degrees === 90 || degrees === 270;
  const out = document.createElement("canvas");
  out.width = swapped ? src.height : src.width;
  out.height = swapped ? src.width : src.height;
  const ctx = out.getContext("2d");
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(degrees * Math.PI / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

// Redraws mainCanvas with whatever is currently visible/ordered/colored,
// without changing pan/zoom or which mode (whole-file vs. deep-zoom crop) is
// active - every existing toggle/reorder/recolor hook just calls this.
function recomposite() {
  if (!state.plates.length) return;
  if (state.cropMode) {
    rebuildCropContent(state.cropBounds.x0, state.cropBounds.y0, state.cropBounds.x1, state.cropBounds.y1);
  } else {
    rebuildWholeFileContent();
  }
  applyTransform();
}

// Builds the whole-file (capped-resolution) composite as a standalone
// canvas, without touching mainCanvas or any view state - used both to
// paint mainCanvas in whole-file mode and, on demand, by Compare-with-JPEG
// when the live view happens to be in deep-zoom crop mode (the comparison
// should always be against the whole job, not whatever sub-region is
// currently on screen).
function buildWholeFileComposite() {
  const w = Math.max(...state.plates.map(p => p.workLayerCanvas.width));
  const h = Math.max(...state.plates.map(p => p.workLayerCanvas.height));
  const tmp = document.createElement("canvas");
  tmp.width = w; tmp.height = h;
  compositeOnto(tmp.getContext("2d"), w, h, "workLayerCanvas");
  return { canvas: rotateCanvas(tmp, state.rotation), preRotW: w };
}

function rebuildWholeFileContent() {
  const { canvas: rotated, preRotW } = buildWholeFileComposite();
  const canvas = $("mainCanvas");
  // resizing a canvas forces a full reallocation+clear even when the value
  // doesn't change, so only touch width/height when the size actually changes
  if (canvas.width !== rotated.width || canvas.height !== rotated.height) {
    canvas.width = rotated.width; canvas.height = rotated.height;
  }
  canvas.getContext("2d").drawImage(rotated, 0, 0);
  const ref = state.plates[0];
  state.cropMode = false;
  state.cropBounds = null;
  state.cropOrigin = { x: 0, y: 0 };
  state.cropScale = ref ? ref.width / preRotW : 1;
}

// Builds mainCanvas from the TRUE full-resolution source data for just the
// [x0,x1)x[y0,y1) region (real file pixels) - this is what lets a file too
// large for one safe canvas still be inspected pixel-for-pixel once zoomed
// in close enough that the region itself fits safely.
function rebuildCropContent(x0, y0, x1, y1) {
  const cw = x1 - x0, ch = y1 - y0;
  const tmp = document.createElement("canvas");
  tmp.width = cw; tmp.height = ch;
  const ctx = tmp.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cw, ch);
  state.order.forEach(id => {
    const plate = plateById(id);
    if (!plate.visible) return;
    ctx.globalCompositeOperation = plate.isComposite ? "source-over" : "multiply";
    ctx.drawImage(getPlateCropCanvas(plate, x0, y0, cw, ch), 0, 0);
  });
  ctx.globalCompositeOperation = "source-over";
  const rotated = rotateCanvas(tmp, state.rotation);
  const canvas = $("mainCanvas");
  canvas.width = rotated.width; canvas.height = rotated.height;
  canvas.getContext("2d").drawImage(rotated, 0, 0);
  state.cropMode = true;
  state.cropOrigin = { x: x0, y: y0 };
  state.cropScale = 1; // a crop is always built at true 1:1 native resolution
  state.cropBounds = { x0, y0, x1, y1 };
}

// Returns a tinted canvas covering exactly [x0,x0+cw)x[y0,y0+ch) of one
// plate, at true native resolution. For a plate that was never downsampled,
// its existing layerCanvas already IS native resolution, so this is just a
// cheap crop; only a safety-capped plate needs re-tinting from the retained
// full-resolution source for this region.
function getPlateCropCanvas(plate, x0, y0, cw, ch) {
  const out = document.createElement("canvas");
  out.width = cw; out.height = ch;
  const octx = out.getContext("2d");
  if (!plate.safetyCapped) {
    octx.drawImage(plate.layerCanvas, x0, y0, cw, ch, 0, 0, cw, ch);
    return out;
  }
  const srcW = plate.width, srcH = plate.height;
  if (plate.isComposite) {
    const imgData = octx.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) {
      const sy = y0 + y; if (sy < 0 || sy >= srcH) continue;
      const srcRow = sy * srcW;
      for (let x = 0; x < cw; x++) {
        const sx = x0 + x; if (sx < 0 || sx >= srcW) continue;
        const so = (srcRow + sx) * 4, dOff = (y * cw + x) * 4;
        imgData.data[dOff] = plate.fullRgba[so]; imgData.data[dOff + 1] = plate.fullRgba[so + 1];
        imgData.data[dOff + 2] = plate.fullRgba[so + 2]; imgData.data[dOff + 3] = plate.fullRgba[so + 3];
      }
    }
    octx.putImageData(imgData, 0, 0);
    return out;
  }
  let [r, g, b] = cmykToRgb(plate.color.c, plate.color.m, plate.color.y, plate.color.k);
  if (plate.colorKind === "white" && r > 245 && g > 245 && b > 245) [r, g, b] = [130, 190, 255];
  const imgData = octx.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    const sy = y0 + y; if (sy < 0 || sy >= srcH) continue;
    const srcRow = sy * srcW;
    for (let x = 0; x < cw; x++) {
      const sx = x0 + x; if (sx < 0 || sx >= srcW) continue;
      const ink = 255 - plate.fullGray[srcRow + sx];
      const dOff = (y * cw + x) * 4;
      imgData.data[dOff] = r; imgData.data[dOff + 1] = g; imgData.data[dOff + 2] = b; imgData.data[dOff + 3] = ink;
    }
  }
  octx.putImageData(imgData, 0, 0);
  return out;
}

/* ---- deep-zoom crop mode: decide when to switch, keeping the view visually
   stable across the switch (same screen position, same apparent zoom) ---- */
let cropEvalTimer = null;
function scheduleCropEvaluation() {
  if (!state.hasCappedPlates) return;
  clearTimeout(cropEvalTimer);
  cropEvalTimer = setTimeout(evaluateCropMode, 180);
}

function currentViewportFileBounds() {
  const stageRect = stage.getBoundingClientRect();
  const corners = [[0, 0], [stageRect.width, 0], [0, stageRect.height], [stageRect.width, stageRect.height]]
    .map(([sx, sy]) => screenToFilePixels(stageRect.left + sx, stageRect.top + sy));
  const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

function evaluateCropMode() {
  if (!state.hasCappedPlates || !state.plates.length) return;
  const vb = currentViewportFileBounds();
  const viewW = vb.x1 - vb.x0, viewH = vb.y1 - vb.y0;
  const threshold = CANVAS_SAFE_DIM / 2.2; // leaves room for the margin below to still fit safely
  const wantsCrop = Math.max(viewW, viewH) < threshold;

  if (!wantsCrop) {
    if (state.cropMode) switchViewMode(rebuildWholeFileContent);
    return;
  }
  if (state.cropMode) {
    const inside = vb.x0 >= state.cropBounds.x0 && vb.x1 <= state.cropBounds.x1 &&
      vb.y0 >= state.cropBounds.y0 && vb.y1 <= state.cropBounds.y1;
    if (inside) return; // current crop already safely covers the view
  }
  const ref = state.plates[0];
  const cx = (vb.x0 + vb.x1) / 2, cy = (vb.y0 + vb.y1) / 2;
  const MARGIN = 2; // build bigger than the viewport so minor panning doesn't immediately re-trigger
  const halfW = Math.min(Math.max(viewW, 20) * MARGIN / 2, CANVAS_SAFE_DIM / 2);
  const halfH = Math.min(Math.max(viewH, 20) * MARGIN / 2, CANVAS_SAFE_DIM / 2);
  const x0 = Math.max(0, Math.round(cx - halfW)), x1 = Math.min(ref.width, Math.round(cx + halfW));
  const y0 = Math.max(0, Math.round(cy - halfH)), y1 = Math.min(ref.height, Math.round(cy + halfH));
  if (x1 - x0 < 2 || y1 - y0 < 2) return;
  switchViewMode(() => rebuildCropContent(x0, y0, x1, y1));
}

// Runs a content rebuild that changes mainCanvas's own size/meaning (entering
// or leaving crop mode, or re-centering the crop), then restores the same
// apparent zoom level and screen position so the switch itself is invisible.
function switchViewMode(rebuildFn) {
  const oldScale = state.scale, oldCropScale = state.cropScale;
  const stageRect = stage.getBoundingClientRect();
  rebuildFn();
  const canvas = $("mainCanvas");
  // keep scale/cropScale (the real on-screen pixel zoom) constant across the
  // switch - this ratio was previously inverted, which made the view jump to
  // a wildly different zoom level (and therefore a different-looking patch
  // of the file) every time panning crossed into/out of/between crop regions
  state.scale = clamp(oldScale * (state.cropScale / oldCropScale), 0.02, 400);
  state.panX = stageRect.width / 2 - (canvas.width / 2) * state.scale;
  state.panY = stageRect.height / 2 - (canvas.height / 2) * state.scale;
  applyTransform();
}

/* Rebuilds the composite at each plate's native resolution — used only for
   the one-off Export Snapshot, not for every interactive toggle. */
function buildFullResComposite() {
  const w = Math.max(...state.plates.map(p => p.layerCanvas.width));
  const h = Math.max(...state.plates.map(p => p.layerCanvas.height));
  const cnv = document.createElement("canvas");
  cnv.width = w; cnv.height = h;
  compositeOnto(cnv.getContext("2d"), w, h, "layerCanvas");
  const rotated = rotateCanvas(cnv, state.rotation);
  return state.mirrored ? mirrorCanvas(rotated) : rotated;
}

function mirrorCanvas(src) {
  const out = document.createElement("canvas");
  out.width = src.width; out.height = src.height;
  const ctx = out.getContext("2d");
  ctx.translate(src.width, 0); ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return out;
}

$("rotateCw").addEventListener("click", () => { state.rotation = (state.rotation + 90) % 360; state.scale = null; recomposite(); scheduleCropEvaluation(); });
$("rotateCcw").addEventListener("click", () => { state.rotation = (state.rotation + 270) % 360; state.scale = null; recomposite(); scheduleCropEvaluation(); });

function applyTransform() {
  const canvas = $("mainCanvas");
  const stage = $("canvasStage");
  if (state.scale == null) {
    const fitScale = Math.min(stage.clientWidth / canvas.width, stage.clientHeight / canvas.height, 1) * 0.96;
    state.scale = fitScale > 0 ? fitScale : 1;
    state.panX = (stage.clientWidth - canvas.width * state.scale) / 2;
    state.panY = (stage.clientHeight - canvas.height * state.scale) / 2;
  }
  const sx = state.mirrored ? -state.scale : state.scale;
  const extraX = state.mirrored ? canvas.width * state.scale : 0;
  canvas.style.transform = `translate(${state.panX + extraX}px, ${state.panY}px) scale(${sx}, ${state.scale})`;
  canvas.style.transformOrigin = "0 0";
  $("zoomLabel").textContent = Math.round(state.scale * 100) + "%";
  // past real-pixel size, show crisp hard edges instead of smoothed/blurred
  // interpolation - "100%" here means exactly 1 screen px per real file px
  const realPixelZoom = state.scale / state.cropScale;
  canvas.classList.toggle("pixelated", realPixelZoom > 1.2);
}

$("btnFastPreview").addEventListener("click", () => {
  setFastPreview(!state.fastPreview);
  $("btnFastPreview").textContent = state.fastPreview ? "Fast Preview: On" : "Fast Preview: Off";
  $("btnFastPreview").classList.toggle("active", state.fastPreview);
});

$("btnMirror").addEventListener("click", () => {
  state.mirrored = !state.mirrored;
  $("btnMirrorLabel").textContent = state.mirrored ? "View: Reverse (mirrored)" : "View: Surface (normal)";
  $("btnMirror").classList.toggle("active", state.mirrored);
  applyTransform();
  if (!$("compareOverlay").classList.contains("hidden")) drawCompare();
});

/* ---- zoom / pan ---- */
// Clamp range is wide enough to cover both whole-file mode (where 100% is
// relative to a downsampled canvas) and deep-zoom crop mode (where 100% is
// exactly 1 screen px per real file px) without the two disagreeing at the
// moment they switch.
const MAX_SCALE = 400;
$("zoomIn").addEventListener("click", () => { state.scale = clamp((state.scale || 1) * 1.25, 0.02, MAX_SCALE); applyTransform(); scheduleCropEvaluation(); });
$("zoomOut").addEventListener("click", () => { state.scale = clamp((state.scale || 1) / 1.25, 0.02, MAX_SCALE); applyTransform(); scheduleCropEvaluation(); });
$("zoomFit").addEventListener("click", () => { state.scale = null; applyTransform(); scheduleCropEvaluation(); });

const stage = $("canvasStage");

// Screen (stage-relative) -> canvas-local point, undoing pan/zoom/mirror only
// (not rotation - rotation is baked into the canvas pixels themselves, so
// canvas-local already includes it).
function screenToCanvasLocal(sx, sy) {
  const canvas = $("mainCanvas");
  const extraX = state.mirrored ? canvas.width * state.scale : 0;
  const clx = state.mirrored ? (state.panX + extraX - sx) / state.scale : (sx - state.panX) / state.scale;
  const cly = (sy - state.panY) / state.scale;
  return { clx, cly };
}

stage.addEventListener("wheel", (e) => {
  e.preventDefault();
  const stageRect = stage.getBoundingClientRect();
  const sx = e.clientX - stageRect.left, sy = e.clientY - stageRect.top;
  const { clx, cly } = screenToCanvasLocal(sx, sy); // anchor point, before changing scale
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  state.scale = clamp((state.scale || 1) * factor, 0.02, MAX_SCALE);
  // re-solve pan so (clx,cly) lands back under the cursor at the new scale -
  // i.e. zoom is centered on the mouse, not on the canvas origin
  const canvas = $("mainCanvas");
  state.panX = state.mirrored ? sx + state.scale * (clx - canvas.width) : sx - clx * state.scale;
  state.panY = sy - cly * state.scale;
  applyTransform();
  scheduleCropEvaluation();
}, { passive: false });

let panning = false, lastX = 0, lastY = 0;
stage.addEventListener("mousedown", (e) => {
  if (state.rulerMode) { rulerMouseDown(e); return; }
  panning = true; lastX = e.clientX; lastY = e.clientY; $("mainCanvas").classList.add("grabbing");
});
window.addEventListener("mousemove", (e) => {
  if (rulerDragging) { rulerMouseMove(e); return; }
  if (!panning) return;
  state.panX += e.clientX - lastX; state.panY += e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  applyTransform();
  scheduleCropEvaluation();
});
window.addEventListener("mouseup", () => {
  rulerDragging = false;
  panning = false; $("mainCanvas").classList.remove("grabbing");
});
window.addEventListener("resize", () => { if (state.scale != null) return; applyTransform(); });

// Eyedropper/density tool: ink coverage (%) of each plate at a file pixel,
// read straight from that plate's own decoded grayscale data (not from the
// rendered/tinted composite), so it's the real ink percentage, not a color
// guess from an RGB sample.
//
// At a real native pixel (realPixelZoom >= 1, i.e. zoomed in to 1:1 or
// closer - always true in deep-zoom crop mode), this reads the exact single
// pixel, which is what you want for verifying dot edges/trapping. But when
// zoomed OUT (common on a huge job before zooming in on a specific spot),
// one screen pixel already represents many real file pixels, averaged
// together for display - reading a single exact pixel there doesn't match
// what's visually on screen at all, and can look like noise, especially on
// a halftoned/textured area, since it reports whichever one native pixel
// happened to land under the cursor rather than what the eye is seeing.
// Averaging over that same neighborhood keeps the reading consistent with
// the visible color at every zoom level.
function densityAtPoint(fx, fy) {
  const realPixelZoom = state.scale / state.cropScale;
  const boxRadius = realPixelZoom >= 1 ? 0 : Math.min(24, Math.round(0.5 / realPixelZoom));
  return [...state.order].reverse().map(id => {
    const p = plateById(id);
    if (p.isComposite) return null;
    const fxi = Math.round(fx), fyi = Math.round(fy);
    if (fxi < 0 || fyi < 0 || fxi >= p.width || fyi >= p.height) {
      return { name: p.name, percent: null, colorHex: cmykHex(p.color) };
    }
    let ink;
    if (boxRadius > 0) {
      ink = averageInkInBox(p, fxi, fyi, boxRadius);
    } else if (p.fullGray) {
      // true native pixel - exact, not an area average
      ink = 255 - p.fullGray[fyi * p.width + fxi];
    } else {
      const rx = Math.round(fx * p.renderWidth / p.width);
      const ry = Math.round(fy * p.renderHeight / p.height);
      ink = 255 - p.rgba[(ry * p.renderWidth + rx) * 4];
    }
    return { name: p.name, percent: Math.round((ink / 255) * 100), colorHex: cmykHex(p.color) };
  }).filter(Boolean);
}

function averageInkInBox(plate, cx, cy, radius) {
  const x0 = Math.max(0, cx - radius), x1 = Math.min(plate.width - 1, cx + radius);
  const y0 = Math.max(0, cy - radius), y1 = Math.min(plate.height - 1, cy + radius);
  let sum = 0, count = 0;
  if (plate.fullGray) {
    const src = plate.fullGray, w = plate.width;
    for (let y = y0; y <= y1; y++) {
      const row = y * w;
      for (let x = x0; x <= x1; x++) { sum += 255 - src[row + x]; count++; }
    }
  } else {
    const src = plate.rgba, rw = plate.renderWidth, rh = plate.renderHeight, w = plate.width, h = plate.height;
    for (let y = y0; y <= y1; y++) {
      const ry = Math.round(y * rh / h);
      for (let x = x0; x <= x1; x++) {
        const rx = Math.round(x * rw / w);
        sum += 255 - src[(ry * rw + rx) * 4];
        count++;
      }
    }
  }
  return count ? sum / count : 0;
}

$("btnDensity").addEventListener("click", () => {
  state.densityMode = !state.densityMode;
  $("btnDensity").classList.toggle("active", state.densityMode);
  $("canvasStage").classList.toggle("density-active", state.densityMode);
  if (!state.densityMode) $("densityMarker").classList.remove("visible");
});

// live cursor-position-in-pixels (and, in Density mode, per-plate ink %)
// readout - shown right next to the cursor (not a fixed corner) so it's
// never far from what the operator is actually pointing at, and with
// swatches/high-contrast text so it's readable sitting on top of artwork.
stage.addEventListener("mousemove", (e) => {
  if (!state.plates.length) return;
  const stageRect = stage.getBoundingClientRect();
  const sx = e.clientX - stageRect.left, sy = e.clientY - stageRect.top;
  if (sx < 0 || sy < 0 || sx > stageRect.width || sy > stageRect.height) return;
  const p = screenToFilePixels(e.clientX, e.clientY);
  const ro = $("pixelReadout");
  let html = `<div class="pr-coord">X: ${Math.round(p.x)}px &nbsp; Y: ${Math.round(p.y)}px</div>`;
  let rowCount = 0;
  if (state.densityMode) {
    const rows = densityAtPoint(p.x, p.y);
    const total = rows.reduce((sum, r) => sum + (r.percent || 0), 0);
    rowCount = rows.length + 1;
    html += rows.map(r => `<div class="pr-row"><span class="pr-swatch" style="background:${r.colorHex}"></span>${escapeHtml(r.name)}<b>${r.percent == null ? "—" : r.percent + "%"}</b></div>`).join("");
    html += `<div class="pr-row pr-total">Total<b>${total}%</b></div>`;
  }
  ro.innerHTML = html;
  ro.classList.add("visible");
  // position just below-right of the cursor, flipping to stay on-screen
  const OFFSET = 16, w = 220, h = 22 + rowCount * 19;
  let left = sx + OFFSET, top = sy + OFFSET;
  if (left + w > stageRect.width) left = sx - OFFSET - w;
  if (top + h > stageRect.height) top = sy - OFFSET - h;
  ro.style.left = Math.max(4, left) + "px";
  ro.style.top = Math.max(4, top) + "px";
  // the real mouse cursor is hidden in density mode (replaced by this ring)
  // so there's never any doubt about which exact pixel is being sampled
  if (state.densityMode) {
    const marker = $("densityMarker");
    marker.style.left = sx + "px";
    marker.style.top = sy + "px";
    marker.classList.add("visible");
  }
});
stage.addEventListener("mouseleave", () => {
  $("pixelReadout").classList.remove("visible");
  $("densityMarker").classList.remove("visible");
});

/* ---- ruler ---- */
let rulerDragging = false, rulerP1Screen = null, rulerP1File = null;

$("btnRuler").addEventListener("click", () => {
  state.rulerMode = !state.rulerMode;
  $("btnRuler").classList.toggle("active", state.rulerMode);
  $("canvasStage").classList.toggle("ruler-active", state.rulerMode);
  $("rulerSvg").classList.toggle("active", state.rulerMode);
  if (!state.rulerMode) $("rulerSvg").innerHTML = "";
});

// undoes the baked-in rotation, mapping a canvas-local point (in the
// ROTATED canvas's own pixel space) back to the pre-rotation layout, whose
// aspect ratio matches the original file.
function unrotateLocal(clx, cly, canvasW, canvasH, rotation) {
  switch (rotation) {
    case 90: return { x: canvasH - cly, y: clx };
    case 180: return { x: canvasW - clx, y: canvasH - cly };
    case 270: return { x: cly, y: canvasW - clx };
    default: return { x: clx, y: cly };
  }
}

// converts a mouse position into a pixel coordinate in the ORIGINAL file's
// resolution (undoing pan/zoom/mirror/rotation and the interactive-view
// downscale) so measurements stay correct regardless of view state.
function screenToFilePixels(clientX, clientY) {
  const stageRect = stage.getBoundingClientRect();
  const canvas = $("mainCanvas");
  const sx = clientX - stageRect.left, sy = clientY - stageRect.top;
  const { clx, cly } = screenToCanvasLocal(sx, sy);
  const { x: ux, y: uy } = unrotateLocal(clx, cly, canvas.width, canvas.height, state.rotation);
  const ref = state.plates[0];
  return {
    x: state.cropOrigin.x + ux * state.cropScale,
    y: state.cropOrigin.y + uy * state.cropScale,
    dpi: ref ? ref.dpi : null
  };
}

function rulerMouseDown(e) {
  const stageRect = stage.getBoundingClientRect();
  rulerDragging = true;
  rulerP1Screen = { sx: e.clientX - stageRect.left, sy: e.clientY - stageRect.top };
  rulerP1File = screenToFilePixels(e.clientX, e.clientY);
}

function rulerMouseMove(e) {
  const stageRect = stage.getBoundingClientRect();
  const p2Screen = { sx: e.clientX - stageRect.left, sy: e.clientY - stageRect.top };
  const p2File = screenToFilePixels(e.clientX, e.clientY);
  const dx = p2File.x - rulerP1File.x, dy = p2File.y - rulerP1File.y;
  const pxDist = Math.sqrt(dx * dx + dy * dy);
  let label = Math.round(pxDist) + " px";
  if (rulerP1File.dpi) {
    const inches = pxDist / rulerP1File.dpi;
    label += ` · ${inches.toFixed(3)}in · ${(inches * 25.4).toFixed(1)}mm`;
  }
  const midX = (rulerP1Screen.sx + p2Screen.sx) / 2, midY = (rulerP1Screen.sy + p2Screen.sy) / 2 - 10;
  $("rulerSvg").innerHTML = `
    <line x1="${rulerP1Screen.sx}" y1="${rulerP1Screen.sy}" x2="${p2Screen.sx}" y2="${p2Screen.sy}"></line>
    <circle cx="${rulerP1Screen.sx}" cy="${rulerP1Screen.sy}" r="4"></circle>
    <circle cx="${p2Screen.sx}" cy="${p2Screen.sy}" r="4"></circle>
    <text x="${midX}" y="${midY}" text-anchor="middle">${label}</text>
  `;
}

/* ---- export snapshot ---- */
$("btnExportPng").addEventListener("click", () => {
  buildFullResComposite().toBlob(async (blob) => {
    const data = new Uint8Array(await blob.arrayBuffer());
    const savedPath = await window.desktop.saveReportFile({
      jobFolderPath: state.jobFolderPath,
      operatorName: state.operatorName,
      filename: `${state.jobName}_composite-check.png`,
      data,
      isText: false
    });
    showToast("Snapshot saved to " + savedPath, savedPath);
  });
});

/* ============================================================
   QC report (operator name + veg logo check + plate list + snapshot)
   ============================================================ */
function checklistStorageKey() { return "tiffcheck_checklist_" + state.jobName; }

function loadChecklistState() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(checklistStorageKey())); } catch (e) { /* ignore corrupt data */ }
  state.operatorName = (saved && saved.operator) || "";
  state.vegLogoChecked = !!(saved && saved.vegLogoChecked);
  $("operatorName").value = state.operatorName;
  $("vegLogoCheck").checked = state.vegLogoChecked;
}

function saveChecklistState() {
  try {
    localStorage.setItem(checklistStorageKey(), JSON.stringify({
      operator: state.operatorName, vegLogoChecked: state.vegLogoChecked
    }));
  } catch (e) { /* localStorage unavailable (private browsing, quota) - still works, just won't persist */ }
}

$("vegLogoCheck").addEventListener("change", (e) => { state.vegLogoChecked = e.target.checked; saveChecklistState(); });
$("operatorName").addEventListener("input", (e) => { state.operatorName = e.target.value; saveChecklistState(); });

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function buildReportHtml() {
  const now = new Date();
  const snapshotDataUrl = $("mainCanvas").toDataURL("image/png");
  const plateRows = state.order.map(id => {
    const p = plateById(id);
    return `<tr><td><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${cmykHex(p.color)};border:1px solid #333;vertical-align:middle;"></span></td><td>${escapeHtml(p.name)}</td><td>${p.visible ? "on" : "off"}</td></tr>`;
  }).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>QC Report — ${escapeHtml(state.jobName)}</title>
  <style>
    body{font:14px/1.4 -apple-system,Arial,sans-serif;max-width:820px;margin:24px auto;color:#222;}
    h1{font-size:20px;margin-bottom:0;} .meta{color:#666;margin-top:4px;margin-bottom:20px;}
    table{border-collapse:collapse;width:100%;margin-bottom:24px;} td,th{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;font-size:13px;}
    img{max-width:100%;border:1px solid #ccc;}
    .summary{display:inline-block;background:#eef5ee;border:1px solid #bcd9bc;border-radius:6px;padding:6px 12px;font-weight:600;}
  </style></head><body>
  <h1>QC Report — ${escapeHtml(state.jobName)}</h1>
  <div class="meta">Checked by <strong>${escapeHtml(state.operatorName || "—")}</strong> on ${now.toLocaleString()}${state.mirrored ? " · view: Reverse (mirrored)" : " · view: Surface (normal)"}${state.rotation ? " · rotated " + state.rotation + "°" : ""}</div>
  <div class="summary">${state.vegLogoChecked ? "✅" : "⬜"} Veg/Non-veg logo correct &amp; registered</div>
  <h3>Plates (top of table = top of stack)</h3>
  <table>${plateRows}</table>
  <h3>Composite snapshot</h3>
  <img src="${snapshotDataUrl}">
  </body></html>`;
}

$("btnSaveReport").addEventListener("click", async () => {
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const savedPath = await window.desktop.saveReportFile({
    jobFolderPath: state.jobFolderPath,
    operatorName: state.operatorName,
    filename: `${state.jobName}_${stamp}_QC-Report.html`,
    data: buildReportHtml(),
    isText: true
  });
  showToast("QC report saved to " + savedPath, savedPath);
});

/* ============================================================
   Compare with JPEG (blink / slider blend)
   ============================================================ */
$("btnCompareJpeg").addEventListener("click", async () => {
  let jpegFile = state.jpegFiles[0];
  if (state.jpegFiles.length > 1) {
    const names = state.jpegFiles.map((f, i) => `${i + 1}: ${f.name}`).join("\n");
    const pick = prompt("Multiple JPEGs found in the folder. Enter the number to use:\n" + names, "1");
    const idx = (parseInt(pick, 10) || 1) - 1;
    jpegFile = state.jpegFiles[idx] || state.jpegFiles[0];
  }
  if (!jpegFile) {
    // manual fallback picker - read via the File object's own bytes rather than
    // relying on a disk path, since Electron doesn't reliably expose one here
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/jpeg";
    inp.onchange = async () => {
      if (!inp.files[0]) return;
      openCompareWithBytes(new Uint8Array(await inp.files[0].arrayBuffer()));
    };
    inp.click();
    return;
  }
  openCompareWithBytes(await window.desktop.readFile(jpegFile.path));
});

// Reads dpi from a JPEG's JFIF or Exif header, if present. Returns {x,y} or
// null. Best-effort: many web-exported JPEGs carry no real resolution info
// at all, which is exactly why the Proof DPI field stays editable.
function parseJpegDpi(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start, len) => {
    let s = "";
    for (let i = 0; i < len && start + i < bytes.length; i++) s += String.fromCharCode(bytes[start + i]);
    return s;
  };
  if (bytes.length < 4 || dv.getUint16(0) !== 0xffd8) return null;
  let offset = 2, jfif = null, exif = null;
  while (offset + 4 <= bytes.length) {
    if (dv.getUint8(offset) !== 0xff) break;
    let marker = dv.getUint8(offset + 1);
    while (marker === 0xff && offset + 2 < bytes.length) { offset++; marker = dv.getUint8(offset + 1); }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (marker === 0xda || offset + 4 > bytes.length) break; // start of scan data - no more header segments
    const segLen = dv.getUint16(offset + 2);
    if (marker === 0xe0 && segLen >= 14 && ascii(offset + 4, 5) === "JFIF\0") {
      const base = offset + 4;
      const units = dv.getUint8(base + 7);
      const xd = dv.getUint16(base + 8), yd = dv.getUint16(base + 10);
      if (xd > 0 && yd > 0) jfif = units === 2 ? { x: xd * 2.54, y: yd * 2.54 } : { x: xd, y: yd };
    } else if (marker === 0xe1 && ascii(offset + 4, 6) === "Exif\0\0") {
      exif = parseExifResolution(dv, offset + 4 + 6);
    }
    offset += 2 + segLen;
  }
  const result = exif || jfif;
  // some tools (older Pillow among them) write a meaningless 1x1 "dpi"
  // placeholder rather than omitting density entirely - never a real value
  return (result && result.x >= 10 && result.y >= 10) ? result : null;
}

function parseExifResolution(dv, tiffStart) {
  try {
    const little = dv.getUint8(tiffStart) === 0x49; // 'I' => "II" little-endian
    const g16 = (o) => dv.getUint16(tiffStart + o, little);
    const g32 = (o) => dv.getUint32(tiffStart + o, little);
    if (g16(2) !== 0x002a) return null;
    const ifd = g32(4);
    const count = g16(ifd);
    let x = null, y = null, unit = 2;
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      const tag = g16(e);
      if (tag === 0x011a || tag === 0x011b) {
        const voff = g32(e + 8);
        const num = g32(voff), den = g32(voff + 4);
        const val = den ? num / den : 0;
        if (tag === 0x011a) x = val; else y = val;
      } else if (tag === 0x0128) {
        unit = g16(e + 8);
      }
    }
    if (!x || !y) return null;
    if (unit === 3) { x *= 2.54; y *= 2.54; } // cm -> inch
    return { x, y };
  } catch (e) { return null; } // malformed/truncated Exif - fall back to JFIF or manual entry
}

// A proof JPEG and the job's TIFFs are almost never the same dpi (a common
// case: proofs exported at 300dpi, engraving TIFFs at 508dpi) - drawing both
// at face-value pixel size would make the proof the wrong physical size no
// matter how it's dragged. Read the JPEG's own resolution where possible
// (JFIF/Exif) to pre-scale it correctly; it's also an editable field so the
// operator can correct/enter it when a proof has no embedded dpi.
function openCompareWithBytes(bytes) {
  const jobDpi = state.plates[0] && state.plates[0].dpi;
  $("jobDpiHint").textContent = jobDpi ? `Job: ~${Math.round(jobDpi)} dpi` : "";
  const parsedDpi = parseJpegDpi(bytes);
  // 300dpi is far and away the most common proof export resolution - a far
  // better default starting guess than leaving the field blank (which would
  // mean "assume same dpi as the job", rarely true) when nothing is embedded
  $("proofDpi").value = parsedDpi ? Math.round(parsedDpi.x) : 300;

  const img = new Image();
  img.onload = () => {
    state.compare.jpegImg = img;
    state.compare.jpegOffsetX = 0;
    state.compare.jpegOffsetY = 0;
    recomputeProofScale();
    $("compareOverlay").classList.remove("hidden");
    $("compareSlider").value = 0;
    state.compare.mode = "slider";
    drawCompare();
  };
  img.src = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
}

function drawMainMirrorAware(ctx, w, h, sourceCanvas) {
  if (state.mirrored) {
    ctx.save();
    ctx.translate(w, 0); ctx.scale(-1, 1);
    ctx.drawImage(sourceCanvas, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(sourceCanvas, 0, 0, w, h);
  }
}

// the TIFF job is usually step-and-repeat (many copies tiled across the
// plate) but the JPEG proof from the press/customer is usually a single-up
// shot of one repeat - so the proof needs to be dragged/scaled into place
// over one repeat before blink/slider comparison means anything.
function drawJpegLayer(ctx) {
  const img = state.compare.jpegImg;
  if (!img) return;
  // draw at the proof's own real pixel size (not stretched to the composite's
  // size) - the TIFF job is step-and-repeat and the proof is a single-up
  // shot of one repeat, so they are never the same size, and stretching one
  // to fill the other is exactly what made it impossible to align them
  ctx.save();
  ctx.translate(state.compare.jpegOffsetX, state.compare.jpegOffsetY);
  ctx.scale(state.compare.jpegScale, state.compare.jpegScale);
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
  ctx.restore();
}

function drawCompare() {
  const canvas = $("compareCanvas");
  // the comparison is always against the whole job, never just whatever
  // sub-region deep-zoom crop mode happens to have on screen right now
  const main = state.cropMode ? buildWholeFileComposite().canvas : $("mainCanvas");
  canvas.width = main.width; canvas.height = main.height;
  const ctx = canvas.getContext("2d");
  const img = state.compare.jpegImg;

  if (state.compare.mode === "blink") {
    if (state.compare.blinkShowJpeg && img) {
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawJpegLayer(ctx);
    } else {
      drawMainMirrorAware(ctx, canvas.width, canvas.height, main);
    }
  } else {
    drawMainMirrorAware(ctx, canvas.width, canvas.height, main);
    if (img) {
      ctx.globalAlpha = (+$("compareSlider").value) / 100;
      drawJpegLayer(ctx);
      ctx.globalAlpha = 1;
    }
  }
}

$("compareSlider").addEventListener("input", () => { state.compare.mode = "slider"; drawCompare(); });
$("compareCanvas").addEventListener("click", () => {
  if (state.compare.positioning) return; // a plain click while positioning is just the end of a drag
  state.compare.mode = "blink";
  state.compare.blinkShowJpeg = !state.compare.blinkShowJpeg;
  drawCompare();
});
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !$("compareOverlay").classList.contains("hidden")) {
    e.preventDefault();
    state.compare.mode = "blink";
    state.compare.blinkShowJpeg = !state.compare.blinkShowJpeg;
    drawCompare();
  }
});
let autoBlinkTimer = null;
function stopAutoBlink() {
  if (!autoBlinkTimer) return;
  clearInterval(autoBlinkTimer);
  autoBlinkTimer = null;
  $("btnAutoBlink").classList.remove("active");
  $("btnAutoBlink").textContent = "▶ Auto Blink";
}
$("btnAutoBlink").addEventListener("click", () => {
  if (autoBlinkTimer) { stopAutoBlink(); return; }
  $("btnAutoBlink").classList.add("active");
  $("btnAutoBlink").textContent = "■ Stop Blink";
  autoBlinkTimer = setInterval(() => {
    state.compare.mode = "blink";
    state.compare.blinkShowJpeg = !state.compare.blinkShowJpeg;
    drawCompare();
  }, 600);
});

$("compareClose").addEventListener("click", () => {
  $("compareOverlay").classList.add("hidden");
  stopAutoBlink();
});

$("btnPositionProof").addEventListener("click", () => {
  state.compare.positioning = !state.compare.positioning;
  $("btnPositionProof").classList.toggle("active", state.compare.positioning);
  $("compareCanvas").classList.toggle("positioning", state.compare.positioning);
});
function recomputeProofScale() {
  const jobDpi = state.plates[0] && state.plates[0].dpi;
  const proofDpi = +$("proofDpi").value;
  state.compare.jpegScale = (jobDpi && proofDpi > 0) ? jobDpi / proofDpi : 1;
  drawCompare();
}
$("proofDpi").addEventListener("input", recomputeProofScale);

$("btnResetProofPosition").addEventListener("click", () => {
  state.compare.jpegOffsetX = 0; state.compare.jpegOffsetY = 0;
  recomputeProofScale();
});

// DPI-based scaling needs a correct dpi on both sides - when that's not
// available/trustworthy, this is a simple fallback that just scales the
// proof to fit inside the same window as the composite (not physically
// accurate, but gets it roughly the right size to align by eye, then
// Position Proof can nudge/scale it further from there).
$("btnFitProof").addEventListener("click", () => {
  const img = state.compare.jpegImg;
  const canvas = $("compareCanvas");
  if (!img || !canvas.width) return;
  const fitScale = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
  state.compare.jpegScale = fitScale;
  state.compare.jpegOffsetX = (canvas.width - img.naturalWidth * fitScale) / 2;
  state.compare.jpegOffsetY = (canvas.height - img.naturalHeight * fitScale) / 2;
  drawCompare();
});

let proofDragging = false, proofLastX = 0, proofLastY = 0;
$("compareCanvas").addEventListener("mousedown", (e) => {
  if (!state.compare.positioning) return;
  proofDragging = true;
  proofLastX = e.clientX; proofLastY = e.clientY;
});
window.addEventListener("mousemove", (e) => {
  if (!proofDragging) return;
  const dx = e.clientX - proofLastX, dy = e.clientY - proofLastY;
  // the comparison canvas is shown scaled to fit the window (max-width/height:100%),
  // so convert screen-pixel drag distance into the canvas's own pixel units
  const canvas = $("compareCanvas");
  const rect = canvas.getBoundingClientRect();
  const k = rect.width ? canvas.width / rect.width : 1;
  state.compare.jpegOffsetX += dx * k;
  state.compare.jpegOffsetY += dy * k;
  proofLastX = e.clientX; proofLastY = e.clientY;
  drawCompare();
});
window.addEventListener("mouseup", () => { proofDragging = false; });
$("compareCanvas").addEventListener("wheel", (e) => {
  if (!state.compare.positioning) return;
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
  state.compare.jpegScale = clamp(state.compare.jpegScale * factor, 0.05, 20);
  drawCompare();
}, { passive: false });
