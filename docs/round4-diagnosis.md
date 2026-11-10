# Round 4 Diagnosis: Lack Root-Cause Analysis

## 1. Trace: `lack prova1` (Extension-less launch and rogue `build/` creation)

### Execution Trace
1. **`lack.c`**:
   - Captures `getcwd()` and exports it as `setenv("LACK_CWD", cwdBuffer, 1)`.
   - Spawns `/opt/lack/lack prova1` (or electron with `main.js prova1`).
2. **`main.js`**:
   - Reads `process.argv` and `process.env.LACK_CWD`.
   - Calls `resolveOpenAction({ rawArgv: process.argv.slice(1), cwd: callerCwd, registry, readLinkFn: readLink })` in `src/main/cli.js`.
3. **`src/main/cli.js` (`resolveOpenAction`)**:
   - `parseCliArgs` extracts `positional = 'prova1'`.
   - Resolves target path: `targetPath = path.resolve(baseCwd, 'prova1')`.
   - Checks `isPdf = targetPath.toLowerCase().endsWith('.pdf')` (evaluates to **`false`**).
   - In lines 61-79: Since `isPdf` is false, it treats `prova1` as a classic file/folder.
   - Because `fs.existsSync(targetPath)` is false, it executes line 78:
     ```javascript
     return { action: 'classic', openFilePath: targetPath, openFolderPath: path.dirname(targetPath), debug };
     ```
4. **Window message dispatch (`main.js`)**:
   - Sends IPC `'open-folder'` with `openFolderPath = cwd`.
   - Sends IPC `'load-tex'` with `openFilePath = '/path/to/prove/prova1'`.
5. **Renderer reception (`renderer.js`)**:
   - `ipcRenderer.on('load-tex', (filePath) => createTab(path.basename(filePath), '', filePath))` opens a tab pointing directly to `/path/to/prove/prova1`.
   - When the user saves (or on compile/auto-compile write actions), the file `/path/to/prove/prova1` is created as a raw regular file on disk without any extension or template.
6. **Compile pipeline & `build/` directory creation (`latex-compiler.js`)**:
   - When compilation is triggered on `targetFile = '/path/to/prove/prova1'`, line 258 sets `workDir = path.dirname(targetFile) = cwd`.
   - Line 270: `const outDir = outputDir || path.join(workDir, "build");`
   - Line 272: `fs.mkdirSync(outDir, { recursive: true });` creates `<cwd>/build/`!
   - Line 388 (built-in engine): `outDir = projectDir ? path.join(projectDir, "build") : ...; fs.mkdirSync(outDir, { recursive: true });` creates another `build` folder.
   - Line 281: writes `buildTempFile = path.join(outDir, 'prova1.tex')` into `<cwd>/build/prova1.tex`.

### Root Cause
1. `resolveOpenAction` did not implement the extension-less launch rule (`lack NAME` where path does not exist should resolve as a new linked project `target: <cwd>/NAME.pdf`).
2. Classic compilation defaulted `outputDir` to `path.join(workDir, "build")` inside the user's directory instead of isolated user cache (`app.getPath('cache')/lack/builds/<sha1(projectPath)>/`).
3. Linked project main file was hard-coded to `main.tex` instead of `<name>.tex` where `<name>` is the PDF base name.

---

## 2. Built-in Engine on IEEE Template (`\documentclass[conference]{IEEEtran}`)

### Symptoms Observed
- Preview title banner shows: `Conference Paper Title*\\ {\footnotesize \textsuperscript{*` (truncated at the first `}`).
- `\author{\IEEEauthorblockN{...}\IEEEauthorblockA{...}\and ...}` rendered as raw text.
- `\begin{abstract}...\end{abstract}` and `\begin{IEEEkeywords}...\end{IEEEkeywords}` rendered as raw `<p>` text.
- Body is single column instead of conference two-column layout.

### Root Causes
1. **Greedy non-brace-counting regular expressions**:
   In `latex-compiler.js` (lines 443-446):
   ```javascript
   const titleMatch = latexText.match(/\\title\{([^}]+)\}/);
   const authorMatch = latexText.match(/\\author\{([^}]+)\}/);
   ```
   `[^}]+` matches characters up to the *first* closing brace `}`. When `\title` contains nested macros with braces (such as `{\footnotesize \textsuperscript{*}Note...}`), `[^}]+` cuts off immediately at the first closing brace `}` of `\textsuperscript{*}`, leaving broken HTML and raw macro fragments.
