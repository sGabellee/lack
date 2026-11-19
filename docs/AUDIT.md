# Project Quality & Security Audit (Round 6)

Comprehensive static analysis, dependency health check, and code quality audit performed on Lack codebase.

---

## 1. Tool Execution Summary

| Tool | Status | Findings | Remediation |
|---|---|---|---|
| `depcheck` | Completed | Missing declared dependency: `@lezer/highlight`. Unused declared dependencies: `@retorquere/bibtex-parser`, `chokidar`, `dictionary-*`. | Installed and declared `@lezer/highlight`. Retained dictionaries for offline spellcheck. |
| `npm audit --omit=dev` | 3 Moderate Vulnerabilities | `minimatch` ReDoS in `archiver` dependency tree. | Evaluated: Safe in local desktop runtime; scheduled non-breaking upstream bump. |
| `eslint` (flat config) | **0 Errors**, 75 Warnings | 4 dead assignments in `spell-tokenizer.js`, `import.js`, `recents.js`, `ui-controller.js`. | Cleaned dead assignments; 0 errors remaining. |
| `tsc --allowJs --checkJs --noEmit` | 37 Type Warnings | Untyped `onProgress` callbacks, date subtraction arithmetic, private method access in `pdf-lib`. | Documented and targeted for safe typed refactoring in main modules. |
| `npm ls --all` | Validated | All `@codemirror/*` dependencies deduplicated cleanly to single semantic versions. | No duplicate runtime instances in bundle. |

---

## 2. Audit Findings by Severity

### High Severity (Functional & Security Critical)

| ID | Location | Issue Description | Impact | Resolution | Status |
|---|---|---|---|---|---|
| **SEC-01** | `main.js:32-60` | Missing `setWindowOpenHandler` and `will-navigate` restrictions on `BrowserWindow`. | Untrusted external URLs could open directly within application window context. | Added strict `setWindowOpenHandler` opening external URLs via `shell.openExternal` and `will-navigate` blocker. | **Fixed & Verified** |
| **SEC-02** | `index.html:8` | Missing Content Security Policy (`<meta http-equiv="Content-Security-Policy">`). | Increases attack surface if rendering untrusted user LaTeX/HTML. | Added strict CSP permitting local assets, KaTeX inline font/styles, and WSS for WebRTC. | **Fixed & Verified** |
| **SEC-03** | `renderer.js:2076` | `livePreviewEl.innerHTML = htmlContent` renders AST output directly without sanitization. | XSS risk if raw HTML/scripts are embedded in preview. | Added `DOMPurify.sanitize` to preview renderer. | **Fixed & Verified** |
| **COL-01** | `collaboration.js`, `esbuild.config.js` | Dual-package hazard between CJS `@codemirror/*` and ESM `y-codemirror.next` caused silent exception on collaboration start. | User clicks "Avvia Sessione Collaborativa" and button does nothing. | Configured esbuild deduplication plugin resolving all `@codemirror/*` to ESM index, added spinner, 4-state lifecycle, and status surfaces. | **Fixed & Verified** |
| **COL-02** | `main.js:49` | Single instance lock blocks launching secondary instances needed for collaboration tests and multi-window workflows. | Users or test runners cannot open two instances with separate profiles. | Supported `process.env.LACK_USER_DATA` and implemented CLI `--collab-selftest`. | **Fixed & Verified** |

---

### Medium Severity (UX & Visual Regressions)

| ID | Location | Issue Description | Impact | Resolution | Status |
|---|---|---|---|---|---|
| **UX-01** | `src/editor/autocomplete.js`, `style.css` | Fuzzy subsequence matching underlines scattered letters (`\sect` matching `\usecounter`); `f` icon displayed; italic labels. | Autocomplete popup looks cluttered and diverges from Overleaf reference. | Implemented 4-tier ranking (Exact, Prefix, Substring, Typo <= 1); removed `f` icon and underlines; bold prefix highlight; argument signatures (`\section{}`). | **Fixed & Verified** |
| **UX-02** | `src/editor/linter.js` | Red squiggly errors and gutter marks appear on active incomplete command while user is typing. | Distracting visual noise while typing LaTeX commands. | Suppress linter diagnostics on active token at cursor while typing; debounced linting to 800ms idle. | **Fixed & Verified** |
| **UX-03** | `index.html:630`, `style.css:7511` | Floating SyncTeX pill (`#synctex-divider-control`) positioned at fixed `top: 92px`. | Overlaps lower-left PDF canvas and covers rendered LaTeX document text. | Moved pill to horizontal layout (`top: 6px; height: 26px`), cleanly docked above the PDF canvas inside the header seam with 32px left clearance for `Compila`. | **Fixed & Verified** |
| **UX-04** | `renderer.js:820`, `index.html:648`, `style.css:6606` | Missing id `pdf-toolbar` caused ResizeObserver to fail; toolbar overflowed offscreen, hiding fit width (`↔`) and fit page (`↕`). | User cannot see or click fit buttons at normal desktop / split-pane widths (400-500px). | Added id `pdf-toolbar`, classified fit vs secondary items, implemented dynamic `ResizeObserver` maintaining `↔` and `↕` visible down to 320px, and collapsible secondary items in `⋯` popover. | **Fixed & Verified** |
| **UX-05** | `style.css:4078`, `index.html:1182` | "GRATIS ILLIMITATO" badge wrapped into two lines and had suboptimal contrast. | Badge looked broken and wrapped into 2 lines with dark text. | Added `white-space: nowrap`, explicit `color: #ffffff !important`, line-height, and contrast audit verification (9.44:1). | **Fixed & Verified** |

---

### Low Severity (Code Cleanliness & Maintenance)

| ID | Location | Issue Description | Impact | Proposed Fix |
|---|---|---|---|---|
| **CLEAN-01** | `src/projects/recents.js:94` | Useless variable assignment in `existsSync` probe. | ESLint warning. | Resolved by declaring variable without duplicate initializer. |
| **CLEAN-02** | `src/editor/spell-tokenizer.js:48` | Unused `segEnd` pre-computation before digit check. | ESLint warning. | Moved `segEnd` calculation after token validation filters. |
| **CLEAN-03** | `src/projects/registry.js:134` | Subtraction of Date objects without `.getTime()` coercion. | TypeScript type warning. | Coerce to timestamp using `a.getTime() - b.getTime()`. |
| **CLEAN-04** | `src/main/engine-installer.js:28` | Default `onProgress = () => {}` typed with 0 arguments. | TypeScript type warning. | Add typed argument signature `onProgress = (_p) => {}`. |
