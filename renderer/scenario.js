// Nori-TC — 제어판 렌더러: 시나리오 & 내보내기/가져오기
// 시나리오 드롭다운 갱신, 저장/적용/삭제, JSON 내보내기/가져오기(네이티브 대화상자).

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