2. **Missing environment dispatch**:
   `convertLatexToHtml` only had hardcoded replacements for `\begin{itemize}` and `\begin{enumerate}`. Any other environment (`abstract`, `IEEEkeywords`, `IEEEbiography`, `table`, `figure`, `align`, `equation`) was ignored, falling through to generic paragraph splitting which emits raw `\begin{...}` and `\end{...}` to HTML.
3. **No class-aware layout or two-column rendering**:
   `\documentclass[conference]{IEEEtran}` was completely ignored; no two-column CSS grid was applied, and author block splitting across `\and` was not implemented.
4. **Raw LaTeX code paths in `latex-compiler.js`**:
   - `latexText.match(/\\title\{([^}]+)\}/)` (naive regex truncation)
   - `latexText.match(/\\author\{([^}]+)\}/)` (naive regex truncation)
   - Paragraph emission (`paras.forEach(p => ... <p class="latex-p">${p}</p>)` without macro stripping/evaluation).
   - Any unhandled macro `\foo{bar}` was left untouched in `pageContent` and dumped directly into the DOM.

---

## 3. Pink / Magenta Sources in Dark & GitHub Dark Themes

### Grep Audit Results
1. **`src/editor/themes.js`**:
   - Line 6, 171-184:
     - `latexCommandTag`: `#d98cd9` (pink/magenta, HSL: ~300°, 50%, 70%)
     - `latexDelimiterTag`: `#d98cd9`
     - `tags.keyword`: `#d98cd9`
     - `tags.bracket`: `#d98cd9`
     - `tags.heading`: `#d98cd9`
2. **`style.css`**:
   - `#d98cd9` appears across 15 CSS rules:
     - Line 1353: `.cm-editor .cm-lineNumbers .cm-activeLineGutter`
     - Line 2872: Tab close button active/hover state
     - Line 3306: Active file in sidebar / file explorer tree item
     - Lines 4355-4378: Quick outline items & active symbols
     - Lines 4465-4466: Active tab indicator & link badges
     - Line 4696, 5103: Toolbar active buttons
     - Line 5741, 6108: Status bar badges
     - Line 6244: Compilation indicator dot
     - Line 7249: `--virtual-rail: #d98cd9;`
3. **`test/palette-contrast.test.js` & `test/virtual-pane-contrast.test.js`**:
   - Hardcoded assertions testing `#d98cd9` instead of `--purple-text`.

### Solution
Extract tokens into `themes.css`:
- `--purple-solid`: `#80007f` (compile button background, badges, solid selections).
- `--purple-text`: `#b266d1` (accessible violet: hue 282°, saturation 54%, lightness 61%, contrast > 4.5:1 against dark backgrounds `#1e1e1e`, `#1f1f1f`, `#0d1117`).
- Zero `#d98cd9` or any hue in [295°, 345°] with lightness >= 55%.

---

## 4. Spellcheck: Hyphenated Words and Contractions

### Observations & Root Cause
In `src/editor/spell-tokenizer.js`:
- The regex segmenter matches:
  ```javascript
  const segmentRegex = /([^\s.,;:!?"'()\[\]{}<>/\\#*+=~`$|&^%_]+(?:[''-][^\s.,;:!?"'()\[\]{}<>/\\#*+=~`$|&^%_]+)*)/gu;
  ```
- Words like `Sub-titles`, `camera-ready`, `two-column`, `state-of-the-art` are captured as single tokens:
  `{ word: 'Sub-titles', from: X, to: Y }`
- In `spell.worker.js` / dictionary lookup:
  Neither English nor Italian dictionary contains compound hyphenated strings like `camera-ready`.
  Because `checkWord("camera-ready")` evaluates to false in all dictionaries, the entire compound word is highlighted with a red wavy squiggle.
- In addition, if a compound word has a true spelling error (e.g. `camra-ready`), the whole word was highlighted instead of isolating only `camra`.
