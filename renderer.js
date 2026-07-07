// Nori-TC — 제어판 렌더러
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
let playSteps = [];
let playCursor = 0;        // 재생 중 다음에 실행할 스텝 인덱스 (네비게이션 후 이어가기)

const DEFAULT_URL = "https://tc.noricloud.org/login";

// ---- webview 초기화: 게스트 preload + 시작 URL ----
view.setAttribute("preload", window.api.webviewPreloadURL);
view.setAttribute("src", DEFAULT_URL);
$("address").value = DEFAULT_URL;

// 주소창/네비게이션
function navigate(url) {
  if (!url) return;
  if (!/^[a-z]+:\/\//i.test(url)) url = "https://" + url;
  try { view.loadURL(url); } catch (_) { view.src = url; }
}
$("goBtn").addEventListener("click", () => navigate($("address").value.trim()));
$("address").addEventListener("keydown", (e) => {
  if (e.key === "Enter") navigate($("address").value.trim());
});
$("backBtn").addEventListener("click", () => view.canGoBack() && view.goBack());
$("fwdBtn").addEventListener("click", () => view.canGoForward() && view.goForward());
$("reloadBtn").addEventListener("click", () => view.reload());

// ---- 확대/축소 (webview 페이지 대상) ----
let zoomFactor = 1;
const ZOOM_MIN = 0.3, ZOOM_MAX = 3, ZOOM_STEP = 0.1;

function applyZoom() {
  try { view.setZoomFactor(zoomFactor); } catch (_) {} // dom-ready 이전엔 무시
  $("zoomLabel").textContent = Math.round(zoomFactor * 100) + "%";
}
function setZoom(f) {
  // 부동소수 오차 방지를 위해 소수 둘째자리로 정규화 후 범위 클램프
  zoomFactor = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(f * 100) / 100));
  applyZoom();
}
const zoomIn = () => setZoom(zoomFactor + ZOOM_STEP);
const zoomOut = () => setZoom(zoomFactor - ZOOM_STEP);
const zoomReset = () => setZoom(1);

$("zoomInBtn").addEventListener("click", zoomIn);
$("zoomOutBtn").addEventListener("click", zoomOut);
$("zoomLabel").addEventListener("click", zoomReset);

// webview는 페이지가 준비된 뒤에만 zoom 설정 가능 → 로드/이동 때마다 현재 배율 재적용
view.addEventListener("dom-ready", applyZoom);

// 제어판 쪽에 포커스가 있을 때의 키보드 단축키
window.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomIn(); }
  else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomOut(); }
  else if (e.key === "0") { e.preventDefault(); zoomReset(); }
});

// 주소창을 현재 URL로 동기화
view.addEventListener("did-navigate", (e) => { $("address").value = e.url; });
view.addEventListener("did-navigate-in-page", (e) => {
  if (e.isMainFrame) $("address").value = e.url;
});

// 녹화 중 페이지가 새 URL로 이동하면 navigation 스텝 자동 기록 (확장의 tabs.onUpdated 대체)
view.addEventListener("did-navigate", (e) => {
  if (!recording) return; // 재생 중 발생하는 이동은 기록하지 않음
  const url = e.url;
  if (!url || url === lastNavUrl || url === "about:blank") return;
  lastNavUrl = url;
  const now = Date.now();
  const delayMs = lastClickTs ? Math.min(now - lastClickTs, 5000) : 0;
  lastClickTs = now;
  steps.push({ type: "navigate", url, delayMs });
  refreshCount();
});

// ---- 게스트(webview preload)로부터의 메시지 라우팅 (background.js onMessage 대체) ----
view.addEventListener("ipc-message", (e) => {
  const [a, b] = e.args;
  switch (e.channel) {
    case "page-ready": {
      // 페이지 로드 직후 게스트가 상태를 물어봄 → 현재 녹화/재생 상태로 응답
      const resume = playing;
      sendToGuest("page-state", {
        recording,
        resumePlay: resume,
        steps: resume ? playSteps : [],
        startIndex: resume ? playCursor : 0
      });
      break;
    }

    case "step": {
      if (!recording) break; // 녹화 종료 후 들어온 클릭은 무시
      const step = a;
      const now = Date.now();
      step.delayMs = lastClickTs ? Math.min(now - lastClickTs, 5000) : 0;
      lastClickTs = now;
      steps.push(step);
      refreshCount();
      break;
    }

    case "input-step": {
      if (!recording) break;
      handleInputStep(a, b /* coalesceOnly */);
      break;
    }

    case "stop-recording":
      stopRecording();
      break;

    // 페이지 위에서 Ctrl+휠 → a = deltaY (위로 굴리면 음수 = 확대)
    case "zoom":
      if (a < 0) zoomIn(); else zoomOut();
      break;

    // 페이지에 포커스가 있을 때의 Ctrl +/-/0 (게스트 preload가 전달)
    case "zoom-key":
      if (a === "in") zoomIn();
      else if (a === "out") zoomOut();
      else zoomReset();
      break;

    case "play-navigate": {
      // 재생 중 네비게이션 스텝 → 탭을 이동시키고 새 페이지에서 이어감
      playCursor = a.index + 1;
      navigate(a.url);
      break;
    }

    case "play-progress": {
      if (a.ok) playCursor = a.index + 1; // 성공한 스텝 다음을 커서로
      if (!a.ok) setStatus(`스텝 ${a.index + 1} 실패: ${a.reason}`);
      else setStatus(`재생 중… 스텝 ${a.index + 1}`);
      break;
    }

    case "play-done":
      playing = false;
      setPlaying(false);
      setStatus("재생 완료.");
      showToast("재생이 종료되었습니다.");
      break;

    case "play-abort":
      playing = false;
      setPlaying(false);
      setStatus("재생 중단됨.");
      showToast("재생이 중단되었습니다.");
      break;
  }
});

