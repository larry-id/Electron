// Nori-TC — 제어판 렌더러: 네비게이션 · 확대/축소(내부)
// 상단 툴바(뒤로/앞으로/새로고침/주소창/이동/줌 버튼)는 제거됨.
// navigate()는 재생(freshLoad·play-navigate)에서, zoom 로직은 녹화·재생의
// 100% 고정과 게스트 Ctrl+휠/키 줌(ipc-router)에서 계속 사용되므로 유지한다.

// 페이지 이동(내부 호출 전용: 재생 시 시작 URL 로드 등)
function navigate(url) {
  if (!url) return;
  if (!/^[a-z]+:\/\//i.test(url)) url = "https://" + url;
  try { view.loadURL(url); } catch (_) { view.src = url; }
}

// ---- 확대/축소 (webview 페이지 대상, 내부 상태) ----
let zoomFactor = 1;
const ZOOM_MIN = 0.3, ZOOM_MAX = 3, ZOOM_STEP = 0.1;

function applyZoom() {
  try { view.setZoomFactor(zoomFactor); } catch (_) {} // dom-ready 이전엔 무시
}
function setZoom(f) {
  // 부동소수 오차 방지를 위해 소수 둘째자리로 정규화 후 범위 클램프
  zoomFactor = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(f * 100) / 100));
  applyZoom();
}
const zoomIn = () => setZoom(zoomFactor + ZOOM_STEP);
const zoomOut = () => setZoom(zoomFactor - ZOOM_STEP);
const zoomReset = () => setZoom(1);

// webview는 페이지가 준비된 뒤에만 zoom 설정 가능 → 로드/이동 때마다 현재 배율 재적용
view.addEventListener("dom-ready", applyZoom);
