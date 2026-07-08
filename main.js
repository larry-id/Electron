// Nori-TC — Electron main process
// Chrome 확장의 background.js가 했던 일 중 "파일/대화상자"만 main이 맡는다.
// 녹화/재생 상태 관리는 제어판 렌더러(renderer.js)가 단일 소스로 유지한다.
// (renderer는 <webview> 네비게이션에도 살아남으므로 background.js 역할을 대신할 수 있다.)

const { app, BrowserWindow, ipcMain, dialog, safeStorage, session } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs/promises");
const path = require("path");

let win = null;        // 현재 활성 메인 창(대화상자/updater 부모로 사용)
let loginWin = null;   // 로그인 창(입력 폼 전용)
let mainWin = null;    // 메인(앱) 창(자동 로그인 + 앱)
let updaterStarted = false;
let loginError = null; // 로그인 창에 표시할 오류 메시지(실패로 되돌아온 경우)

// ---- 자동 업데이트 (electron-updater / GitHub Releases) ----
// 배포된(설치된) 앱에서만 동작한다. dev(electron .) 에서는 업데이트 메타가 없어
// checkForUpdates가 실패하므로 app.isPackaged로 가드한다.
function setupAutoUpdate() {
  if (!app.isPackaged) return; // 개발 모드에서는 건너뜀
  if (updaterStarted) return;  // 메인 창 생성 시 1회만
  updaterStarted = true;

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

function winPrefs() {
  return {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,   // preload(path/url require)와 webview 게스트 preload(ipcRenderer) 사용을 위해 비활성화
    webviewTag: true  // 대상 페이지를 <webview>로 띄우기 위해 필요
  };
}

// 로그인 창: 사용자에게 보이는 앱 자체 로그인 화면. 내부의 숨은 webview가 실제 인증을 수행한다.
function createLoginWindow() {
  if (loginWin) { loginWin.focus(); return; }
  loginWin = new BrowserWindow({
    width: 480,
    height: 680,
    resizable: false,
    title: "Nori-TC 로그인",
    webPreferences: winPrefs()
  });
  loginWin.removeMenu();            // 로그인 창은 메뉴바(File/Edit/View) 숨김
  loginWin.setMenuBarVisibility(false);
  loginWin.loadFile("login.html");
  loginWin.on("closed", () => { loginWin = null; });
}

// 메인 창: 로그인 성공 후 열리는 실제 앱 화면(webview + 제어판).
function createMainWindow() {
  if (mainWin) { mainWin.focus(); return; }
  mainWin = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "Nori-TC",
    webPreferences: winPrefs()
  });
  mainWin.removeMenu();             // 메뉴바(File/Edit/View) 제거
  mainWin.setMenuBarVisibility(false);
  win = mainWin; // 대화상자/updater 부모
  mainWin.loadFile("index.html");
  mainWin.on("closed", () => { if (win === mainWin) win = null; mainWin = null; });
  setupAutoUpdate();
}

// 저장된 자격증명(이전 로그인 내역) 존재 여부
async function credsExist() {
  try { await fs.access(credsFile()); return true; } catch (_) { return false; }
}

app.whenReady().then(async () => {
  // 이전 로그인 내역이 있으면 로그인 창을 건너뛰고 메인 창으로 바로 진입(메인 창이 자동 로그인 수행).
  // 없거나 로그아웃한 경우에만 로그인 창을 띄운다.
  if (await credsExist()) createMainWindow();
  else createLoginWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (await credsExist()) createMainWindow();
      else createLoginWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---- 창 전환 (로그인 ↔ 메인) ----
// 로그인 창 제출 성공 → 메인 창을 먼저 열고 로그인 창을 닫는다(창 0개로 앱 종료 방지).
ipcMain.handle("login:success", () => {
  loginError = null;
  createMainWindow();
  if (loginWin) loginWin.close();
  return { ok: true };
});

// 메인 창의 자동 로그인이 실패 → 로그인 창(폼+오류)으로 되돌림.
ipcMain.handle("auth:loginFailed", (_e, msg) => {
  loginError = msg || "로그인에 실패했습니다.";
  createLoginWindow();
  if (mainWin) mainWin.close();
  return { ok: true };
});

// 로그아웃 → 자격증명 + 세션 삭제 후 로그인 창으로(다른 아이디로 접속하는 길목)
ipcMain.handle("auth:relogin", async () => {
  try { await fs.unlink(credsFile()); } catch (_) {}
  try { await session.fromPartition("persist:noritc").clearStorageData(); } catch (_) {}
  loginError = null;
  createLoginWindow();
  if (mainWin) mainWin.close();
  return { ok: true };
});

// 로그인 창이 읽어가는 상태(직전 실패 오류 메시지). 한 번 읽으면 비운다.
ipcMain.handle("login:mode", () => {
  const e = loginError; loginError = null;
  return { error: e };
});

// 앱 버전(package.json version) — 로그인 창 제목 등에 표시용
ipcMain.handle("app:getVersion", () => app.getVersion());

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

// ---- 로그인 자격증명 저장 (safeStorage로 OS 키체인에 암호화) ----
// 자격증명은 소스코드에 절대 넣지 않는다. 사용자가 제어판에 입력한 값을
// "기억하기" 선택 시에만 userData/creds.dat 에 암호화하여 보관한다.
function credsFile() {
  return path.join(app.getPath("userData"), "creds.dat");
}

// 기억하기: remember=true 면 암호화 저장, false 면 저장 파일 삭제
ipcMain.handle("creds:save", async (_e, id, pw, remember) => {
  if (!remember) {
    try { await fs.unlink(credsFile()); } catch (_) {}
    return { ok: true, remembered: false };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    // 암호화가 불가한 환경에서는 평문 저장을 거부한다(보안).
    return { ok: false, reason: "이 환경에서는 암호화 저장을 사용할 수 없습니다." };
  }
  const payload = JSON.stringify({ id: id || "", pw: pw || "" });
  const enc = safeStorage.encryptString(payload).toString("base64");
  await fs.writeFile(credsFile(), JSON.stringify({ v: 1, enc }), "utf-8");
  return { ok: true, remembered: true };
});

// 저장된 자격증명 복호화하여 반환(없거나 실패 시 null)
ipcMain.handle("creds:load", async () => {
  try {
    const raw = await fs.readFile(credsFile(), "utf-8");
    const obj = JSON.parse(raw);
    if (!obj || !obj.enc || !safeStorage.isEncryptionAvailable()) return null;
    const dec = safeStorage.decryptString(Buffer.from(obj.enc, "base64"));
    const data = JSON.parse(dec);
    return { id: data.id || "", pw: data.pw || "" };
  } catch (_) {
    return null; // 파일 없음/복호화 실패
  }
});

ipcMain.handle("creds:clear", async () => {
  try { await fs.unlink(credsFile()); } catch (_) {}
  return { ok: true };
});

// 로그아웃: 저장된 자격증명 삭제 + webview 세션 쿠키/스토리지 삭제
ipcMain.handle("auth:logout", async () => {
  try { await fs.unlink(credsFile()); } catch (_) {}
  try { await session.fromPartition("persist:noritc").clearStorageData(); } catch (_) {}
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
