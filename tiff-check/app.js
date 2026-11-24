"use strict";

/* ============================================================
   State
   ============================================================ */
const state = {
  jobName: "",
  allFiles: [],          // every File from the chosen folder
  headerInfo: [],        // [{file, name, width, height, dpi, samplesPerPixel}] - cheap header read
  selectedGroupKey: null,
  plates: [],            // finalized plate objects (see makePlate)
  jpegFiles: [],         // candidate proof JPEGs found in the folder
  order: [],             // array of plate ids, bottom -> top
  scale: 1,
  panX: 0,
  panY: 0,
  compare: { mode: "slider", blinkShowJpeg: false, jpegImg: null },
  fallbackIdx: 0
};

const FALLBACK_PALETTE = ["#808080", "#ff8c00", "#8a2be2", "#8b4513", "#20b2aa", "#dc143c", "#2e8b57", "#4169e1"];

/* ============================================================
   Small helpers
   ============================================================ */
function $(id) { return document.getElementById(id); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function extOf(name) { const m = /\.([a-z0-9]+)$/i.exec(name); return m ? m[1].toLowerCase() : ""; }
function uid() { return "p" + Math.random().toString(36).slice(2, 10); }

function cmykToRgb(c, m, y, k) {
  c /= 100; m /= 100; y /= 100; k /= 100;
  return [
    Math.round(255 * (1 - c) * (1 - k)),
    Math.round(255 * (1 - m) * (1 - k)),
    Math.round(255 * (1 - y) * (1 - k))
  ];
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

function showScreen(id) {
  for (const s of document.querySelectorAll(".screen")) s.classList.add("hidden");
  $(id).classList.remove("hidden");
}

/* ============================================================
   Step 1: choose folder, read TIFF headers cheaply
   ============================================================ */
$("btnChooseFolder").addEventListener("click", () => $("folderInput").click());
$("dropZone").addEventListener("click", (e) => { if (e.target.tagName !== "BUTTON") $("folderInput").click(); });

$("folderInput").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  state.allFiles = files;
  const firstPath = files[0].webkitRelativePath || files[0].name;
  state.jobName = firstPath.split("/")[0] || "Job";

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
      const buf = await file.arrayBuffer();
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
});

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
  const rgba = UTIF.toRGBA8(h.page);
  const w = h.page.width, h_ = h.page.height;
  const isComposite = h.samplesPerPixel > 1;

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
    dpi: h.dpi,
    mismatch: (w + "x" + h_) !== refSize,
    isComposite,
    rgba,                 // raw decoded RGBA (used directly for composite TIFFs)
    color: cmyk,
    colorKind: kind,      // "normal" | "white" | "varnish" | "unassigned"
    visible: true,
    layerCanvas: null      // built lazily / on color change
  };
  buildLayerCanvas(plate);
  return plate;
}

/* Tint a decoded grayscale separation with its assigned color, using
   ink coverage (dark = more ink) as the alpha channel so layers can be
   multiply-blended like real overprinting ink. */
function buildLayerCanvas(plate) {
  const w = plate.width, h = plate.height;
  const cnv = document.createElement("canvas");
  cnv.width = w; cnv.height = h;
  const ctx = cnv.getContext("2d");

  if (plate.isComposite) {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(plate.rgba.buffer.slice(0)), w, h), 0, 0);
    plate.layerCanvas = cnv;
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
  ctx.drawImage(plate.layerCanvas, 0, 0, canvasEl.width, canvasEl.height);
}

$("assignBack").addEventListener("click", () => showScreen("screen-load"));
$("assignContinue").addEventListener("click", enterViewer);

/* ============================================================
   Color popover (CMYK sliders + hue/sat wheel + presets)
   ============================================================ */
