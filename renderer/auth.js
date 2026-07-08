// Nori-TC — 제어판 렌더러: 자동 로그인 & 인증 플로우
// 메인 창이 유일한 인증 지점. 로그인 창에서 저장한 자격증명으로 이 창의 webview가 직접 로그인한다.
// 성공(사이트 앱 페이지 도달) → 오버레이 제거 + 우측에 접속 아이디 표시.
// 실패(자격증명 없음/오류) → 로그인 창으로 되돌림. (인증 webview가 하나뿐이라 튕김 없음)
const SITE_RE = /^https?:\/\/tc\.noricloud\.org/i;
function isLoginUrl(url) { return typeof url === "string" && /tc\.noricloud\.org\/login/i.test(url); }
function isSiteUrl(url) { return typeof url === "string" && SITE_RE.test(url); }
// 사이트 앱 페이지(= 로그인됨): 사이트이면서 /login 도 아니고 루트('/')도 아님(루트는 리다이렉트 경유지)
function isAppUrl(url) {
  return isSiteUrl(url) && !isLoginUrl(url) &&
    !/^https?:\/\/tc\.noricloud\.org\/?($|[?#])/i.test(url);
}

const authOverlay = $("authOverlay");
let authed = false;        // 인증 완료(앱 노출)
let silentTried = false;   // 자동 로그인 시도 여부
let submitting = false;    // 로그인 제출 결과 대기 중
let loginFailing = false;  // 실패 처리 진행 중(중복 방지)
let settleTimer = null;
let loginWatchTimer = null;

function showAuthBusy(msg) {
  authOverlay.classList.remove("hidden");
  authOverlay.querySelector(".authMsg").textContent = msg || "접속 중…";
}
function hideAuthOverlay() { authOverlay.classList.add("hidden"); }

async function showWhoAmI() {
  try {
    const c = await window.api.loadCreds();
    const id = c && c.id ? String(c.id) : "";
    $("whoami").innerHTML = id
      ? "접속: <b>" + id.replace(/[<>&]/g, "") + "</b>"
      : "";
  } catch (_) {}
}

// 제출 후 일정 시간 지나도 여전히 /login 이면 실패 → 로그인 창으로
function startLoginWatch() {
  clearTimeout(loginWatchTimer);
  loginWatchTimer = setTimeout(() => {
    // 제출 후 이 시간 안에 앱 페이지로 이동하지 못하면(여전히 미인증) 실패로 간주한다.
    if (!authed && !loginFailing) {
      loginFailing = true;
      window.api.loginFailed("아이디 또는 비밀번호가 올바르지 않습니다.");
    }
  }, 12000);
}

// 로그인 페이지 도달 → 저장된 자격증명으로 자동 로그인 1회 시도
async function trySilentLogin() {
  const creds = await window.api.loadCreds();
  if (creds && (creds.id || creds.pw) && !silentTried) {
    silentTried = true;
    submitting = true;
    showAuthBusy("자동 로그인 중…");
    startLoginWatch();
    sendToGuest("autologin", { id: creds.id, pw: creds.pw, submit: true });
  } else if (!silentTried) {
    // 저장된 자격증명이 없음 → 로그인 창으로
    window.api.loginFailed("");
  }
}

// 앱 페이지 도달 = 로그인 성공
async function onAuthenticated() {
  if (authed) return;
  authed = true;
  submitting = false;
  clearTimeout(loginWatchTimer);
  await showWhoAmI();
  hideAuthOverlay();
  setStatus("로그인됨.");
}

function onViewSettled(url) {
  if (isLoginUrl(url)) {
    if (submitting) return;   // 제출 결과 대기 중
    trySilentLogin();
  } else if (isAppUrl(url)) {
    onAuthenticated();
  }
}
function scheduleSettle() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => onViewSettled(view.getURL()), 400);
}
view.addEventListener("did-stop-loading", scheduleSettle);
view.addEventListener("did-navigate", scheduleSettle);
view.addEventListener("did-navigate-in-page", scheduleSettle);

// 게스트 결과: 자동 로그인 실패를 즉시 처리(잘못된 자격증명/폼 미발견)
view.addEventListener("ipc-message", (e) => {
  if (e.channel !== "autologin-result") return;
  const a = e.args[0];
  if (!a || a.ok || authed || loginFailing) return;
  loginFailing = true;
  clearTimeout(loginWatchTimer);
  const msg = a.code === "no-form"
    ? "로그인 폼을 찾지 못했습니다: " + (a.reason || "")
    : "아이디 또는 비밀번호가 올바르지 않습니다.";
  window.api.loginFailed(msg);
});

// 로그아웃: 자격증명 + 세션 삭제 후 로그인 창으로 (다른 아이디로 접속하는 길목)
$("logoutBtn").addEventListener("click", () => { window.api.relogin(); });
