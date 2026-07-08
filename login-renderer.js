// Nori-TC — 로그인 창 렌더러
// 로그인 창의 (가려진) webview가 실제 사이트 로그인을 수행한다.
// 아이디/비밀번호가 맞아 사이트가 앱 페이지로 이동하면 → 자격증명 저장 후 메인 창을 연다.
// 틀리면 → 로그인 창에 오류를 표시하고 재입력을 받는다. (메인 창으로 넘어가지 않음)

const $ = (id) => document.getElementById(id);

const SITE_ROOT = "https://tc.noricloud.org/";
const LOGIN_URL = "https://tc.noricloud.org/login";
const SITE_RE = /^https?:\/\/tc\.noricloud\.org/i;
const isLoginUrl = (u) => typeof u === "string" && /tc\.noricloud\.org\/login/i.test(u);
const isSiteUrl = (u) => typeof u === "string" && SITE_RE.test(u);
// 앱 페이지(=로그인됨): 사이트이면서 /login 도 루트('/')도 아님
const isAppUrl = (u) =>
  isSiteUrl(u) && !isLoginUrl(u) &&
  !/^https?:\/\/tc\.noricloud\.org\/?($|[?#])/i.test(u);

const view = $("view");
view.setAttribute("preload", window.api.webviewPreloadURL);
view.setAttribute("src", LOGIN_URL); // 유효 세션이면 사이트가 앱 페이지로 리다이렉트

const screen = $("loginScreen");

let submitting = false; // 제출 결과 대기 중
let done = false;       // 인증 완료(메인 창 전환 요청됨)
let failing = false;    // 실패 처리 진행 중
let pendingCreds = null;
let watchTimer = null;
let settleTimer = null;

function showForm(errMsg) {
  screen.classList.remove("busy");
  $("ovErr").textContent = errMsg || "";
}
function showBusy(msg) {
  screen.classList.add("busy");
  screen.querySelector(".busyMsg").textContent = msg || "로그인 중…";
}
function sendToGuest(channel, ...args) {
  try { view.send(channel, ...args); } catch (_) {}
}

// ---- 비밀번호 표시/숨김 토글(눈 아이콘) ----
const EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

const togglePw = $("togglePw");
togglePw.innerHTML = EYE;
togglePw.addEventListener("click", () => {
  const revealing = $("ovPw").type === "password";
  $("ovPw").type = revealing ? "text" : "password";
  togglePw.innerHTML = revealing ? EYE_OFF : EYE;
  togglePw.title = revealing ? "비밀번호 숨기기" : "비밀번호 표시";
  togglePw.setAttribute("aria-label", togglePw.title);
  try { $("ovPw").focus(); } catch (_) {}
});

// 시작: 저장된 아이디/비밀번호 자동 채움(직전 실패면 비밀번호는 비움) + 오류 표시
(async () => {
  let mode = {};
  try { mode = (await window.api.loginMode()) || {}; } catch (_) {}
  let creds = null;
  try { creds = await window.api.loadCreds(); } catch (_) {}
  if (creds && creds.id) $("ovId").value = creds.id;
  if (creds && creds.pw && !mode.error) $("ovPw").value = creds.pw;
  showForm(mode.error || "");
  try { ($("ovId").value ? $("ovPw") : $("ovId")).focus(); } catch (_) {}
})();

// 창 제목에 앱 버전 표시 → "Nori-TC 로그인 v2.0.1"
(async () => {
  try {
    const v = await window.api.getVersion();
    if (v) document.title = `Nori-TC 로그인 v${v}`;
  } catch (_) {}
})();

// 제출 후 이 시간 안에 앱 페이지로 못 가면 실패로 간주(오류 문구 감지 실패 대비 안전망)
function startWatch() {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    if (!done && !failing && isLoginUrl(view.getURL())) {
      failing = true;
      submitting = false;
      showForm("아이디 또는 비밀번호가 올바르지 않습니다.");
    }
  }, 12000);
}

// 앱 페이지 도달 = 로그인 성공 → 자격증명 저장 후 메인 창으로
async function onAuth() {
  if (done) return;
  done = true;
  clearTimeout(watchTimer);
  if (pendingCreds) {
    await window.api.saveCreds(pendingCreds.id, pendingCreds.pw, true);
    pendingCreds = null;
  }
  showBusy("접속 중…");
  await window.api.loginSuccess();
}

function onSettled(url) {
  if (isAppUrl(url)) onAuth();
  // /login 이면: 초기엔 폼 표시(이미 됨), 제출 대기 중이면 결과 감시가 처리.
}
function scheduleSettle() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => onSettled(view.getURL()), 400);
}
view.addEventListener("did-stop-loading", scheduleSettle);
view.addEventListener("did-navigate", scheduleSettle);
view.addEventListener("did-navigate-in-page", scheduleSettle);

// 게스트(webview preload) 결과: 실패면 로그인 창에 오류 표시(메인으로 넘어가지 않음)
view.addEventListener("ipc-message", (e) => {
  if (e.channel !== "autologin-result") return;
  const a = e.args[0];
  if (!a || a.ok || done || failing) return;
  failing = true;
  submitting = false;
  clearTimeout(watchTimer);
  const msg = a.code === "no-form"
    ? "로그인 폼을 찾지 못했습니다: " + (a.reason || "")
    : "아이디 또는 비밀번호가 올바르지 않습니다.";
  showForm(msg);
});

// 사용자가 로그인 폼 제출 → webview에서 실제 로그인 시도
function submitLogin() {
  const id = $("ovId").value.trim();
  const pw = $("ovPw").value;
  if (!id || !pw) { $("ovErr").textContent = "아이디와 비밀번호를 입력하세요."; return; }
  pendingCreds = { id, pw };
  submitting = true;
  failing = false;
  showBusy("로그인 중…");
  startWatch();
  if (!isLoginUrl(view.getURL())) {
    try { view.loadURL(LOGIN_URL); } catch (_) { view.src = LOGIN_URL; }
  }
  sendToGuest("autologin", { id, pw, submit: true });
}
$("doLoginBtn").addEventListener("click", submitLogin);
$("ovId").addEventListener("keydown", (e) => { if (e.key === "Enter") submitLogin(); });
$("ovPw").addEventListener("keydown", (e) => { if (e.key === "Enter") submitLogin(); });
