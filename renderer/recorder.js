// Nori-TC — 제어판 렌더러: 녹화
// 클릭/입력/이동 스텝 수집, 입력 스텝 coalesce, 녹화 시작/종료, 스텝 비우기.

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

// ---- UI: 녹화 버튼 상태 ----
function setRecordBtn(isRecording) {
  recording = isRecording;
  $("recordBtn").textContent = isRecording ? "● 녹화 종료" : "● 녹화 시작";
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

// ---- 비우기 ----
$("clearBtn").addEventListener("click", () => {
  steps = [];
  refreshCount();
  setStatus("스텝을 비웠습니다.");
});
