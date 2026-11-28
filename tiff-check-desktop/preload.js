const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  chooseJobFolder: () => ipcRenderer.invoke("choose-job-folder"),
  readFile: (filePath) => ipcRenderer.invoke("read-file", filePath),
  chooseJsonFile: (startDir) => ipcRenderer.invoke("choose-json-file", startDir),
  saveReportFile: (args) => ipcRenderer.invoke("save-report-file", args),
  revealInFolder: (filePath) => ipcRenderer.invoke("reveal-in-folder", filePath)
});