// 입력 스텝 정리(coalesce): 같은 필드 연속 편집은 마지막 값으로 갱신 (background.js 로직)
function handleInputStep(step, coalesceOnly) {
  const now = Date.now();

  if (coalesceOnly) {
    // change 이벤트: 같은 페이지 구간(navigate 이전)의 기존 같은 필드 입력 스텝 값만 갱신
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].type === "navigate") break;
      if (steps[i].type === "input" && steps[i].selector === step.selector) {
        steps[i].value = step.value;
        refreshCount();
        return;
      }
    }
    // 못 찾으면 아래 일반 경로로 새 스텝 추가
  } else {
    const last = steps[steps.length - 1];
    if (last && last.type === "input" && last.selector &&
        last.selector === step.selector) {
      last.value = step.value;
      refreshCount();
      return;
    }
  }

  step.delayMs = lastClickTs ? Math.min(now - lastClickTs, 5000) : 0;
  lastClickTs = now;
  steps.push(step);
  refreshCount();
}

function sendToGuest(channel, ...args) {
  try { view.send(channel, ...args); } catch (_) {}
}

// ---- UI: 녹화 버튼 상태 ----
function setRecordBtn(isRecording) {
  recording = isRecording;
  $("recordBtn").textContent = isRecording ? "● 녹화 종료" : "● 녹화 시작";
}

function refreshCount() {
  $("count").textContent = `스텝 ${steps.length}개`;
  renderLog(steps);
}

// ---- 로그 목록 렌더 (popup.js와 동일) ----
function renderLog(list) {
  const box = $("log");
  box.innerHTML = "";
  if (!list.length) {
    box.innerHTML = '<div class="logEmpty">기록된 로그가 없습니다.</div>';
    return;
  }
  list.forEach((s, i) => {
    const item = document.createElement("div");
    item.className = "logItem";

    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = i + 1;

    const body = document.createElement("div");
    body.className = "body";
    const lbl = document.createElement("div");
    const meta = document.createElement("div");
    meta.className = "meta";

    if (s.type === "navigate") {
      lbl.className = "lbl badge-nav";
      lbl.textContent = "↪ 이동";
      meta.textContent = s.url || "";
      lbl.title = s.url || "";
    } else if (s.type === "input") {
      lbl.className = "lbl badge-input";
      lbl.textContent = `⌨ 입력 ${s.label || s.tag || ""}`.trim();
      lbl.title = s.selector || "";
      const v = String(s.value ?? "");
      const shown = v.length > 30 ? v.slice(0, 30) + "…" : v;
      meta.textContent = `"${shown}"` + (s.selector ? ` · ${s.selector}` : "");
    } else if (s.type === "key") {
      lbl.className = "lbl badge-input";
      lbl.textContent = `⏎ ${s.key || "키"} ${s.label || ""}`.trim();
      lbl.title = s.selector || "";
      meta.textContent = (s.key === "Enter" ? "검색/제출" : "키 입력") +
        (s.selector ? ` · ${s.selector}` : "");
    } else {
      lbl.className = "lbl badge-click";
      const btn = s.button === "right" ? "우클릭" : "클릭";
      lbl.textContent = `● ${btn} ${s.label || s.tag || ""}`.trim();
      lbl.title = s.selector || "";
      meta.textContent = `(${s.x}, ${s.y})` + (s.selector ? ` · ${s.selector}` : "");
    }

    body.appendChild(lbl);
    body.appendChild(meta);

    const del = document.createElement("button");
    del.className = "del danger";
    del.textContent = "✕";
    del.title = "이 스텝 삭제";
    del.addEventListener("click", () => {
      steps.splice(i, 1);
      refreshCount();
      setStatus(`스텝 ${i + 1} 삭제됨.`);
    });

    item.appendChild(idx);
    item.appendChild(body);
    item.appendChild(del);
    box.appendChild(item);
  });
}

