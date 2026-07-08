// Nori-TC — 제어판 렌더러: 재생
// 녹화된 스텝을 반복 횟수만큼 펼쳐 게스트에 넘겨 실행시키고, 중지/버튼 상태를 관리.

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