const PRESETS = [
  { label: "Process Cyan", cmyk: { c: 100, m: 0, y: 0, k: 0 } },
  { label: "Process Magenta", cmyk: { c: 0, m: 100, y: 0, k: 0 } },
  { label: "Process Yellow", cmyk: { c: 0, m: 0, y: 100, k: 0 } },
  { label: "Process Black", cmyk: { c: 0, m: 0, y: 0, k: 100 } },
  { label: "White (tinted)", cmyk: { c: 0, m: 0, y: 0, k: 0 }, kind: "white" },
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
      <div class="pv-big" style="background:${rgbToHex(r, g, b)}"></div>
      <div class="wheel-wrap">
        <canvas id="pvWheel" width="120" height="120"></canvas>
        <div style="flex:1;">
          <div class="cmyk-row"><label>V</label><input type="range" id="pvValue" min="0" max="100" value="${Math.round(rgbToHsv(r,g,b).v*100)}"><span></span></div>
          <div class="meta" style="color:#9aa1ab;">Click the wheel for hue/saturation</div>
        </div>
      </div>
      <div class="cmyk-row"><label>C</label><input type="range" id="sC" min="0" max="100" value="${working.c}"><span>${working.c}</span></div>
      <div class="cmyk-row"><label>M</label><input type="range" id="sM" min="0" max="100" value="${working.m}"><span>${working.m}</span></div>
      <div class="cmyk-row"><label>Y</label><input type="range" id="sY" min="0" max="100" value="${working.y}"><span>${working.y}</span></div>
      <div class="cmyk-row"><label>K</label><input type="range" id="sK" min="0" max="100" value="${working.k}"><span>${working.k}</span></div>
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

    const presetsWrap = pop.querySelector("#pvPresets");
    PRESETS.forEach(p => {
      const sw = document.createElement("div");
      sw.className = "swatch";
      sw.title = p.label;
      sw.style.background = cmykHex(p.cmyk);
      sw.addEventListener("click", () => {
        working = { ...p.cmyk };
        if (p.kind) plate.colorKind = p.kind;
        pop.querySelector("#sC").value = working.c; pop.querySelector("#sM").value = working.m;
        pop.querySelector("#sY").value = working.y; pop.querySelector("#sK").value = working.k;
        syncSpans(); render2(); applyLive();
      });
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
    pop.querySelector(".pv-big").style.background = rgbToHex(...rgbNow());
    onApply();
  }

  function onWinMove(ev) { if (drag.active && currentPick) currentPick(ev); }
  function onWinUp() { drag.active = false; }
  function onDocClick(ev) { if (!pop.contains(ev.target) && ev.target !== anchorEl) closePopover(); }
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
$("btnLoadSession").addEventListener("click", () => $("sessionInput").click());
$("sessionInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    applySession(data);
  } catch (err) {
    alert("Could not read that session file: " + err.message);
  }
});

