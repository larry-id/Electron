# Nori-TC — Electron 버전

크롬 확장 `browser-clicker-ext`를 Electron 데스크톱 앱으로 재개발한 것입니다.
클릭·텍스트 입력·페이지 이동을 녹화하고 그대로 재생하는 자동화 도구로, 기능은
확장 버전과 동일하되 **자체 내장 브라우저(`<webview>`)** 안에서 동작합니다.

## 확장 → Electron 매핑

| 크롬 확장 | Electron |
|------|------|
| `background.js` (상태 단일 소스, 페이지이동 연속성) | `renderer.js` — 제어판 렌더러가 webview 네비게이션을 가로질러 유지되므로 상태 관리를 담당 |
| `content.js` (페이지 주입 스크립트) | `webview-preload.js` — `<webview>` 게스트 preload (네비게이션마다 재실행) |
| `popup.html` / `popup.js` (제어판 UI) | `index.html` + `renderer.js` (제어판 + 주소창) |
| `chrome.storage.local` (시나리오 저장) | `main.js` — `userData/scenarios.json` 파일 |
| `chrome.downloads` / 파일 입출력 | `main.js` — `dialog` + `fs` (네이티브 저장/열기) |
| `chrome.tabs` (대상 탭) | 내장 `<webview>` |

상태 흐름의 핵심: Electron에서는 제어판 렌더러가 webview 페이지 이동에도 살아남기
때문에, 확장에서 service worker(`background.js`)가 맡던 "녹화/재생 단일 소스" 역할을
`renderer.js`가 그대로 대신합니다. webview 게스트(`webview-preload.js`)만 페이지마다
다시 로드됩니다 — 이는 확장의 content script와 같은 수명입니다.

## 통신 채널

- 게스트 → 호스트 (`ipcRenderer.sendToHost`): `page-ready`, `step`, `input-step`,
  `play-navigate`, `play-progress`, `play-done`, `play-abort`, `stop-recording`
- 호스트 → 게스트 (`webview.send`): `set-recording`, `play-from`, `page-state`

## 구성

| 파일 | 역할 |
|------|------|
| `main.js` | 메인 프로세스: 창 생성, 시나리오 영속화, 내보내기/가져오기 대화상자 |
| `preload.js` | 제어판 렌더러용 preload (`window.api` 노출, contextIsolation) |
| `webview-preload.js` | webview 게스트 preload — 클릭/입력/이동 캡처, 셀렉터 우선 재생, 시각 효과 |
| `index.html` | 제어판 UI + 주소창 + `<webview>` |
| `renderer.js` | 녹화·재생 상태 관리 + UI 로직 (background.js + popup.js 통합) |

## 실행

```powershell
npm install
npm start
```

또는 VS Code 디버그 구성 **Electron: Main** (`.vscode/launch.json`)으로 실행/디버깅.

## 사용법

1. 상단 주소창에 자동화할 페이지 주소를 입력하고 **이동**.
2. **● 녹화 시작** → 페이지에서 요소 클릭 / 텍스트 입력 / 페이지 이동.
   - 페이지 우하단의 **● 녹화 종료** 버튼 또는 제어판의 같은 버튼으로 종료.
3. **이름**을 적고 **저장** → 여러 시나리오를 **적용**으로 골라 사용.
4. **반복** 횟수 입력 후 **▶ 재생**.
   - 클릭 위치는 화면에 원으로 표시 (녹색=녹화, 주황=셀렉터 재생, 코랄=좌표 폴백, 파랑=입력).
5. **내보내기/가져오기**로 시나리오를 JSON 파일로 영속·이식할 수 있습니다.

## 기능 (확장 버전에서 그대로 이식)

- 셀렉터 1순위 + 좌표 폴백 클릭 녹화/재생
- 페이지 이동 녹화/재생 (이동을 가로지른 재생 연속성)
- 텍스트 입력 한 글자씩 재현(React/Vue 호환 네이티브 setter), Enter=검색/제출
- 필드당 1개 스텝으로 정리(coalesce), 천천히 내려가는 스크롤
- 스텝 단위 삭제, 이름 기반 시나리오 관리

## 한계

- iframe 내부 요소는 기본 미지원.
- 재생 "중지"는 진행 중 스텝이 끝난 뒤 멈춥니다(즉시 강제 중단 아님).
- 새 탭/팝업으로 열리는 흐름은 추가 처리가 필요합니다 (단일 webview에서 동작).

> 주의: 입력값(비밀번호 포함)은 평문으로 시나리오/JSON에 저장됩니다. 민감한 값이
> 들어간 시나리오 파일은 취급에 주의하세요.
