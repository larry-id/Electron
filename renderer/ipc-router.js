// Nori-TC — 제어판 렌더러: 게스트 IPC 라우팅 (background.js onMessage 대체)
// <webview> 게스트(webview-preload.js)가 보낸 메시지를 받아 녹화/재생/줌 로직으로 분배.

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
      // 진행 중인 스텝 번호를 시나리오 리스트(제목 옆)에 반영
      if (activeScenario && scenarioResults[activeScenario]) {
        scenarioResults[activeScenario].stepCur = a.index + 1;
        renderScenarioList();
      }
      if (!a.ok) setStatus(`스텝 ${a.index + 1} 실패: ${a.reason}`);
      else setStatus(`재생 중… 스텝 ${a.index + 1}`);
      break;
    }

    case "play-done": {
      playing = false;
      setPlaying(false);
      const done = a || {};
      // 스텝 완료 여부(=완료) 와 테스트 실패 여부를 시나리오 리스트에 기록 (PASS/FAIL 구분)
      setScenarioResult(activeScenario, true, done.testFailed);
      if (done.testFailed) {
        // 스텝은 끝까지 실행됐지만 대상 페이지가 실패 알림을 띄운 경우 = 테스트 FAIL
        // (원본 페이지 문구/상세는 표시하지 않고 결과만 알린다)
        setStatus("테스트 실패.");
        showToast("⚠ 테스트 실패", 4000);
      } else {
        setStatus("시나리오 재생 완료.");
        showToast("시나리오가 정상적으로 종료되었습니다.");
      }
      if (batchRunning) batchNext();   // 전체 실행 중이면 다음 시나리오로
      break;
    }

    case "play-abort":
      playing = false;
      setPlaying(false);
      setScenarioResult(activeScenario, false, false);  // 완료 못 함 → 중단
      setStatus("재생 중단됨.");
      showToast("재생이 중단되었습니다.");
      if (batchRunning) batchNext();
      break;
  }
});
