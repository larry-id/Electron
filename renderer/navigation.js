// Nori-TC — 제어판 렌더러: 주소창 · 네비게이션 · 확대/축소
// webview 이동 제어와 zoom, 주소창 동기화를 담당.

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
