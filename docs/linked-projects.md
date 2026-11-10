# Linked Projects Design Note (Lack)

## 1. Overview & Architectural Goals
Lack introduces **Linked Projects** (PDF-anchored virtual projects): a workflow where a document's LaTeX source files and build artifacts are decoupled from the target destination in a user's repository.
When a user works with `repo/report.pdf`, the actual LaTeX project sources (`main.tex`, figures, bibliography, styles) live inside an isolated store (`~/.config/Lack Projects/<slug>-<id8>/` or user documents). When compiled, intermediate artifacts (`.aux`, `.log`, `.synctex`) remain in the store's private `.lack/build/` directory, while only the finished, post-processed `report.pdf` is atomically written to `repo/report.pdf`.

---

## 2. Phase 0 Diagnosis

### 2.1 Current CLI & Process Argv Parsing (`main.js` & `lack.c`)
- **In `main.js`**:
  `process.argv` is sliced with `process.defaultApp ? process.argv.slice(2) : process.argv.slice(1)`. The first argument not starting with `--` is treated as `targetArg`.
  Path resolution currently uses `path.resolve(process.cwd(), targetArg)`.
  In `app.on('second-instance')`, arguments are resolved using `path.resolve(workingDirectory, target)`.
- **In `lack.c`**:
  The C wrapper previously invoked `/opt/lack/lack` directly without capturing the caller's working directory or environment. On Linux, if launched from another working directory or via desktop integration, Electron's `process.cwd()` can diverge from the invocation path.
  **Resolution**: In `lack.c`, `getcwd()` is captured and passed as `LACK_CWD` environment variable before `fork()`/`execv()`. In `main.js`, all CLI relative paths resolve against `process.env.LACK_CWD || process.cwd()`.

### 2.2 Current Compilation Pipeline (`latex-compiler.js` & `renderer.js`)
- `renderer.js` calls `ipcRenderer.invoke('compile-latex', compileOpts)`.
- `compileOpts` passes `filePath`, `content`, `projectDir: currentProjectDir`, `engine`, `isMemoryBuffer: true`.
- If `isMemoryBuffer` is true, `latex-compiler.js` writes the in-memory tab content to a temporary `.tex` file in `outDir` (`path.join(workDir, "build")`), compiles using `pdflatex`/`xelatex`/`tectonic`/`latexmk`, and outputs to `outDir`.
- **Limitation**: The current system assumes that all relative image assets and `\input{...}` files reside in `projectDir`. If `projectDir` is the destination repo, build auxiliary files pollute the destination or build files fail if sources are elsewhere.

### 2.3 Current Explorer & Tree Layout
- Explorer uses a single `#file-tree` inside `#explorer-panel`.
- `openFolder(dir)` recursively populates the file tree via `fs.readdirSync`.
- Resizing is controlled by `#explorer-resizer`.
- **Assumption**: A single directory tree containing both LaTeX sources and output PDF.

### 2.4 PDF Viewer Loading (`pdf-viewer.js`)
- `pdfViewer.loadPdfDocument(filePath)` loads local files via file URI or Uint8Array.
- The preview currently assumes the PDF path is directly the output from `latex-compiler.js`.

### 2.5 Assumptions: "Open File == Real Path On Disk Next To Assets"
Places in the current codebase making this assumption:
1. `setMainDocument(filePath)` sets `currentProjectDir = path.dirname(filePath)`.
2. `getProjectImageFiles()` and `getProjectTexFiles()` scan `currentProjectDir`.
3. `Ctrl+Click` multi-file navigation resolves `\input` against `currentProjectDir || path.dirname(activeTab.filePath)`.
4. `saveFile()` assumes saving an untitled tab writes to `currentProjectDir`.
5. Local history snapshots (`saveFileHistorySnapshot`) writes to `.lack-history` in `path.dirname(filePath)`.
6. Autocomplete and image path completion query `currentProjectDir`.

In linked projects, **all source file lookups, history backups, and image lookups are rooted in the project store**, while the FOLDER pane monitors the repository directory containing the target PDF.

---

## 3. Data Model

### 3.1 Project Store Structure
The default store directory is located at:
`app.getPath('documents')/Lack Projects/<slug>-<id8>/`

Internal layout:
```text
<slug>-<id8>/
  ├── project.json              # Project manifest (schema: 1)
  ├── main.tex                  # Primary LaTeX document
  ├── figures/                  # Project figures and assets
  ├── refs.bib                  # Project bibliography
  └── .lack/                    # Private internal state (hidden from UI)
      ├── build/                # Isolated LaTeX build directory (aux, log, synctex, pdf)
      ├── history/              # Local revision snapshots
      └── lock                  # Single-window lock: { pid, windowId, timestamp }
```

