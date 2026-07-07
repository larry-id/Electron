// 제어판 렌더러용 preload — 안전한 API만 노출 (contextIsolation 켜짐)
const { contextBridge, ipcRenderer } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

// <webview>에 주입할 게스트 preload의 file:// URL.
// preload는 Node 컨텍스트라 __dirname을 쓸 수 있으므로 동기적으로 계산해 노출한다.
const webviewPreloadURL = pathToFileURL(
  path.join(__dirname, "webview-preload.js")
).href;

contextBridge.exposeInMainWorld("api", {
  webviewPreloadURL,

  // 시나리오 영속화 (main이 userData/scenarios.json으로 관리)
  listScenarios: () => ipcRenderer.invoke("scenario:list"),
  loadScenario: (name) => ipcRenderer.invoke("scenario:load", name),
  saveScenario: (name, steps) => ipcRenderer.invoke("scenario:save", name, steps),
  deleteScenario: (name) => ipcRenderer.invoke("scenario:delete", name),

  // JSON 내보내기/가져오기 (네이티브 대화상자)
  exportSteps: (steps, suggestedName) =>
    ipcRenderer.invoke("export:steps", steps, suggestedName),
  importSteps: () => ipcRenderer.invoke("import:steps")
});
