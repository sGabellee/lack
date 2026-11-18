# Lack macOS Validation Checklist

This checklist documents the manual verification procedure for Lack on macOS (macOS 12 Monterey, 13 Ventura, 14 Sonoma, 15 Sequoia).

---

## 1. Window Controls Styles (Preferences → Interfaccia / Aspetto)

### Test 1.1: Native macOS Style (`macos`)
- **Step**: Open Preferences (Impostazioni) -> Window Controls Style -> Select **macOS**.
- **Expected Result**:
  - Native macOS traffic light buttons (Red, Yellow, Green) appear on the top-left at `{ x: 12, y: 12 }`.
  - In-DOM custom window controls on the top-right are hidden.
  - Hovering over Green button shows native macOS window tiling menu (Tile Left, Tile Right).

### Test 1.2: GNOME Style on macOS (`gnome`)
- **Step**: Switch Window Controls Style to **GNOME**.
- **Expected Result**:
  - Live change without application restart.
  - Native traffic lights disappear (`win.setWindowButtonVisibility(false)`).
  - GNOME circular close button appears on the top-right (or top-left according to GNOME layout).

### Test 1.3: Windows Style on macOS (`windows`)
- **Step**: Switch Window Controls Style to **Windows**.
- **Expected Result**:
  - Native traffic lights remain hidden.
  - Rectangular Windows-style controls (`─`, `□`, `✕`) appear on the top-right.

---

## 2. Window Titlebar Interactions

### Test 2.1: Window Dragging
- **Step**: Click and drag on empty spaces in the titlebar.
- **Expected Result**:
  - Window drags smoothly across monitors (`-webkit-app-region: drag`).
  - Interactive elements (tabs, buttons, menus, inputs) have `-webkit-app-region: no-drag` and accept clicks without moving the window.

### Test 2.2: Double-click to Maximize / Zoom
- **Step**: Double-click on an empty space of the titlebar.
- **Expected Result**:
  - Toggles between normal window geometry and maximized/zoomed state.

### Test 2.3: Fullscreen Mode
- **Step**: Click Green traffic light or press `Cmd + Ctrl + F` to enter macOS native fullscreen.
- **Expected Result**:
  - App enters native macOS fullscreen space.
  - Custom window controls hide cleanly.
  - Pressing `Esc` or `Cmd + Ctrl + F` restores original geometry.

---

## 3. Data Protection and Session

### Test 3.1: Close with Dirty Tabs
- **Step**: Create a new document, type LaTeX code without saving, and press `Cmd + W` or click the Red close button.
- **Expected Result**:
  - Centered confirmation dialog appears ("Salvare le modifiche prima di chiudere?").
  - Options: "Salva", "Non salvare", "Annulla".
  - Clicking "Annulla" keeps window and editor open with zero data loss.