// ---- 시나리오 드롭다운 ----
async function refreshScenarios(selectName) {
  const names = await window.api.listScenarios();
  const sel = $("scenarioSelect");
  sel.innerHTML = "";
  names.forEach((n) => {
    const opt = document.createElement("option");
    opt.value = n; opt.textContent = n;
    sel.appendChild(opt);
  });
  if (selectName && names.includes(selectName)) {
    sel.value = selectName;
    $("scenarioName").value = selectName;
  }
}

// ---- 녹화 ----
function startRecording() {
  recording = true;
  lastClickTs = 0;
  lastNavUrl = view.getURL();
  setRecordBtn(true);
  sendToGuest("set-recording", true);
  setStatus("녹화 중… 페이지에서 클릭/입력/이동하세요. (오른쪽 위 페이지의 종료 버튼으로도 멈춤)");
}

function stopRecording() {
  recording = false;
  setRecordBtn(false);
  sendToGuest("set-recording", false);
  refreshCount();
  setStatus("녹화 종료.");
}

$("recordBtn").addEventListener("click", () => {
  if (!recording) startRecording();
  else stopRecording();
});

// ---- 재생 ----
$("playBtn").addEventListener("click", () => {
  if (!steps.length) { setStatus("재생할 스텝이 없습니다."); return; }
  const repeat = parseInt($("repeat").value, 10) || 1;

  // 반복 횟수만큼 펼쳐 하나의 평탄한 목록으로
  playSteps = [];
  for (let r = 0; r < repeat; r++) playSteps.push(...steps);
  playCursor = 0;
  playing = true;
  setPlaying(true);
  setStatus("재생 중…");
  sendToGuest("play-from", playSteps, 0);
});

$("stopBtn").addEventListener("click", () => {
  playing = false;
  setPlaying(false);
  setStatus("재생 중지 요청됨 (진행 중 스텝이 끝난 뒤 멈춤).");
});

function setPlaying(p) {
  $("playBtn").disabled = p;
  $("recordBtn").disabled = p;
  $("stopBtn").disabled = !p;
}

// ---- 비우기 ----
$("clearBtn").addEventListener("click", () => {
  steps = [];
  refreshCount();
  setStatus("스텝을 비웠습니다.");
});

// ---- 내보내기 / 가져오기 (네이티브 대화상자) ----
$("exportBtn").addEventListener("click", async () => {
  if (!steps.length) { setStatus("내보낼 로그가 없습니다."); return; }
  const suggested = $("scenarioName").value.trim() || "nori-tc-log";
  const res = await window.api.exportSteps(steps, suggested);
  if (res.canceled) { setStatus("내보내기를 취소했습니다."); return; }
  // 저장한 파일명을 시나리오로도 등록
  await window.api.saveScenario(res.name, steps);
  await refreshScenarios(res.name);
  setStatus(`내보냄: ${res.name}.json — 시나리오로도 저장됨`);
});

$("importBtn").addEventListener("click", async () => {
  const res = await window.api.importSteps();
  if (res.canceled) return;
  if (res.error) { setStatus("가져오기 실패: " + res.error); return; }
  steps = res.steps;
  refreshCount();
  if (res.name) {
    await window.api.saveScenario(res.name, steps);
    await refreshScenarios(res.name);
  }
  setStatus(`가져옴: ${res.name || "로그"} (스텝 ${steps.length}개)`);
});

// ---- 시나리오 저장/적용/삭제 ----
$("saveBtn").addEventListener("click", async () => {
  const name = $("scenarioName").value.trim() || $("scenarioSelect").value;
  if (!name) { setStatus("시나리오 이름을 입력하세요."); return; }
  await window.api.saveScenario(name, steps);
  await refreshScenarios(name);
  setStatus(`시나리오 저장됨: ${name}`);
});

$("applyBtn").addEventListener("click", async () => {
  const name = $("scenarioName").value.trim() || $("scenarioSelect").value;
  if (!name) { setStatus("적용할 시나리오를 선택하세요."); return; }
  steps = await window.api.loadScenario(name);
  refreshCount();
  setStatus(`시나리오 적용: ${name}`);
});

$("deleteBtn").addEventListener("click", async () => {
  const name = $("scenarioSelect").value;
  if (!name) { setStatus("삭제할 시나리오를 선택하세요."); return; }
  await window.api.deleteScenario(name);
  await refreshScenarios();
  setStatus(`시나리오 삭제됨: ${name}`);
});

$("scenarioSelect").addEventListener("change", (e) => {
  $("scenarioName").value = e.target.value;
});

// ---- 초기화 ----
refreshCount();
refreshScenarios();
