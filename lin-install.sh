#!/usr/bin/env bash

# Imposta variabili per i percorsi
DIST_DIR="$PWD/dist/linux-unpacked"
APPIMAGE_PATH="$DIST_DIR/lack"
INSTALL_DIR="/opt/lack"
DESKTOP_FILE="$HOME/.local/share/applications/Lack.desktop"
BIN_DIR="/usr/local/bin"

# Copia l'icona nella directory delle icone locali e nei temi standard XDG
ICON_SOURCE="$PWD/build/lack.png"
ICON_DEST="$HOME/.local/share/icons/lack.png"
mkdir -p "$HOME/.local/share/icons"
mkdir -p "$HOME/.local/share/icons/hicolor/512x512/apps"
mkdir -p "$HOME/.local/share/icons/hicolor/256x256/apps"
mkdir -p "$HOME/.local/share/icons/hicolor/scalable/apps"
mkdir -p "$HOME/.local/share/pixmaps"

cp "$ICON_SOURCE" "$ICON_DEST"
cp "$ICON_SOURCE" "$HOME/.local/share/icons/hicolor/512x512/apps/lack.png"
cp "$ICON_SOURCE" "$HOME/.local/share/icons/hicolor/256x256/apps/lack.png"
cp "$ICON_SOURCE" "$HOME/.local/share/icons/hicolor/scalable/apps/lack.png"
cp "$ICON_SOURCE" "$HOME/.local/share/pixmaps/lack.png"

# Funzione per barra di avanzamento testuale
progress_bar() {
  local progress=$1
  local total=$2
  local width=40
  local percent=$((progress * 100 / total))
  local filled=$((progress * width / total))
  local empty=$((width - filled))
  printf "["
  for ((i=0; i<filled; i++)); do printf "#"; done
  for ((i=0; i<empty; i++)); do printf "-"; done
  printf "] %d%%\r" "$percent"
}

steps=("Installazione dipendenze" "Build progetto" "Copia file" "Compilazione lack.c" "Installazione completata")
total=${#steps[@]}

clear

# Richiedi credenziali sudo all'inizio
sudo -v || { echo "Permessi sudo richiesti."; exit 1; }

for i in "${!steps[@]}"; do
  step=${steps[$i]}
  echo "$step..."
  progress_bar $((i+1)) $total
  case $step in
    "Installazione dipendenze")
      if [ ! -d "node_modules" ]; then
        if ! npm install; then
          echo "Errore durante l'installazione delle dipendenze (npm install)!"
          exit 1
        fi
      fi
      ;;
    "Build progetto")
      sudo rm -rf "$PWD/dist"
      if ! npm run build; then
        echo "Build standard fallita, riprovo con electron-builder --dir..."
        sudo rm -rf "$PWD/dist"
        if ! npx electron-builder --dir; then
          echo "Errore critico durante la build del progetto!"
          exit 1
        fi
      fi
      ;;
    "Copia file")
      if [ ! -d "$DIST_DIR" ]; then
        echo "Errore: cartella $DIST_DIR non trovata dopo la build!"
        exit 1
      fi
      sudo mkdir -p "$INSTALL_DIR"
      sudo rm -rf "$INSTALL_DIR"/*
      sudo cp -r "$DIST_DIR"/* "$INSTALL_DIR/"
      sudo chown root:root "$INSTALL_DIR/chrome-sandbox"
      sudo chmod 4755 "$INSTALL_DIR/chrome-sandbox"
      if [ -f "$INSTALL_DIR/Lack" ] && [ ! -f "$INSTALL_DIR/lack" ]; then
        sudo ln -sf "$INSTALL_DIR/Lack" "$INSTALL_DIR/lack"
      fi
      sudo chmod +x "$INSTALL_DIR/lack" 2>/dev/null || true
      [ -f "$INSTALL_DIR/Lack" ] && sudo chmod +x "$INSTALL_DIR/Lack" 2>/dev/null || true
      ;;
    "Compilazione lack.c")
      if gcc -O2 -o lack lack.c; then
        sudo cp lack "$BIN_DIR/lack"
        sudo chmod +x "$BIN_DIR/lack"
      else
        echo "Avviso: compilazione lack.c fallita. Creazione script wrapper di avvio..."
        sudo tee "$BIN_DIR/lack" > /dev/null << 'EOF'
#!/usr/bin/env bash
nohup /opt/lack/lack "$@" >/dev/null 2>&1 &
EOF
        sudo chmod +x "$BIN_DIR/lack"
      fi
      ;;
    "Installazione completata")
      echo "Lack è stato installato correttamente!"
      ;;
  esac
  sleep 0.5
  echo ""
done

cat <<EOF > "$DESKTOP_FILE"
[Desktop Entry]
Version=1.0
Name=Lack
GenericName=LaTeX Editor
Comment=Lack Professional LaTeX Editor & Suite
Exec=$INSTALL_DIR/lack %U
Icon=lack
Terminal=false
Type=Application
Categories=Utility;TextEditor;Development;Science;Education;
MimeType=text/x-tex;application/x-tex;text/x-latex;application/x-latex;text/plain;
StartupWMClass=lack
StartupNotify=true
Keywords=latex;tex;editor;overleaf;math;pdf;science;beamer;bibtex;
EOF
chmod +x "$DESKTOP_FILE"

rm -f "$HOME/.local/share/applications/lack.desktop"

update-desktop-database "$HOME/.local/share/applications/" 2>/dev/null || true
gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

echo "Puoi trovare Lack nel menu applicazioni o eseguirlo da terminale con 'lack' o 'lack documento.tex'"
