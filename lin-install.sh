#!/usr/bin/env bash
set -Eeuo pipefail

LOG_FILE="/tmp/lack-install.log"
exec > >(tee -a "$LOG_FILE") 2>&1

CURRENT_STEP="Inizializzazione"

# Error trap printing the failing step and the last 30 log lines
trap 'catch_error $? $LINENO' ERR

catch_error() {
  local exit_code=$1
  local line_no=$2
  echo ""
  echo "======================================================================"
  echo "❌ ERRORE CRITICO DURANTE L'INSTALLAZIONE DI LACK (codice $exit_code alla riga $line_no)"
  echo "Fase interrotta: $CURRENT_STEP"
  echo "Ultime 30 righe di log da $LOG_FILE:"
  echo "----------------------------------------------------------------------"
  tail -n 30 "$LOG_FILE" 2>/dev/null || true
  echo "======================================================================"
  exit "$exit_code"
}

# Richiedi credenziali sudo all'inizio prima di qualsiasi UI
echo "Autenticazione amministratore richiesta per l'installazione di Lack in /opt/lack..."
sudo -v

# Mantieni vivo il token sudo in background per evitare timeout durante la build
( while true; do sudo -n true; sleep 45; kill -0 "$$" || exit; done 2>/dev/null ) &
SUDO_KEEPALIVE_PID=$!
trap 'kill $SUDO_KEEPALIVE_PID 2>/dev/null || true' EXIT

# Percorsi di installazione
DIST_DIR="$PWD/dist/linux-unpacked"
INSTALL_DIR="/opt/lack"
DESKTOP_FILE="$HOME/.local/share/applications/Lack.desktop"
BIN_DIR="/usr/local/bin"

CURRENT_STEP="Configurazione icone di sistema"
echo "[$CURRENT_STEP] Registrazione icone nei percorsi XDG..."
ICON_SOURCE="$PWD/build/lack.png"
mkdir -p "$HOME/.local/share/icons/hicolor/512x512/apps"
mkdir -p "$HOME/.local/share/icons/hicolor/256x256/apps"
mkdir -p "$HOME/.local/share/icons/hicolor/scalable/apps"
mkdir -p "$HOME/.local/share/pixmaps"

cp -f "$ICON_SOURCE" "$HOME/.local/share/icons/lack.png" 2>/dev/null || true
cp -f "$ICON_SOURCE" "$HOME/.local/share/icons/hicolor/512x512/apps/lack.png" 2>/dev/null || true
cp -f "$ICON_SOURCE" "$HOME/.local/share/icons/hicolor/256x256/apps/lack.png" 2>/dev/null || true
cp -f "$ICON_SOURCE" "$HOME/.local/share/icons/hicolor/scalable/apps/lack.png" 2>/dev/null || true
cp -f "$ICON_SOURCE" "$HOME/.local/share/pixmaps/lack.png" 2>/dev/null || true

CURRENT_STEP="Installazione dipendenze Node.js"
if [ ! -d "node_modules" ]; then
  echo "[$CURRENT_STEP] Esecuzione npm install..."
  npm install
else
  echo "[$CURRENT_STEP] node_modules presente, procedo."
fi

CURRENT_STEP="Build progetto (directory non pacchettizzata)"
echo "[$CURRENT_STEP] Compilazione bundle esbuild e packaging directory..."
rm -rf "$PWD/dist/linux-unpacked"
npm run build:dir

CURRENT_STEP="Copia file in $INSTALL_DIR"
echo "[$CURRENT_STEP] Installazione binari in $INSTALL_DIR..."
sudo mkdir -p "$INSTALL_DIR"
sudo rm -rf "${INSTALL_DIR:?}"/*
sudo cp -r "$DIST_DIR"/* "$INSTALL_DIR/"

# Configurazione sandbox Electron se presente
if [ -f "$INSTALL_DIR/chrome-sandbox" ]; then
  sudo chown root:root "$INSTALL_DIR/chrome-sandbox"
  sudo chmod 4755 "$INSTALL_DIR/chrome-sandbox"
fi

if [ -f "$INSTALL_DIR/Lack" ] && [ ! -f "$INSTALL_DIR/lack" ]; then
  sudo ln -sf "$INSTALL_DIR/Lack" "$INSTALL_DIR/lack"
fi
sudo chmod +x "$INSTALL_DIR/lack" 2>/dev/null || true
[ -f "$INSTALL_DIR/Lack" ] && sudo chmod +x "$INSTALL_DIR/Lack" 2>/dev/null || true

CURRENT_STEP="Compilazione eseguibile CLI wrapper lack.c"
echo "[$CURRENT_STEP] Compilazione gcc lack.c -> $BIN_DIR/lack..."
if gcc -O2 -o lack lack.c 2>/dev/null; then
  sudo cp -f lack "$BIN_DIR/lack"
  sudo chmod +x "$BIN_DIR/lack"
else
  echo "Compilatore gcc non disponibile o fallito. Creazione wrapper bash..."
  sudo tee "$BIN_DIR/lack" > /dev/null << 'EOF'
#!/usr/bin/env bash
export LACK_LAUNCHED_FROM=cli
export LACK_CWD="${LACK_CWD:-$PWD}"
nohup /opt/lack/lack "$@" >/dev/null 2>&1 &
EOF
  sudo chmod +x "$BIN_DIR/lack"
fi

CURRENT_STEP="Creazione lanciatore desktop XDG"
echo "[$CURRENT_STEP] Scrittura $DESKTOP_FILE..."
mkdir -p "$(dirname "$DESKTOP_FILE")"
cat <<EOF > "$DESKTOP_FILE"
[Desktop Entry]
Version=1.0
Name=Lack
GenericName=LaTeX Editor
Comment=Lack Professional LaTeX Editor & Suite
Exec=lack %F
Icon=lack
Terminal=false
Type=Application
Categories=Utility;TextEditor;Development;Science;Education;
MimeType=application/pdf;text/x-tex;application/x-tex;text/plain;
StartupWMClass=lack
EOF
chmod +x "$DESKTOP_FILE"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

CURRENT_STEP="Completamento"
echo ""
echo "======================================================================"
echo "🎉 LACK INSTALLATO CON SUCCESSO!"
echo "======================================================================"
echo "Binario principale:   /opt/lack/lack"
echo "Comando CLI globale:  /usr/local/bin/lack"
echo "Desktop launcher:     $DESKTOP_FILE"
echo ""
echo "Comandi utili da terminale:"
echo "  lack                     -> Schermata iniziale (Start screen)"
echo "  lack .                   -> Apri cartella corrente"
echo "  lack documento           -> Crea o apri progetto collegato documento.pdf"
echo "  lack file.tex            -> Apri file singolo"
echo "======================================================================"
