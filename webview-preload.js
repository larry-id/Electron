// Nori-TC — <webview> 게스트 preload (Chrome 확장의 content.js 포팅)
//  - 클릭 좌표 + 셀렉터 캡처
//  - 텍스트 입력/선택값/Enter 녹화
//  - 페이지 이동(navigation)을 가로지른 재생 연속성
//  - 셀렉터 우선 재생, 좌표 폴백, 시각 효과
// 통신: chrome.runtime.sendMessage → ipcRenderer.sendToHost (호스트=제어판 렌더러)
//       chrome.runtime.onMessage  → ipcRenderer.on (호스트가 webview.send 로 보냄)
// webview preload는 네비게이션마다 다시 실행되므로 content script와 동일한 수명을 가진다.

const { ipcRenderer } = require("electron");

if (window.__bcLoaded) {
  // 재주입 방지 (보통 preload는 페이지마다 1회지만 방어적으로)
} else {
  window.__bcLoaded = true;

  // ---- 안정적인 CSS 셀렉터 생성 (확장 버전과 동일 로직) ----
  function buildSelector(el) {
    if (!(el instanceof Element)) return null;
    const testId = el.getAttribute("data-testid");
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
    if (el.id) return `#${CSS.escape(el.id)}`;

    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      let part = node.nodeName.toLowerCase();
      if (node.classList.length > 0) {
        const cls = Array.from(node.classList)
          .filter((c) => !/\d/.test(c))
          .slice(0, 2)
          .map((c) => `.${CSS.escape(c)}`)
          .join("");
        part += cls;
      }
      const parent = node.parentNode;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.nodeName === node.nodeName
        );
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      node = node.parentNode;
    }
    return parts.join(" > ");
  }

  // 녹화 여부는 호스트(렌더러)가 단일 소스로 관리한다. 여기선 표시/캡처용 로컬 미러.
  let recording = false;
  // 페이지가 언로드(이동) 중이면 재생 루프를 멈추기 위한 플래그
  let pageHiding = false;
  window.addEventListener("pagehide", () => { pageHiding = true; }, true);
  window.addEventListener("beforeunload", () => { pageHiding = true; }, true);

  // ---- 페이지에 떠 있는 "녹화 종료" 버튼 오버레이 ----
  const STOP_BTN_ID = "__bc_stop_btn";

  function showStopButton() {
    if (document.getElementById(STOP_BTN_ID)) return;
    const btn = document.createElement("button");
    btn.id = STOP_BTN_ID;
    btn.textContent = "● 녹화 종료";
    Object.assign(btn.style, {
      position: "fixed", right: "16px", bottom: "16px",
      zIndex: 2147483647, padding: "10px 16px", fontSize: "14px",
      fontFamily: "system-ui, sans-serif", fontWeight: "600",
      color: "#fff", background: "#A32D2D", border: "none",
      borderRadius: "8px", cursor: "pointer",
      boxShadow: "0 2px 10px rgba(0,0,0,.3)"
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      recording = false;
      hideStopButton();
      ipcRenderer.sendToHost("stop-recording");
    }, true);
    document.body.appendChild(btn);
  }

  function hideStopButton() {
    const btn = document.getElementById(STOP_BTN_ID);
    if (btn) btn.remove();
  }

  function setRecording(value) {
    recording = value;
    if (value) showStopButton();
    else hideStopButton();
  }

  // ---- 입력(타이핑) 녹화 지원 ----
  function editableInfo(el) {
    if (!(el instanceof Element)) return null;
    const tag = el.nodeName.toLowerCase();
    if (tag === "input") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (["checkbox", "radio", "button", "submit", "reset", "file", "image", "range", "color"].includes(t)) {
        return null; // 클릭 스텝으로 처리
      }
      return { kind: "value" };
    }
    if (tag === "textarea") return { kind: "value" };
    if (tag === "select") return { kind: "select" };
    if (el.isContentEditable) return { kind: "contenteditable" };
    return null;
  }

  function describeInput(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim().slice(0, 40);
    const ph = el.getAttribute("placeholder");
    if (ph) return ph.trim().slice(0, 40);
    if (el.name) return el.name;
    if (el.id) return el.id;
    return el.nodeName.toLowerCase();
  }

  function onInput(e) {
    if (!recording) return;
    const el = e.target;
    const info = editableInfo(el);
    if (!info) return;
    if (el.closest && el.closest("#" + STOP_BTN_ID)) return;

    const r = el.getBoundingClientRect();
    const step = {
      type: "input",
      inputKind: info.kind,
      value: info.kind === "contenteditable" ? (el.innerText || "") : (el.value || ""),
      selector: buildSelector(el),
      label: describeInput(el),
      tag: el.nodeName.toLowerCase(),
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      url: location.href,
      ts: Date.now()
    };
    // change(커밋) 이벤트는 input과 값이 중복되므로 새 스텝을 만들지 않고 기존 값만 갱신
    ipcRenderer.sendToHost("input-step", step, e.type === "change");
    flash(step.x, step.y, "#2E6FB5");
  }

  function onKeyDown(e) {
    if (!recording) return;
    if (e.key !== "Enter") return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    if (el.closest && el.closest("#" + STOP_BTN_ID)) return;
    const tag = el.nodeName.toLowerCase();
    if (tag !== "input") return; // 단일행 input의 Enter만 제출로 간주

    const r = el.getBoundingClientRect();
    const step = {
      type: "key",
      key: "Enter",
      selector: buildSelector(el),
      label: describeInput(el),
      tag: "input",
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      url: location.href,
      ts: Date.now()
    };
    ipcRenderer.sendToHost("step", step);
    flash(step.x, step.y, "#2E6FB5");
  }

  function describeElement(el) {
    if (!(el instanceof Element)) return "";
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim().slice(0, 40);
    const title = el.getAttribute("title");
    if (title) return title.trim().slice(0, 40);
    const alt = el.getAttribute("alt");
    if (alt) return alt.trim().slice(0, 40);
    const text = (el.innerText || el.textContent || "").trim();
    if (text) return text.replace(/\s+/g, " ").slice(0, 40);
    const tag = el.nodeName.toLowerCase();
    return el.id ? `${tag}#${el.id}` : tag;
  }

  // mousedown 단계에서 기록: 링크/버튼 클릭으로 페이지가 곧바로 언로드돼도 스텝 누락 방지
  function onClick(e) {
    if (!recording) return;
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    if (e.target && e.target.closest && e.target.closest("#" + STOP_BTN_ID)) return;
    const step = {
      type: "click",
      x: Math.round(e.clientX),
      y: Math.round(e.clientY),
      pageX: Math.round(e.pageX),
      pageY: Math.round(e.pageY),
      selector: buildSelector(e.target),
      label: describeElement(e.target),
      tag: e.target instanceof Element ? e.target.nodeName.toLowerCase() : "",
      url: location.href,
      ts: Date.now(),
      button: e.button === 2 ? "right" : e.button === 1 ? "middle" : "left"
    };
    ipcRenderer.sendToHost("step", step);
    flash(e.clientX, e.clientY, "#1D9E75");
  }

  // 스크롤 속도(픽셀당 ms). 값이 클수록 더 천천히.
  const SCROLL_MS_PER_PX = 2.2;
  const SCROLL_MIN_MS = 900;
  const SCROLL_MAX_MS = 4000;

  async function slowScrollIntoView(target) {
    if (!(target instanceof Element)) return;
    const r = target.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (r.top >= 0 && r.bottom <= vh) return;

    const startY = window.scrollY;
    const elementCenter = startY + r.top + r.height / 2;
    const maxY = Math.max(0, (document.documentElement.scrollHeight || 0) - vh);
    const destY = Math.max(0, Math.min(elementCenter - vh / 2, maxY));
    const distance = destY - startY;
    if (Math.abs(distance) < 2) return;

    const duration = Math.min(
      SCROLL_MAX_MS,
      Math.max(SCROLL_MIN_MS, Math.abs(distance) * SCROLL_MS_PER_PX)
    );
    const frame = 16;
    const totalSteps = Math.max(1, Math.round(duration / frame));
    for (let i = 1; i <= totalSteps; i++) {
      if (pageHiding) return;
      const t = i / totalSteps;
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      window.scrollTo(0, startY + distance * eased);
      await sleep(frame);
    }
  }

  // ---- 재생: 셀렉터 우선, 없으면 좌표 ----
  async function clickStep(step) {
    let target = null;
    let bySelector = false;

    if (step.selector) {
      target = document.querySelector(step.selector);
      if (target) bySelector = true;
    }
    if (!target) target = document.elementFromPoint(step.x, step.y);
    if (!target) return { ok: false, reason: "요소를 찾지 못함" };

    await slowScrollIntoView(target);

    const r = target.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    flash(cx, cy, bySelector ? "#BA7517" : "#D85A30");

    const btn = step.button === "right" ? 2 : 0;
    const mouseOpts = {
      bubbles: true, cancelable: true, view: window,
      clientX: cx, clientY: cy, button: btn
    };
    target.dispatchEvent(new MouseEvent("mousedown", mouseOpts));
    target.dispatchEvent(new MouseEvent("mouseup", mouseOpts));

    if (step.button === "right") {
      target.dispatchEvent(new MouseEvent("contextmenu", mouseOpts));
    } else {
      if (typeof target.click === "function") target.click();
      else target.dispatchEvent(new MouseEvent("click", mouseOpts));
    }
    return { ok: true };
  }

  function setNativeValue(el, value) {
    try {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc && desc.set) {
        desc.set.call(el, value);
        return;
      }
    } catch (_) {}
    el.value = value;
  }

  // ---- 재생: 녹화된 텍스트/선택값을 한 글자씩 입력 ----
  async function typeStep(step) {
    let target = null;
    if (step.selector) target = document.querySelector(step.selector);
    if (!target && step.x != null) target = document.elementFromPoint(step.x, step.y);
    if (!target) return { ok: false, reason: "입력 요소를 찾지 못함" };

    await slowScrollIntoView(target);

    const r = target.getBoundingClientRect();
    flash(r.left + r.width / 2, r.top + r.height / 2, "#2E6FB5");

    try { target.focus(); } catch (_) {}

    const value = String(step.value || "");

    if (step.inputKind === "select") {
      setNativeValue(target, value);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    }

    const isCE = step.inputKind === "contenteditable";

    if (isCE) target.innerText = "";
    else setNativeValue(target, "");
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));

    const charDelay = Math.max(step.charDelayMs || 60, 10);
    let typed = "";
    for (const ch of value) {
      if (pageHiding) return { ok: true };
      typed += ch;
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: ch }));
      if (isCE) target.innerText = typed;
      else setNativeValue(target, typed);
      target.dispatchEvent(new InputEvent("input", {
        bubbles: true, data: ch, inputType: "insertText"
      }));
      target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: ch }));
      await sleep(charDelay);
    }

    target.dispatchEvent(new Event("change", { bubbles: true }));
    // blur()는 검색창 자동완성/입력값을 리셋시킬 수 있어 호출하지 않는다.
    return { ok: true };
  }

  // ---- 재생: 키 입력(Enter 제출) 재현 ----
  function makeKeyEvent(type, key) {
    return new KeyboardEvent(type, {
      bubbles: true, cancelable: true, view: window,
      key, code: key === "Enter" ? "Enter" : key,
      keyCode: 13, which: 13
    });
  }

  async function keyStep(step) {
    let target = step.selector ? document.querySelector(step.selector) : null;
    if (!target && step.x != null) target = document.elementFromPoint(step.x, step.y);
    if (!target) return { ok: false, reason: "키 입력 대상을 찾지 못함" };

    await slowScrollIntoView(target);
    const r = target.getBoundingClientRect();
    flash(r.left + r.width / 2, r.top + r.height / 2, "#2E6FB5");
    try { target.focus(); } catch (_) {}

    if (step.key === "Enter") {
      const notPrevented = target.dispatchEvent(makeKeyEvent("keydown", "Enter"));
      target.dispatchEvent(makeKeyEvent("keypress", "Enter"));
      target.dispatchEvent(makeKeyEvent("keyup", "Enter"));

      if (notPrevented) {
        const form = target.form || (target.closest && target.closest("form"));
        if (form) {
          if (typeof form.requestSubmit === "function") {
            form.requestSubmit();
          } else {
            const ev = new Event("submit", { bubbles: true, cancelable: true });
            if (form.dispatchEvent(ev)) form.submit();
          }
        }
      }
    }
    return { ok: true };
  }

  function waitForSelector(selector, timeout) {
    return new Promise((resolve) => {
      if (!selector) return resolve(false);
      if (document.querySelector(selector)) return resolve(true);
      const start = Date.now();
      const timer = setInterval(() => {
        if (document.querySelector(selector)) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - start > timeout) {
          clearInterval(timer);
          resolve(false);
        }
      }, 100);
    });
  }

  // 이 페이지에 해당하는 스텝들을 순서대로 재생.
  // 페이지 이동이 필요한 스텝을 만나면 호스트에 넘기고 종료(다음 페이지에서 이어감).
  async function playFrom(steps, startIndex, resumed) {
    for (let i = startIndex; i < steps.length; i++) {
      if (pageHiding) return;
      const step = steps[i];
      await sleep(Math.max(step.delayMs || 300, 150));
      if (pageHiding) return;

      if (step.type === "navigate") {
        const alreadyHere = (resumed && i === startIndex) || location.href === step.url;
        if (alreadyHere) {
          ipcRenderer.sendToHost("play-progress", { index: i, ok: true });
          continue;
        }
        ipcRenderer.sendToHost("play-navigate", { index: i, url: step.url });
        return; // 페이지가 바뀌면 새 preload가 이어받음
      }

      if (step.selector) await waitForSelector(step.selector, 4000);
      const res = step.type === "input" ? await typeStep(step)
        : step.type === "key" ? await keyStep(step)
        : await clickStep(step);
      ipcRenderer.sendToHost("play-progress", {
        index: i, ok: res.ok, reason: res.reason || null
      });
      if (!res.ok) {
        ipcRenderer.sendToHost("play-abort");
        return;
      }
    }
    ipcRenderer.sendToHost("play-done");
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function flash(x, y, color) {
    const dot = document.createElement("div");
    Object.assign(dot.style, {
      position: "fixed", left: x - 10 + "px", top: y - 10 + "px",
      width: "20px", height: "20px", border: `2px solid ${color}`,
      borderRadius: "50%", background: color + "33",
      pointerEvents: "none", zIndex: 2147483647, transition: "opacity .5s"
    });
    document.body.appendChild(dot);
    setTimeout(() => (dot.style.opacity = "0"), 50);
    setTimeout(() => dot.remove(), 600);
  }

  // ---- 호스트(렌더러)로부터 명령 수신 ----
  ipcRenderer.on("set-recording", (_e, value) => setRecording(!!value));

  ipcRenderer.on("play-from", (_e, steps, startIndex) => {
    playFrom(steps || [], startIndex || 0, false); // 최초 재생 시작
  });

  // 페이지 로드 직후 호스트가 보내는 상태 응답
  ipcRenderer.on("page-state", (_e, state) => {
    if (!state) return;
    setRecording(!!state.recording);
    if (state.resumePlay) {
      playFrom(state.steps || [], state.startIndex || 0, true);
    }
  });

  // ---- 확대/축소: 페이지 쪽 입력을 호스트로 전달 (녹화 여부와 무관하게 항상) ----
  // Ctrl+휠 → 호스트가 webview.setZoomFactor 로 처리. 페이지 기본 핀치줌은 막는다.
  window.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    ipcRenderer.sendToHost("zoom", e.deltaY);
  }, { passive: false, capture: true });

  // 페이지에 포커스가 있을 때의 Ctrl +/-/0 (제어판 window 핸들러엔 도달하지 않으므로 전달)
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === "+" || e.key === "=") { e.preventDefault(); ipcRenderer.sendToHost("zoom-key", "in"); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); ipcRenderer.sendToHost("zoom-key", "out"); }
    else if (e.key === "0") { e.preventDefault(); ipcRenderer.sendToHost("zoom-key", "reset"); }
  }, true);

  // 캡처 리스너 등록
  document.addEventListener("mousedown", onClick, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onInput, true);
  document.addEventListener("keydown", onKeyDown, true);

  // 페이지 로드 직후, 진행 중인 녹화/재생 상태를 호스트에 물어 이어간다.
  ipcRenderer.sendToHost("page-ready", { url: location.href });
}
