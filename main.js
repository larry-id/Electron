// Nori-TC — Electron main process
// Chrome 확장의 background.js가 했던 일 중 "파일/대화상자"만 main이 맡는다.
// 녹화/재생 상태 관리는 제어판 렌더러(renderer.js)가 단일 소스로 유지한다.
// (renderer는 <webview> 네비게이션에도 살아남으므로 background.js 역할을 대신할 수 있다.)

const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs/promises");
const path = require("path");

let win = null;

// ---- 자동 업데이트 (electron-updater / GitHub Releases) ----
// 배포된(설치된) 앱에서만 동작한다. dev(electron .) 에서는 업데이트 메타가 없어
// checkForUpdates가 실패하므로 app.isPackaged로 가드한다.
function setupAutoUpdate() {
  if (!app.isPackaged) return; // 개발 모드에서는 건너뜀

  autoUpdater.autoDownload = false;          // 다운로드 전에 사용자에게 먼저 물어본다
  autoUpdater.autoInstallOnAppQuit = false;  // 종료 시 자동 설치 안 함 — 사용자가 "지금 재시작"을 눌러야만 설치

  autoUpdater.on("error", (err) => {
    console.error("[updater] error:", err == null ? "unknown" : (err.stack || err).toString());
  });

  // 새 버전 발견 → 다운로드 여부를 사용자에게 먼저 물어본다.
  autoUpdater.on("update-available", async (info) => {
    console.log("[updater] 새 버전 발견:", info.version);
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      buttons: ["다운로드", "나중에"],
      defaultId: 0,
      cancelId: 1,
      title: "업데이트 있음",
      message: `새 버전 ${info.version} 이(가) 있습니다.`,
      detail: "지금 다운로드하시겠습니까? 다운로드가 끝나면 재시작 여부를 다시 여쭤봅니다."
    });
    if (response === 0) {
      autoUpdater.downloadUpdate().catch((err) => {
        console.error("[updater] 다운로드 실패:", err);
      });
    }
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] 최신 버전입니다.");
  });

  // 다운로드 완료 → 사용자에게 지금 재시작할지 물어본다.
  autoUpdater.on("update-downloaded", async (info) => {
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      buttons: ["지금 재시작", "나중에"],
      defaultId: 0,
      cancelId: 1,
      title: "업데이트 준비 완료",
      message: `새 버전 ${info.version} 이(가) 다운로드되었습니다.`,
      detail: "지금 재시작하면 업데이트가 적용됩니다. '나중에'를 선택하면 다음 종료 시 자동 설치됩니다."
    });
    if (response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  // 시작 시 1회 확인 (에러는 위 error 핸들러가 처리)
  autoUpdater.checkForUpdates().catch(() => {});
}

// 시나리오 저장소: userData/scenarios.json 에 { name: steps[] } 형태로 보관
function scenariosFile() {
  return path.join(app.getPath("userData"), "scenarios.json");
}

async function readScenarios() {
  try {
    const raw = await fs.readFile(scenariosFile(), "utf-8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch (_) {
    return {}; // 파일 없음/손상 시 빈 객체
  }
}

async function writeScenarios(obj) {
  await fs.writeFile(scenariosFile(), JSON.stringify(obj, null, 2), "utf-8");
}

// 기본 메뉴의 Zoom In/Out/Reset(Ctrl +/-/0)은 webview 페이지가 아니라 제어판 UI를
// 확대/축소해서 "동작하지 않는 것처럼" 보인다. zoom 항목을 뺀 커스텀 메뉴를 설정해
// 단축키가 렌더러/게스트의 zoom 핸들러로 전달되게 한다.
function buildMenu() {
  const template = [
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" }
        // Zoom 항목은 의도적으로 제외 (renderer.js / webview-preload.js가 처리)
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  buildMenu();
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "Nori-TC",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,   // preload(path/url require)와 webview 게스트 preload(ipcRenderer) 사용을 위해 비활성화
      webviewTag: true  // 대상 페이지를 <webview>로 띄우기 위해 필요
    }
  });

  win.loadFile("index.html");
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdate();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---- 시나리오 관리 (chrome.storage.local 대체) ----
ipcMain.handle("scenario:list", async () => {
  const all = await readScenarios();
  return Object.keys(all).sort();
});

ipcMain.handle("scenario:load", async (_e, name) => {
  const all = await readScenarios();
  return all[name] || [];
});

ipcMain.handle("scenario:save", async (_e, name, steps) => {
  const all = await readScenarios();
  all[name] = steps || [];
  await writeScenarios(all);
  return { ok: true };
});

ipcMain.handle("scenario:delete", async (_e, name) => {
  const all = await readScenarios();
  delete all[name];
  await writeScenarios(all);
  return { ok: true };
});

// ---- 내보내기: 네이티브 "다른 이름으로 저장" 대화상자 + 파일 쓰기 ----
// chrome.downloads.download({ saveAs: true }) 대체.
ipcMain.handle("export:steps", async (_e, steps, suggestedName) => {
  const payload = {
    app: "Nori-TC",
    version: 2,
    stepCount: (steps || []).length,
    steps: steps || []
  };
  const safe = (suggestedName || "nori-tc-log").replace(/[\\/:*?"<>|]/g, "_");
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "시나리오 내보내기",
    defaultPath: `${safe}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (canceled || !filePath) return { canceled: true };

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
  const base = path.basename(filePath).replace(/\.json$/i, "");
  return { canceled: false, name: base };
});

// ---- 가져오기: 네이티브 "열기" 대화상자 + 파일 읽기 ----
ipcMain.handle("import:steps", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "시나리오 가져오기",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (canceled || !filePaths.length) return { canceled: true };

  const filePath = filePaths[0];
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    const steps = Array.isArray(data) ? data : data.steps;
    if (!Array.isArray(steps)) throw new Error("형식 오류");
    const base = path.basename(filePath).replace(/\.json$/i, "");
    return { canceled: false, name: base, steps };
  } catch (_) {
    return { canceled: false, error: "올바른 JSON 시나리오 파일이 아닙니다." };
  }
});
