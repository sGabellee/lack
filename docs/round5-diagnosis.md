# Round 5 Diagnosis: Symptom → Root Cause → File:Line

This document establishes the diagnosis for the 9 core issues identified for Lack Round 5.

---

### 1. Explorer: White Rectangle / Truncated Rows
- **Symptom**: A white/blank rectangle covers or cuts off items from about the middle of the sidebar, limiting visible tree rows to ~4 items instead of filling the available sidebar height or reaching the PROJECT pane.
- **Root Causes**:
  1. `style.css:7673`: `.sidebar-tab-content` has `height: 100%` within a flex container (`#explorer-panel` which has `flex-direction: column; overflow: hidden;`), creating a flex chain conflict. Inside flex column layouts, `height: 100%` prevents items from flexing adaptively. It must be `flex: 1; min-height: 0;`.
  2. `renderer.js:3640-3644`: `folderPane.style.flex = `${savedRatio}`` was initialized with a default fallback of `0.5`. In CSS flexbox, when `project-pane` is hidden (`display: none`), a single visible child with `flex-grow: 0.5` (< 1.0) occupies only 50% of the container height, leaving the lower 50% as empty/blank space. When the project pane is hidden, `folder-pane` must have `flex: 1` (`1 1 0%`).
  3. `index.html:516-517`: Legacy `#file-tree` element sat next to `#folder-tree`.
- **File:Line**:
  - `style.css:7669-7685` (`.sidebar-tab-content`, `.sidebar-pane`)
  - `renderer.js:3610-3645` (sidebar split ratio handler)
  - `index.html:516-518`

---

### 2. Shift+Click Selects from First Row Instead of Anchor
- **Symptom**: Shift+clicking a tree row always selects every row from the very top (index 0) down to the clicked item, instead of selecting the range between the previously active/clicked anchor item and the target item.
- **Root Cause**:
  1. In `renderer.js:2393-2398`, the anchor was tracked using a DOM node reference (`lastExplorerAnchorElement`). However, `renderFolderPane` completely destroys and recreates DOM elements via `targetContainer.innerHTML = ""`. Once re-rendered, `allItems.indexOf(lastExplorerAnchorElement)` returns `-1`.
  2. Line 2398 contained: `if (anchorIdx === -1) anchorIdx = 0;`, directly forcing the anchor to index 0 whenever the DOM element reference was lost or stale.
  3. There was no pure range calculation function operating on file paths.
- **File:Line**:
  - `renderer.js:2388-2415` (anchor element indexing and fallback `anchorIdx = 0`)
  - Need `computeRange(flatRows, anchorPath, targetPath)` in `src/projects/ui-controller.js`.

---

### 3. Explorer "New Folder" Button Opens OS Folder Picker
- **Symptom**: Clicking the top explorer "New Folder" button (`#new-folder`) opens an OS directory picker dialog (`dialog.showOpenDialog`) instead of creating an inline folder input.
- **Root Cause**:
  - `renderer.js:3762-3773`: When `!targetDir`, it executes `await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] })`, acting like "Open Folder". If a folder is open, it called `showInlineTreeInput`, but it did not account for the PROGETTO pane or draft projects.
  - Requirement: The top toolbar "new folder" button must trigger an inline `new_folder` row preselected in the currently active pane (or folder/project root), and must NEVER open an OS directory picker.
- **File:Line**:
  - `renderer.js:3762-3775`

---

### 4. PROJECT Pane Disappears When Normal File is Clicked
- **Symptom**: After opening a linked PDF project (which displays both CARTELLA and PROGETTO panes), clicking any regular file in the CARTELLA pane immediately causes the PROGETTO pane to vanish.
- **Root Cause**:
  - `renderer.js:2370-2376`:
    ```javascript
    const isInsideCurrentProjectStore = isLinkedProject && currentProject && currentProject.storePath &&
      path.resolve(itemPath).startsWith(path.resolve(currentProject.storePath));

    if (!isInsideCurrentProjectStore && isLinkedProject) {
      closeLinkedProject();
    }
    ```
    Clicking any normal file outside the virtual project store explicitly called `closeLinkedProject()`. Visibility of the PROJECT pane was tightly coupled to file focus instead of being a persistent session state (`activeProject`).
- **File:Line**:
  - `renderer.js:2370-2376` (and `renderer.js:2364-2367`)

---

