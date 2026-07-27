// Nori-TC — 제어판 렌더러: 시나리오 & 내보내기/가져오기
// 시나리오 드롭다운 갱신, 저장/적용/삭제, JSON 내보내기/가져오기(네이티브 대화상자).

// ---- 시나리오 드롭다운 + 리스트 ----
async function refreshScenarios(selectName) {
  const names = await window.api.listScenarios();
  scenarioNames = names;                 // 리스트 렌더용 캐시
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
  // 사라진 시나리오의 결과는 정리
  Object.keys(scenarioResults).forEach((n) => { if (!names.includes(n)) delete scenarioResults[n]; });
  renderScenarioList();
}

// 시나리오별 실행 결과를 담은 리스트 렌더 (오른쪽 끝에 완료 여부 + 테스트 PASS/FAIL)
function renderScenarioList() {
  const box = $("scenarioList");
  if (!box) return;
  box.innerHTML = "";
  if (!scenarioNames.length) {
    box.innerHTML = '<div class="logEmpty">저장된 시나리오가 없습니다.</div>';
    return;
  }
  scenarioNames.forEach((name) => {
    const r = scenarioResults[name] || {};
    const row = document.createElement("div");
    row.className = "scRow" + (name === activeScenario ? " active" : "");

    const nm = document.createElement("span");
    nm.className = "scName";
    nm.textContent = name;
    nm.title = "클릭하면 이 시나리오를 선택(적용)";
    nm.addEventListener("click", () => selectScenario(name));

    const run = document.createElement("button");
    run.className = "scRun";
    run.textContent = "▶";
    run.title = "이 시나리오만 실행";
    run.addEventListener("click", (e) => { e.stopPropagation(); runScenario(name); });

    // 완료 여부 배지
    const doneB = document.createElement("span");
    if (r.running) { doneB.className = "scBadge b-run"; doneB.textContent = "실행중"; }
    else if (r.completed) { doneB.className = "scBadge b-done"; doneB.textContent = "완료"; }
    else if (r.ran) { doneB.className = "scBadge b-abort"; doneB.textContent = "중단"; }
    else { doneB.className = "scBadge b-none"; doneB.textContent = "—"; }

    // 테스트 PASS/FAIL 배지
    const testB = document.createElement("span");
    const t = r.test;
    testB.className = "scBadge " + (t === "PASS" ? "b-pass" : t === "FAIL" ? "b-fail" : "b-none");
    testB.textContent = t || "—";

    row.appendChild(nm);
    row.appendChild(run);
    row.appendChild(doneB);
    row.appendChild(testB);
    box.appendChild(row);
  });
}

// 리스트에서 시나리오 선택 → 현재 스텝으로 적용 + 활성 시나리오 지정
async function selectScenario(name) {
  activeScenario = name;
  $("scenarioName").value = name;
  $("scenarioSelect").value = name;
  steps = await window.api.loadScenario(name);
  refreshCount();
  renderScenarioList();
  setStatus(`시나리오 선택: ${name}`);
}

// 개별 실행: 선택 후 재생 (깨끗한 시작 상태에서)
async function runScenario(name) {
  if (playing) { setStatus("재생 중입니다. 끝난 뒤 실행하세요."); return; }
  await selectScenario(name);
  setStatus(`시작 상태로 이동 중… (${name})`);
  await freshLoad(steps[0] && steps[0].url);
  beginPlayback(1);
}

// 실행 시작 표시
function setScenarioRunning(name) {
  if (!name) return;
  scenarioResults[name] = { ran: true, running: true, completed: false, test: null };
  renderScenarioList();
}

// 실행 결과 기록 (completed=play-done 여부, testFailed=테스트 실패 여부)
function setScenarioResult(name, completed, testFailed) {
  if (!name) return;
  scenarioResults[name] = {
    ran: true,
    running: false,
    completed: !!completed,
    test: completed ? (testFailed ? "FAIL" : "PASS") : null
  };
  renderScenarioList();
}

// ---- 전체 실행 (일괄) ----
$("runAllBtn").addEventListener("click", runAll);

function runAll() {
  if (playing || batchRunning) { setStatus("이미 실행 중입니다."); return; }
  if (!scenarioNames.length) { setStatus("실행할 시나리오가 없습니다."); return; }
  batchNames = scenarioNames.slice();
  batchRunning = true;
  setStatus(`전체 실행 시작 (${batchNames.length}개)`);
  batchNext();
}

// 큐에서 다음 시나리오를 실행 (재생 종료 시 ipc-router가 호출)
async function batchNext() {
  if (!batchRunning) return;
  if (!batchNames.length) {
    batchRunning = false;
    setStatus("전체 실행 완료.");
    showToast("전체 시나리오 실행이 끝났습니다.");
    return;
  }
  const name = batchNames.shift();
  activeScenario = name;
  $("scenarioName").value = name;
  steps = await window.api.loadScenario(name);
  refreshCount();
  renderScenarioList();
  // 각 시나리오를 깨끗한 시작 상태에서: 첫 스텝 URL로 리로드해 이전 데모/앱스페이스를 정리
  setStatus(`시작 상태로 이동 중… (${name})`);
  await freshLoad(steps[0] && steps[0].url);
  if (!batchRunning) return;   // 이동 중 중지되면 중단
  beginPlayback(1);
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
  activeScenario = name;          // 재생 결과를 이 시나리오에 귀속
  renderScenarioList();
  setStatus(`시나리오 적용: ${name}`);
});

$("deleteBtn").addEventListener("click", async () => {
  const name = $("scenarioSelect").value;
  if (!name) { setStatus("삭제할 시나리오를 선택하세요."); return; }
  await window.api.deleteScenario(name);
  delete scenarioResults[name];
  if (activeScenario === name) activeScenario = null;
  await refreshScenarios();
  setStatus(`시나리오 삭제됨: ${name}`);
});

$("scenarioSelect").addEventListener("change", (e) => {
  $("scenarioName").value = e.target.value;
});