### 3.2 Manifest Schema (`project.json`)
```json
{
  "schema": 1,
  "id": "e4b2d189-9b5a-4e2a-9cb8-6f17e3a35d10",
  "name": "Report Analysis",
  "main": "main.tex",
  "engine": "pdflatex",
  "target": "/home/user/work/reports/final-report.pdf",
  "embedSnapshot": false,
  "template": "standard",
  "createdAt": "2026-11-10T13:00:00.000Z",
  "updatedAt": "2026-11-10T14:00:00.000Z",
  "linkedAssets": [
    {
      "path": "figures/plot.png",
      "source": "/home/user/work/sim/output.png"
    }
  ]
}
```

### 3.3 Registry (`userData/projects.json`)
Maps project IDs to their storage location:
```json
{
  "e4b2d189-9b5a-4e2a-9cb8-6f17e3a35d10": {
    "storePath": "/home/user/Documents/Lack Projects/report-analysis-e4b2d189",
    "name": "Report Analysis",
    "lastPdfPath": "/home/user/work/reports/final-report.pdf",
    "lastOpened": "2026-11-10T14:15:00.000Z"
  }
}
```
- **Atomic updates**: All writes use `projects.json.tmp-<pid>` followed by `fs.rename`.
- **Self-healing**: If `projects.json` is missing or corrupted, the registry scans `<storeRoot>/*/project.json` and reconstructs entries automatically.

---

## 4. Flows & Lifecycle

### 4.1 CLI & Launch Decision Table
| Input | Condition | Action |
|---|---|---|
| `lack` / `lack file.tex` / `lack dir/` | Any | Classic local file/folder mode unchanged |
| `lack x.pdf` | Has `/LackProjectID`, ID in registry | Open linked project (PDF in preview, `main.tex` in editor, both sidebar panes) |
| `lack x.pdf` | Has `/LackProjectID`, ID NOT in registry | Prompt dialog: (a) Restore from embedded snapshot, (b) Relink to registry project, (c) Open as plain PDF |
| `lack x.pdf` | Exists, no link metadata | Prompt dialog: (a) Open as plain PDF (default), (b) Create linked project with confirmation |
| `lack x.pdf` | Does NOT exist | Create new project in store, set `target` to `x.pdf`, compile immediately so `x.pdf` is created |
| `lack x.pdf` | Parent directory missing or is dir | Error notification, abort |

### 4.2 PDF ↔ Project Linking (`pdf-lib`)
- After successful compilation in `.lack/build/main.pdf`:
  1. Load PDF with `PDFDocument.load(bytes, { updateMetadata: false })`.
  2. Write `/LackProjectID` and `/LackProjectName` into Info dictionary.
  3. Add `lack:project=<id>` to `/Keywords`.
  4. If `embedSnapshot` is true: create a zip of store sources (excluding `.lack/` and symlinks) using `archiver`, cap at 25 MB, and attach via `pdfDoc.attach(zipBytes, 'lack-project.zip', ...)`.
  5. Save with reproducible timestamp (`SOURCE_DATE_EPOCH` / `modificationDate`).
  6. Atomically write to `<target>.tmp-<pid>` in the target directory and rename over `target`.
- If post-processing fails: keep original compiled PDF and log warning; fall back to registry matching by path.

### 4.3 Save & Compile Flow (`Ctrl+S`)
- On `Ctrl+S`:
  1. Save current active tab atomically (`.tmp` + rename).
  2. If file extension is compilable (`.tex`, `.bib`, `.sty`, `.cls`, `.bst`) and `compileOnSave` is true:
     - Cancel pending auto-compile debounce timer.
     - Immediately invoke compilation of main document (with in-memory tab buffer overlay).
  3. If compilation fails: never fail or revert file save; display errors in Log drawer without blocking modals.

### 4.4 Sidebar: Two-Pane Splitter
- **FOLDER pane**: shows real files in target directory. The linked PDF entry displays a purple link badge.
- **PROJECT pane**: displays project store tree. Root item is styled with purple link badge and project name.
  - Tinted background (`--virtual-bg`: `#80007f` ~7% opacity).
  - 3px purple left rail on tree rows (`--virtual-rail`).
  - Draggable splitter `#sidebar-resizer` between FOLDER and PROJECT panes.

---

## 5. Failure Modes & Mitigations

1. **Target PDF moved or renamed externally**:
   - Monitored by target file watcher.
   - On next open or compile: offer dialog to update location or re-link.
2. **Crash / power loss mid-compilation or write**:
   - Target PDF is written to `<target>.tmp-<pid>` first and renamed atomically.
   - If process is terminated mid-compile, the existing target PDF remains intact.
   - On startup, orphaned `.tmp-*` files are swept and deleted.
3. **Store folder deleted externally while registered**:
   - Detect missing store; offer to Relink, Restore from PDF snapshot (if embedded), or remove registry entry.
4. **Duplicate copies of linked PDF**:
   - `readLink()` reads identical `LackProjectID`. Both open the same project store, updating `lastPdfPath` to the active file.
5. **Symlink Escape / Path Traversal Attack**:
   - All store file access is resolved through `path.resolve` and checked against `storePath` boundary via `fs.realpath` (excluding explicitly approved `linkedAssets`).
