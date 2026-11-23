# Guida al Rilascio di Lack (Multi-Piattaforma: Linux, Windows, macOS)

Questa guida spiega come rilasciare e distribuire Lack su tutte e tre le principali piattaforme operative (**Linux**, **Windows**, **macOS**).

---

## 1. Architettura di Rilascio

Il rilascio su tutte le piattaforme viene gestito in modo affidabile e automatizzato tramite **GitHub Actions** (`.github/workflows/release.yml`), che compila l'applicazione nativamente sulle macchine virtuali dei tre sistemi operativi:

| Piattaforma | Runner CI | Formati Pacchetto Generati |
| :--- | :--- | :--- |
| **Linux** | `ubuntu-22.04` | `.AppImage` (portabile), `.deb` (Debian/Ubuntu), `.tar.gz` |
| **Windows** | `windows-latest` | `.exe` (Installer NSIS guidato), `.zip` (portabile standalone) |
| **macOS** | `macos-latest` | `.dmg` (immagine disco con drag-and-drop), `.zip` |

Al termine della compilazione, tutti gli artefatti vengono raccolti, viene generato il file di checksum crittografico `SHA256SUMS.txt`, e viene creata/aggiornata la **GitHub Release** corrispondente.

---

## 2. Come Effettuare la Nuova Release (v1.1.0)

Ci sono due modi semplici per innescare la release:

### Metodo A: Tramite Tag Git dal Terminale (Raccomandato)

1. Assicurati che il codice sia su `main` e pulito:
   ```bash
   git checkout main
   git pull origin main
   ```

2. Crea il tag di versione (es. `v1.1.0`):
   ```bash
   git tag v1.1.0
   ```

3. Spingi il tag su GitHub:
   ```bash
   git push origin v1.1.0
   ```

4. Il workflow GitHub Actions si avvierà automaticamente. Puoi seguire lo stato di avanzamento nella scheda **Actions** del repository:
   `https://github.com/sGabellee/lack/actions`

---

### Metodo B: Tramite Interfaccia Web di GitHub (Workflow Dispatch)

1. Vai su GitHub alla scheda **Actions**:
   `https://github.com/sGabellee/lack/actions/workflows/release.yml`
2. Clicca sul pulsante **"Run workflow"** sulla destra.
3. Seleziona il ramo `main`.
4. Nel campo **"Release Tag"**, inserisci il tag desiderato (es. `v1.1.0`).
5. Clicca su **"Run workflow"**.

---

## 3. Comandi di Build Locali per Piattaforma

Nel file `package.json` sono configurati gli script per testare o generare i pacchetti in locale:

- **Linux**:
  ```bash
  npm run build:linux
  ```
  Genera in `dist/` i file `Lack-1.1.0.AppImage`, `lack_1.1.0_amd64.deb`, `Lack-1.1.0.tar.gz`.

- **macOS** (su macchina Mac):
  ```bash
  npm run build:mac
  ```
  Genera in `dist/` i file `Lack-1.1.0.dmg` e `Lack-1.1.0-mac.zip`.

- **Windows** (su macchina Windows):
  ```cmd
  npm run build:win
  ```
  Genera in `dist/` i file `Lack Setup 1.1.0.exe` e `Lack-1.1.0-win.zip`.

- **Installatori Standalone Locali**:
  - Linux: `./lin-install.sh` (compila ed installa localmente in `/opt/lack` e registra il binario globale `/usr/local/bin/lack`).
  - macOS: `./mac-install.sh` (installa dipendenze, compila il DMG, installa in `/Applications/Lack.app` e crea il comando terminale `lack`).
  - Windows: `win-install.bat` (compila, installa in `%LOCALAPPDATA%\Programs\Lack`, crea collegamenti Desktop/Start Menu e associa l'estensione `.tex`).