### 5. Collaboration: Buttons Do Nothing / Silent Failure
- **Symptom**: Clicking "Start Collaboration" or "Connect" does not result in an active collaborative session between peers.
- **Root Cause**:
  1. WebRTC signaling server URLs in `collaboration.js:85-89` (`wss://y-webrtc.fly.dev`, etc.) are public ephemeral endpoints that often experience downtime. When signaling fails, `WebrtcProvider` constructor does not throw synchronously; it fails asynchronously without updating the UI.
  2. UI state handling was missing: no explicit `connecting`, `connected`, `error` or peer count updates displayed in the modal.
  3. `y-codemirror.next` vs standard CodeMirror `history()`: `history()` in CM6 conflicts with `yCollab({ undoManager })` unless swapped or controlled via a `Compartment`.
  4. In `esbuild.config.js`, `yjs` was marked `external` while other dependencies were bundled, risking duplicate Yjs instances.
- **File:Line**:
  - `collaboration.js:84-114`
  - `src/editor/index.js:655-668`
  - `renderer.js:5098-5145`
  - `esbuild.config.js:15`

---

### 6. macOS Window Controls Setting Has No Effect
- **Symptom**: Changing the window control style setting (GNOME / macOS / Windows) changes CSS styling on Linux, but on macOS native controls do not adapt properly.
- **Root Cause**:
  1. `main.js:120-147`: `createWindow()` always set `frame: false` unconditionally across all operating systems. On macOS, `frame: false` removes the native window chrome and disables traffic lights.
  2. On macOS, frameless titlebar behavior requires `titleBarStyle: 'hidden'` and `trafficLightPosition: { x: 12, y: 12 }`.
  3. `win.setWindowButtonVisibility(boolean)` was never called when toggling between native macOS traffic lights (for style `macos`) and custom client-side controls (for styles `gnome` and `windows`).
- **File:Line**:
  - `main.js:120-147`
  - Need pure module `src/main/window-chrome.js` with `windowChromeFor(platform, style)`.

---

### 7. `./lin-install.sh` Stalls After `adding autoupdate files for: deb`
- **Symptom**: Running `./lin-install.sh` hangs or takes an excessive amount of time at ~40% progress while building the package.
- **Root Cause**:
  1. In `package.json:26`, `"build"` runs `node esbuild.config.js && electron-builder`. In `package.json:78-82`, `linux.target` is configured for `["AppImage", "deb", "tar.gz"]`.
  2. `./lin-install.sh:62` ran `npm run build`, forcing `electron-builder` to download packaging tools (like fpm for Debian packages and appimage tools) and compute heavy blockmaps for full release distributions.
  3. Local installation only needs the unpacked directory: `electron-builder --dir --linux`.
  4. Script lacked upfront `sudo -v` and pipe logging with timeout handling.
- **File:Line**:
  - `package.json:26`
  - `lin-install.sh:62`

---

### 8. Launch Contexts & Start Screen: `lack .` Opens `untitled-1`
- **Symptom**: Running `lack .` opens an `untitled-1` buffer; launching from application launchers (menu, Dock, `.desktop`) uses the parent process working directory (`$HOME` or `/`) as a project folder.
- **Root Cause**:
  1. No distinction existed between CLI invocations and GUI invocations. The cwd was implicitly trusted regardless of launch origin.
  2. CLI wrapper `lack.c` did not export `LACK_LAUNCHED_FROM=cli` or `LACK_CWD`.
  3. `renderer.js` defaulted to creating `untitled-1.tex` whenever no initial file argument was passed, violating the principle of never creating `untitled-1` automatically.
- **File:Line**:
  - `main.js:180-220`
  - `renderer.js:4950-4965`
  - `lack.c`
  - Need pure resolver `resolveLaunch({ argv, env, platform, probe })` in `src/main/launch-resolver.js`.

---

### 9. Contrast: Dark Text on Dark Purple Surfaces
- **Symptom**: Certain UI badges, notably `<span class="collab-beta-badge" style="background:#80007f;">GRATIS ILLIMITATO</span>` in `index.html:1122`, render dark/black text against `#80007f` purple background, failing WCAG AA contrast.
- **Root Cause**:
  - `index.html:1122`: Inline style specifies `background: #80007f;` but omits explicit font color, causing it to inherit dark text.
  - Absence of a standardized CSS token `--on-purple` (pure white `#ffffff`) for all dark-purple backgrounds (`--purple-solid`).
- **File:Line**:
  - `index.html:1122`
  - `style.css` (tokens and badge definitions)
