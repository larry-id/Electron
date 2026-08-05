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

// 필터 버튼(전체/PASS/FAIL) 라벨에 개수 표시 + 선택 상태 표시
function updateFilterCounts() {
  const pass = scenarioNames.filter((n) => (scenarioResults[n] || {}).test === "PASS").length;
  const fail = scenarioNames.filter((n) => (scenarioResults[n] || {}).test === "FAIL").length;
  if ($("fltAll"))  $("fltAll").textContent  = `전체 ${scenarioNames.length}`;
  if ($("fltPass")) $("fltPass").textContent = `PASS ${pass}`;
  if ($("fltFail")) $("fltFail").textContent = `FAIL ${fail}`;
  const map = { all: "fltAll", PASS: "fltPass", FAIL: "fltFail" };
  ["fltAll", "fltPass", "fltFail"].forEach((id) => $(id) && $(id).classList.remove("active"));
  if ($(map[scenarioFilter])) $(map[scenarioFilter]).classList.add("active");
}

// 시나리오별 실행 결과를 담은 리스트 렌더 (오른쪽 끝에 완료 여부 + 테스트 PASS/FAIL)
// 현재 필터(전체/PASS/FAIL)에 해당하는 시나리오만 표시한다.
function renderScenarioList() {
  const box = $("scenarioList");
  if (!box) return;
  updateFilterCounts();
  box.innerHTML = "";
  if (!scenarioNames.length) {
    box.innerHTML = '<div class="logEmpty">저장된 시나리오가 없습니다.</div>';
    return;
  }
  const names = scenarioNames.filter((name) => {
    if (scenarioFilter === "all") return true;
    if (playing && name === activeScenario) return true; // 실행 중인 시나리오는 항상 표시
    return (scenarioResults[name] || {}).test === scenarioFilter;
  });
  if (!names.length) {
    const label = scenarioFilter === "PASS" ? "PASS" : "FAIL";
    box.innerHTML = `<div class="logEmpty">${label} 시나리오가 없습니다.</div>`;
    return;
  }
  names.forEach((name) => {
    const r = scenarioResults[name] || {};
    const isActiveRunning = playing && name === activeScenario;
    const row = document.createElement("div");
    row.className = "scRow" + (name === activeScenario ? " active" : "");

    const nm = document.createElement("span");
    nm.className = "scName";
    nm.title = "클릭하면 이 시나리오를 선택(적용)";
    nm.addEventListener("click", () => selectScenario(name));
    const nmTitle = document.createElement("span");
    nmTitle.textContent = name;
    nm.appendChild(nmTitle);
    // 현재 진행 중인 스텝 번호를 제목 옆에 표시 (이 시나리오가 재생 중일 때)
    if (isActiveRunning && r.stepCur) {
      const st = document.createElement("span");
      st.className = "scStep";
      st.textContent = `스텝 ${r.stepCur}${r.stepTotal ? "/" + r.stepTotal : ""}`;
      nm.appendChild(st);
    }

    // 실행 버튼: 이 시나리오가 재생 중이면 일시정지(⏸)/이어서 재생(▶) 토글로 바뀐다.
    const run = document.createElement("button");
    run.className = "scRun";
    if (isActiveRunning && !paused) {
      run.textContent = "⏸";
      run.title = "일시정지";
      run.addEventListener("click", (e) => { e.stopPropagation(); pausePlayback(); });
    } else if (isActiveRunning && paused) {
      run.textContent = "▶";
      run.title = "이어서 재생";
      run.addEventListener("click", (e) => { e.stopPropagation(); resumePlayback(); });
    } else {
      run.textContent = "▶";
      run.title = "이 시나리오만 실행";
      run.disabled = playing;   // 다른 시나리오 재생 중이면 시작 불가
      run.addEventListener("click", (e) => { e.stopPropagation(); runScenario(name); });
    }

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

// 실행 시작 표시 (진행 스텝 표시용 stepCur/stepTotal 초기화)
function setScenarioRunning(name) {
  if (!name) return;
  scenarioResults[name] = {
    ran: true, running: true, completed: false, test: null,
    stepCur: 0, stepTotal: playSteps.length
  };
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

// ---- 보기 필터 (전체 / PASS / FAIL) ----
function setScenarioFilter(f) {
  scenarioFilter = f;
  renderScenarioList();   // updateFilterCounts 가 선택 버튼 강조 처리
}
$("fltAll").addEventListener("click", () => setScenarioFilter("all"));
$("fltPass").addEventListener("click", () => setScenarioFilter("PASS"));
$("fltFail").addEventListener("click", () => setScenarioFilter("FAIL"));

// ---- 전체 실행 (일괄) ----
$("runAllBtn").addEventListener("click", runAll);
$("restartAllBtn").addEventListener("click", restartAll);

// 처음부터 배치 시작(결과 초기화 후 첫 시나리오부터). 세대(gen)를 올려 이전 배치를 무효화.
function startBatch() {
  const gen = ++batchGen;
  batchAdvancing = false;
  paused = false; sendToGuest("set-paused", false);
  playing = false;
  batchNames = scenarioNames.slice();
  batchRunning = true;
  scenarioNames.forEach((n) => delete scenarioResults[n]); // 처음부터: 이전 PASS/FAIL 결과 초기화
  setStatus(`전체 실행 시작 (${batchNames.length}개)`);
  renderScenarioList();
  batchNext(gen);
}

function runAll() {
  if (playing || batchRunning) { setStatus("이미 실행 중입니다. (처음부터 다시 하려면 ↻ 처음부터)"); return; }
  if (!scenarioNames.length) { setStatus("실행할 시나리오가 없습니다."); return; }
  startBatch();
}

// 처음부터 재시작: 진행 중이어도 취소하고 첫 시나리오부터 다시 실행.
// (batchGen 증가로 진행 중 배치의 연속 호출이 무효화되고, freshLoad 리로드가 기존 게스트 재생 루프를 종료시킨다.)
function restartAll() {
  if (!scenarioNames.length) { setStatus("실행할 시나리오가 없습니다."); return; }
  setStatus("처음부터 재시작합니다…");
  startBatch();
}

// 큐에서 다음 시나리오를 실행 (배치 시작 시 1회 + 각 재생 종료 시 ipc-router가 호출).
// gen 이 현재 세대와 다르면(=재시작됨) 아무 것도 하지 않는다.
async function batchNext(gen) {
  if (gen !== batchGen) return;      // 무효화된(재시작된) 배치의 잔여 호출
  if (!batchRunning) return;
  if (batchAdvancing) return;        // 다음 시나리오 진입 중복 방지(잔여 play-done 대비)
  batchAdvancing = true;
  try {
    if (!batchNames.length) {
      batchRunning = false;
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
    if (gen !== batchGen || !batchRunning) return;  // 이동 중 재시작·중지되면 중단
    beginPlayback(1);
  } finally {
    batchAdvancing = false;
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
