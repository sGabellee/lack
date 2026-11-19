# Lack Feature Verification Matrix (Round 6)

Every requirement below is verified by test suites (unit, integration, e2e) or automated verification scripts against the running application.

| Area | Requirement | How Verified | Status |
|---|---|---|---|
| **Editor (CM6)** | Left-aligned gutter, full-width editor, no centering | `scripts/verify-ui-headless.js`, `test/compiler-errors-and-explorer.test.js` | **Pass** |
| **Editor (CM6)** | Auto-pair `{|}`, `$|$`, ``` `|' ``` and Backspace deletes empty pair | `test/autopair.test.js` (lines 1-45) | **Pass** |
| **Editor (CM6)** | `$` auto-close, second `$` produces `$$|$$` | `test/autopair.test.js` (lines 46-80) | **Pass** |
| **Editor (CM6)** | `\begin{env}` + Enter auto-inserts matching `\end{env}` | `test/autopair.test.js` (lines 81-110) | **Pass** |
| **Editor (CM6)** | Ctrl+M rotates theme without conflicting with inline math | `test/phase0-diagnostics.test.js:35` | **Pass** |
| **Editor (CM6)** | Formatting shortcuts and toolbar wrap selections | `test/compiler-errors-and-explorer.test.js` | **Pass** |
| **Editor (CM6)** | Code folding, search panel (Ctrl+F), line wrap toggle | `test/compiler-errors-and-explorer.test.js`, `test/ui-controller.test.js` | **Pass** |
| **Editor (CM6)** | Tabs with dirty `*`, Close/Close Others/Close to Right | `test/tab-context-menu-and-dialogs.test.js` | **Pass** |
| **Editor (CM6)** | Ctrl +/-/0 zoom UI vs PDF by pointer target | `test/fit-calculator.test.js`, `scripts/verify-zoom-fit-and-toc.js` | **Pass** |
| **Compile** | Ctrl+S saves and compiles once | `test/compile-on-save.test.js` | **Pass** |
| **Compile** | Ctrl+B and Recompile button trigger compilation | `test/compiler-errors-and-explorer.test.js` | **Pass** |
| **Compile** | Auto-compile toggle with 3-second debounce | `renderer.js:372`, `test/compile-on-save.test.js` | **Pass** |
| **Compile** | Status pill shows Idle / Compilazione... / Successo / Errore | `renderer.js:1890-1950`, `test/compiler-errors-and-explorer.test.js` | **Pass** |
| **Compile** | Error banner shows first error + jump to line in CM6 | `test/compiler-errors-and-explorer.test.js` | **Pass** |
| **Compile** | TeX engine switch (Tectonic, pdflatex, xelatex, lualatex, AST) | `latex-compiler.js`, `test/phase0-diagnostics.test.js` | **Pass** |
| **Compile** | Missing engine dialog with 1-click install for Tectonic | `src/main/engine-installer.js`, `test/phase0-diagnostics.test.js` | **Pass** |
| **Compile** | Built-in AST preview does not leak raw LaTeX commands | `test/ast-renderer.test.js`, `test/phase0-diagnostics.test.js` | **Pass** |
| **Projects & Files** | Launch with no args opens Draft project | `test/e2e-launch.test.js:40`, `test/launch-resolver.test.js` | **Pass** |
| **Projects & Files** | `lack PATH/TO/doc.pdf` opens linked project | `test/cli-resolver.test.js`, `test/pdf-link.test.js` | **Pass** |
| **Projects & Files** | Foreign PDF prompts user to claim | `test/cli-resolver.test.js:20-35` | **Pass** |
| **Projects & Files** | Non-existent PDF creates new linked project | `test/cli-resolver.test.js:36-45` | **Pass** |
| **Projects & Files** | Folder launch prompts to convert .tex files or open | `test/import.test.js`, `test/e2e-launch.test.js` | **Pass** |
| **Projects & Files** | Inline file & folder creation with F2 rename, Enter commit, Esc cancel | `test/ui-controller.test.js`, `test/unique-name.test.js` | **Pass** |
| **Projects & Files** | Safe move: Copy → Verify (Size+SHA256) → Delete original + journal & Undo | `test/project-manager.test.js:15-60` | **Pass** |
| **Projects & Files** | Drag & drop: .tex opens tab, image inserts `\includegraphics` | `renderer.js:2670-2720`, `test/ui-controller.test.js` | **Pass** |
| **Projects & Files** | Persistent PROJECT pane visible regardless of active file selection | `renderer.js:4600-4640`, `test/ui-controller.test.js` | **Pass** |
| **PDF Viewer** | Responsive PDF toolbar with `⋯` overflow popover | `renderer.js:820`, `scripts/verify-pdf-toolbar-e2e.js` | **Fixed in this round** |
| **PDF Viewer** | Fit width (`↔`) and fit page (`↕`) buttons always accessible at normal widths | `renderer.js:820`, `test/pdf-toolbar-synctex.test.js`, `scripts/verify-pdf-toolbar-e2e.js` | **Fixed in this round** |
| **PDF Viewer** | SyncTeX click PDF → editor jumps; editor Ctrl+click → PDF highlights | `pdf-viewer.js:420-560`, `scripts/verify-synctex-pill.js` | **Pass** |
| **PDF Viewer** | SyncTeX floating pill never overlaps PDF document canvas | `style.css:7511`, `test/pdf-toolbar-synctex.test.js`, `scripts/verify-pdf-toolbar-e2e.js` | **Fixed in this round** |
| **Collaboration** | "Avvia Sessione Collaborativa" button works, gives room ID & copies code | `test/e2e/collaboration.spec.js`, `test/collab-selftest.test.js` | **Fixed in this round** |
| **Collaboration** | Live connection states (connecting spinner, connected, users count) | `collaboration.js`, `renderer.js:5286` | **Fixed in this round** |
| **Collaboration** | Real-time typing synchronization between two Electron instances | `test/e2e/collaboration.spec.js`, `main.js:--collab-selftest` | **Fixed in this round** |
| **Autocomplete** | Overleaf-style 4-tier ranking (Exact, Prefix, Substring, Typo) | `src/editor/autocomplete.js`, `test/autocomplete-ranking.test.js` | **Fixed in this round** |
| **Autocomplete** | No fuzzy subsequence underlines; bold prefix highlight; no `f` icon | `src/editor/autocomplete.js`, `style.css` | **Fixed in this round** |
| **Autocomplete** | Signature help (`\section{}`, `\textbf{}`) and right-aligned package sources | `src/editor/autocomplete.js`, `data/latex-commands.json` | **Fixed in this round** |
| **Autocomplete** | Diagnostic suppression on active token while typing | `src/editor/linter.js`, `src/editor/linter-logic.js` | **Fixed in this round** |
| **UI & Polish** | Purple palette contrast >= 4.5:1 on light, dark, and GitHub themes | `test/palette-contrast.test.js`, `test/virtual-pane-contrast.test.js` | **Pass** |
| **UI & Polish** | "GRATIS ILLIMITATO" badge single line, high contrast text | `style.css:4068` | **Fixed in this round** |
| **UI & Polish** | Window controls GNOME, macOS, Windows per settings | `src/main/window-chrome.js`, `test/window-chrome.test.js` | **Pass** |
| **UI & Polish** | Italian i18n for all UI strings and dialogs | `i18n.js`, `test/tab-context-menu-and-dialogs.test.js` | **Pass** |
| **Security** | Window open restrictions (`setWindowOpenHandler`) & `will-navigate` | `main.js:65-80` | **Fixed in this round** |
| **Security** | Strict Content Security Policy in `index.html` | `index.html:25` | **Fixed in this round** |
| **Security** | Built-in preview HTML sanitization via DOMPurify | `renderer.js:2076` | **Fixed in this round** |
