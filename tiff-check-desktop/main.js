const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs/promises");

const JOB_EXTENSIONS = new Set([".tif", ".tiff", ".jpg", ".jpeg", ".json"]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// recursively collects every TIFF/JPEG/JSON file under a folder (one level
// of subfolders is common for job exports; this also handles flat folders)
async function listJobFiles(rootDir) {
  const out = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "QC Reports") continue; // don't re-ingest our own output
        await walk(full);
      } else if (JOB_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const stat = await fs.stat(full);
        out.push({ name: entry.name, path: full, size: stat.size });
      }
    }
  }
  await walk(rootDir);
  return out;
}

ipcMain.handle("choose-job-folder", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths.length) return null;
  const folderPath = result.filePaths[0];
  const files = await listJobFiles(folderPath);
  return { folderPath, folderName: path.basename(folderPath), files };
});

ipcMain.handle("read-file", async (_evt, filePath) => {
  const buf = await fs.readFile(filePath);
  return new Uint8Array(buf);
});

ipcMain.handle("choose-json-file", async (_evt, startDir) => {
  const result = await dialog.showOpenDialog({
    defaultPath: startDir,
    filters: [{ name: "Saved colors", extensions: ["json"] }],
    properties: ["openFile"]
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  const text = await fs.readFile(filePath, "utf8");
  return { path: filePath, text };
});

// Saves straight into <jobFolder>/QC Reports/<operator>/<filename> - created
// automatically, so there is a real, per-operator, job-wise folder on disk
// instead of a browser download with no fixed home.
ipcMain.handle("save-report-file", async (_evt, { jobFolderPath, operatorName, filename, data, isText }) => {
  const safeOperator = (operatorName || "unassigned").replace(/[^a-z0-9 _-]+/gi, "_").trim() || "unassigned";
  const dir = path.join(jobFolderPath, "QC Reports", safeOperator);
  await fs.mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, filename);
  if (isText) {
    await fs.writeFile(fullPath, data, "utf8");
  } else {
    await fs.writeFile(fullPath, Buffer.from(data));
  }
  return fullPath;
});

ipcMain.handle("reveal-in-folder", async (_evt, filePath) => {
  shell.showItemInFolder(filePath);
});
