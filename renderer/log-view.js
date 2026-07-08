// Nori-TC — 제어판 렌더러: 로그 목록 렌더 (popup.js의 UI 역할)
// 스텝 개수 표시 + 스텝 리스트 렌더링/삭제.

function refreshCount() {
  $("count").textContent = `스텝 ${steps.length}개`;
  renderLog(steps);
}

// ---- 로그 목록 렌더 (popup.js와 동일) ----
function renderLog(list) {
  const box = $("log");
  box.innerHTML = "";
  if (!list.length) {
    box.innerHTML = '<div class="logEmpty">기록된 로그가 없습니다.</div>';
    return;
  }
  list.forEach((s, i) => {
    const item = document.createElement("div");
    item.className = "logItem";

    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = i + 1;

    const body = document.createElement("div");
    body.className = "body";
    const lbl = document.createElement("div");
    const meta = document.createElement("div");
    meta.className = "meta";

    if (s.type === "navigate") {
      lbl.className = "lbl badge-nav";
      lbl.textContent = "↪ 이동";
      meta.textContent = s.url || "";
      lbl.title = s.url || "";
    } else if (s.type === "input") {
      lbl.className = "lbl badge-input";
      lbl.textContent = `⌨ 입력 ${s.label || s.tag || ""}`.trim();
      lbl.title = s.selector || "";
      const v = String(s.value ?? "");
      const shown = v.length > 30 ? v.slice(0, 30) + "…" : v;
      meta.textContent = `"${shown}"` + (s.selector ? ` · ${s.selector}` : "");
    } else if (s.type === "key") {
      lbl.className = "lbl badge-input";
      lbl.textContent = `⏎ ${s.key || "키"} ${s.label || ""}`.trim();
      lbl.title = s.selector || "";
      meta.textContent = (s.key === "Enter" ? "검색/제출" : "키 입력") +
        (s.selector ? ` · ${s.selector}` : "");
    } else {
      lbl.className = "lbl badge-click";
      const btn = s.button === "right" ? "우클릭" : "클릭";
      lbl.textContent = `● ${btn} ${s.label || s.tag || ""}`.trim();
      lbl.title = s.selector || "";
      meta.textContent = `(${s.x}, ${s.y})` + (s.selector ? ` · ${s.selector}` : "");
    }

    body.appendChild(lbl);
    body.appendChild(meta);

    const del = document.createElement("button");
    del.className = "del danger";
    del.textContent = "✕";
    del.title = "이 스텝 삭제";
    del.addEventListener("click", () => {
      steps.splice(i, 1);
      refreshCount();
      setStatus(`스텝 ${i + 1} 삭제됨.`);
    });

    item.appendChild(idx);
    item.appendChild(body);
    item.appendChild(del);
    box.appendChild(item);
  });
}