function saveSession() {
  const data = {
    job: state.jobName,
    savedAt: new Date().toISOString(),
    order: state.order,
    plates: state.plates.map(p => ({ name: p.name, color: p.color, colorKind: p.colorKind, visible: p.visible }))
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${state.jobName}_plate-colors.json`;
  a.click();
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
    renderLayerList(); renderTogglePills(); recomposite();
  }
}

/* ============================================================
   Viewer screen
   ============================================================ */
function enterViewer() {
  showScreen("screen-viewer");
  $("viewerJobName").textContent = state.jobName;
  renderLayerList();
  renderTogglePills();
  state.scale = null; // force a fit on first paint
  recomposite();
}
$("btnBackToAssign").addEventListener("click", () => showScreen("screen-assign"));

function plateById(id) { return state.plates.find(p => p.id === id); }

function renderLayerList() {
  const wrap = $("layerList");
  wrap.innerHTML = "";
  // top of list = top of stack, so render in reverse order
  [...state.order].reverse().forEach(id => {
    const plate = plateById(id);
    const row = document.createElement("div");
    row.className = "layer-item";
    row.draggable = true;
    row.dataset.id = id;
    row.innerHTML = `
      <span class="drag-handle">⠿</span>
      <input type="checkbox" ${plate.visible ? "checked" : ""}>
      <span class="swatch" style="background:${cmykHex(plate.color)}"></span>
      <span class="lname" title="${plate.name}">${plate.name}</span>
    `;
    row.querySelector('input[type="checkbox"]').addEventListener("change", (e) => {
      plate.visible = e.target.checked;
      renderTogglePills(); recomposite();
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
  renderTogglePills();
  recomposite();
}

function renderTogglePills() {
  const wrap = $("togglePills");
  wrap.innerHTML = "";
  state.order.forEach(id => {
    const plate = plateById(id);
    const pill = document.createElement("div");
    pill.className = "toggle-pill" + (plate.visible ? "" : " off");
    pill.title = "Click to toggle · Alt-click to solo this plate";
    pill.innerHTML = `<span class="dot" style="background:${cmykHex(plate.color)}"></span><span>${plate.name}</span>`;
    pill.addEventListener("click", (e) => {
      if (e.altKey) {
        state.plates.forEach(p => p.visible = (p.id === id));
      } else {
        plate.visible = !plate.visible;
      }
      renderLayerList(); renderTogglePills(); recomposite();
    });
    wrap.appendChild(pill);
  });
}

$("allOn").addEventListener("click", () => { state.plates.forEach(p => p.visible = true); renderLayerList(); renderTogglePills(); recomposite(); });
$("allOff").addEventListener("click", () => { state.plates.forEach(p => p.visible = false); renderLayerList(); renderTogglePills(); recomposite(); });

/* ---- compositing ---- */
function recomposite() {
  if (!state.plates.length) return;
  const w = Math.max(...state.plates.map(p => p.width));
  const h = Math.max(...state.plates.map(p => p.height));
  const canvas = $("mainCanvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  state.order.forEach(id => {
    const plate = plateById(id);
    if (!plate.visible) return;
    ctx.globalCompositeOperation = plate.isComposite ? "source-over" : "multiply";
    ctx.drawImage(plate.layerCanvas, 0, 0);
  });
  ctx.globalCompositeOperation = "source-over";
  applyTransform();
}

function applyTransform() {
  const canvas = $("mainCanvas");
  const stage = $("canvasStage");
  if (state.scale == null) {
    const fitScale = Math.min(stage.clientWidth / canvas.width, stage.clientHeight / canvas.height, 1) * 0.96;
    state.scale = fitScale > 0 ? fitScale : 1;
    state.panX = (stage.clientWidth - canvas.width * state.scale) / 2;
    state.panY = (stage.clientHeight - canvas.height * state.scale) / 2;
  }
  canvas.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
  canvas.style.transformOrigin = "0 0";
  $("zoomLabel").textContent = Math.round(state.scale * 100) + "%";
}

/* ---- zoom / pan ---- */
$("zoomIn").addEventListener("click", () => { state.scale = clamp((state.scale || 1) * 1.25, 0.02, 8); applyTransform(); });
$("zoomOut").addEventListener("click", () => { state.scale = clamp((state.scale || 1) / 1.25, 0.02, 8); applyTransform(); });
$("zoomFit").addEventListener("click", () => { state.scale = null; applyTransform(); });

const stage = $("canvasStage");
stage.addEventListener("wheel", (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  state.scale = clamp((state.scale || 1) * factor, 0.02, 8);
  applyTransform();
}, { passive: false });

let panning = false, lastX = 0, lastY = 0;
stage.addEventListener("mousedown", (e) => { panning = true; lastX = e.clientX; lastY = e.clientY; $("mainCanvas").classList.add("grabbing"); });
window.addEventListener("mousemove", (e) => {
  if (!panning) return;
  state.panX += e.clientX - lastX; state.panY += e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  applyTransform();
});
window.addEventListener("mouseup", () => { panning = false; $("mainCanvas").classList.remove("grabbing"); });
window.addEventListener("resize", () => { if (state.scale != null) return; applyTransform(); });

/* ---- export snapshot ---- */
$("btnExportPng").addEventListener("click", () => {
  $("mainCanvas").toBlob(blob => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${state.jobName}_composite-check.png`;
    a.click();
  });
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
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/jpeg";
    inp.onchange = () => { if (inp.files[0]) loadJpegAndOpenCompare(inp.files[0]); };
    inp.click();
    return;
  }
  loadJpegAndOpenCompare(jpegFile);
});

function loadJpegAndOpenCompare(file) {
  const img = new Image();
  img.onload = () => {
    state.compare.jpegImg = img;
    $("compareOverlay").classList.remove("hidden");
    $("compareSlider").value = 0;
    state.compare.mode = "slider";
    drawCompare();
  };
  img.src = URL.createObjectURL(file);
}

function drawCompare() {
  const canvas = $("compareCanvas");
  const main = $("mainCanvas");
  canvas.width = main.width; canvas.height = main.height;
  const ctx = canvas.getContext("2d");
  const img = state.compare.jpegImg;

  if (state.compare.mode === "blink") {
    if (state.compare.blinkShowJpeg && img) {
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.drawImage(main, 0, 0);
    }
  } else {
    ctx.drawImage(main, 0, 0);
    if (img) {
      ctx.globalAlpha = (+$("compareSlider").value) / 100;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
  }
}

$("compareSlider").addEventListener("input", () => { state.compare.mode = "slider"; drawCompare(); });
$("compareCanvas").addEventListener("click", () => {
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
$("compareClose").addEventListener("click", () => $("compareOverlay").classList.add("hidden"));
