// Nori-TC — 제어판 렌더러: 재생
// 녹화된 스텝을 반복 횟수만큼 펼쳐 게스트에 넘겨 실행시키고, 중지/버튼 상태를 관리.

// 시나리오를 "깨끗한 시작 상태"에서 재생하기 위해, 첫 스텝의 URL로 새로 로드(리로드)한다.
// 이전 시나리오가 열어둔 앱스페이스/데모 상태를 정리해, 다음 시나리오의 "데모 시작"이
// 배경에 가려지지 않고 제대로 재시작되도록 한다. dom-ready(또는 타임아웃) 후 resolve.
function freshLoad(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(); return; }
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      view.removeEventListener("dom-ready", onReady);
      setTimeout(resolve, 700); // 로드 후 렌더/스크립트 초기화 여유
    };
    const onReady = () => finish();
    view.addEventListener("dom-ready", onReady);
    navigate(url);                       // 같은 URL이어도 loadURL은 재로드된다
    setTimeout(() => { if (!done) finish(); }, 9000); // 안전장치
  });
}

// ---- 재생 ----
// 현재 steps 를 반복 횟수만큼 펼쳐 재생한다. 개별/전체 실행 모두 이 함수를 재사용.
function beginPlayback(repeat) {
  if (!steps.length) { setStatus("재생할 스텝이 없습니다."); return false; }
  repeat = repeat || parseInt($("repeat").value, 10) || 1;

  // 반복 횟수만큼 펼쳐 하나의 평탄한 목록으로
  playSteps = [];
  for (let r = 0; r < repeat; r++) playSteps.push(...steps);
  playCursor = 0;
  playing = true;
  setPlaying(true);
  if (activeScenario) setScenarioRunning(activeScenario); // 리스트에 "실행 중" 표시

  // 재생은 녹화 당시의 레이아웃과 같은 줌에서 해야 셀렉터·좌표가 맞는다. 줌이 다르면
  // CSS 뷰포트 폭이 달라져 반응형 '최소화 보기'로 바뀌고, 그러면 엉뚱한 요소를 클릭한다.
  // 줌이 기록돼 있으면 그 값으로, 없으면(구버전 녹화) 기본 레이아웃(100%)으로 되돌린다.
  // (녹화도 100%로 고정되므로 재생 기준은 항상 100%.) 재배치 시간을 준 뒤 재생 시작.
  const stamped = playSteps.find((s) => typeof s.zoom === "number");
  const targetZoom = stamped ? stamped.zoom : 1;
  const needReflow = Math.abs((zoomFactor || 1) - targetZoom) > 0.001;
  if (needReflow) { setZoom(targetZoom); setStatus(`재생 준비… (줌 ${Math.round(targetZoom * 100)}%)`); }
  else setStatus("재생 중…");

  setTimeout(() => {
    if (!playing) return;            // 그새 중지되면 보내지 않음
    setStatus("재생 중…");
    sendToGuest("play-from", playSteps, 0);
  }, needReflow ? 450 : 0);
  return true;
}

$("playBtn").addEventListener("click", () => beginPlayback());

$("stopBtn").addEventListener("click", () => {
  batchRunning = false;   // 전체 실행 중이었다면 취소
  batchNames = [];
  playing = false;
  setPlaying(false);
  setStatus("재생 중지 요청됨 (진행 중 스텝이 끝난 뒤 멈춤).");
});

function setPlaying(p) {
  $("playBtn").disabled = p;
  $("recordBtn").disabled = p;
  $("stopBtn").disabled = !p;
}
