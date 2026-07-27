// Nori-TC — 제어판 렌더러: 공용 코어
// (DOM 헬퍼 · 공유 상태 · webview 초기화 · 게스트 전송 헬퍼)
//
// renderer/*.js 는 index.html 에서 클래식 <script> 로 "순서대로" 로드된다.
// 클래식 스크립트의 최상위 let/const/function 은 문서 전역 스코프를 공유하므로,
// 파일만 나눠도 하나의 스크립트였을 때와 동일하게 동작한다.
// (단, 각 최상위 선언은 전체 파일을 통틀어 정확히 1회만 존재해야 한다.)
//
// 확장의 background.js(상태 단일 소스 + 페이지 이동 연속성)와 popup.js(UI)를 합친 역할.
// renderer는 <webview> 네비게이션에도 살아남으므로 background.js의 단일 소스 역할을 맡을 수 있다.

const $ = (id) => document.getElementById(id);
const setStatus = (t) => ($("status").textContent = t);

// 떴다가 스르륵 사라지는 토스트 알림
function showToast(msg, ms = 2500) {
  const wrap = $("toast-wrap");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  wrap.appendChild(el);
  // 다음 프레임에 .show를 붙여 페이드인 트랜지션이 일어나게 한다
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");          // 페이드아웃
    setTimeout(() => el.remove(), 300);   // 트랜지션 후 제거
  }, ms);
}

const view = $("view");

// ---- 녹화/재생 상태 (background.js 미러) ----
let steps = [];            // 현재 녹화/재생 중인 스텝 목록
let recording = false;
let lastNavUrl = null;     // 녹화 중 마지막으로 기록한 이동 URL
let lastClickTs = 0;       // delay 계산용

let playing = false;
let paused = false;        // 재생 일시정지 여부 (게스트 재생 루프가 대기)
let playSteps = [];
let playCursor = 0;        // 재생 중 다음에 실행할 스텝 인덱스 (네비게이션 후 이어가기)

// ---- 시나리오 리스트/결과 상태 ----
let scenarioNames = [];    // 저장된 시나리오 이름 목록 (리스트 렌더용 캐시)
let scenarioResults = {};  // 이름 → { ran, running, completed, test:'PASS'|'FAIL'|null } 실행 결과
let activeScenario = null; // 현재 재생 결과를 귀속시킬 시나리오 이름 (없으면 null)
let batchRunning = false;  // 전체 실행(일괄) 진행 중 여부
let batchNames = [];       // 전체 실행에서 남은 시나리오 큐

// 루트로 진입 → 세션이 살아있으면 대시보드로, 아니면 /login 으로 사이트가 리다이렉트한다.
const DEFAULT_URL = "https://tc.noricloud.org/";

// ---- webview 초기화: 게스트 preload + 시작 URL ----
view.setAttribute("preload", window.api.webviewPreloadURL);
view.setAttribute("src", DEFAULT_URL);

function sendToGuest(channel, ...args) {
  try { view.send(channel, ...args); } catch (_) {}
}
