#!/bin/bash

# Funzione barra di avanzamento testuale
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

steps=("Aggiornamento Homebrew" "Installazione Node.js" "Installazione dipendenze" "Build app" "Creazione DMG" "Installazione completata")
total=${#steps[@]}

clear
for i in "${!steps[@]}"; do
  step=${steps[$i]}
  echo "$step..."
  progress_bar $((i+1)) $total
  sleep 1
  case $step in
    "Aggiornamento Homebrew")
      brew update > /dev/null 2>&1
      ;;
    "Installazione Node.js")
      if ! command -v node &> /dev/null; then
        brew install node > /dev/null 2>&1
      fi
      ;;
    "Installazione dipendenze")
      npm install > /dev/null 2>&1
      ;;
    "Build app")
      npm run build:bundle > /dev/null 2>&1
      ;;
    "Creazione DMG")
      npm run build:mac > /dev/null 2>&1
      if [ -d "dist/mac/Lack.app" ]; then
        cp -R "dist/mac/Lack.app" /Applications/ 2>/dev/null || true
      elif [ -d "dist/mac-arm64/Lack.app" ]; then
        cp -R "dist/mac-arm64/Lack.app" /Applications/ 2>/dev/null || true
      fi
      ;;
    "Installazione completata")
      echo "Lack è stato installato correttamente!"
      echo "Configurazione comando 'lack' globale per il terminale..."
      sudo tee /usr/local/bin/lack > /dev/null << 'EOF'
#!/bin/bash
open -a "/Applications/Lack.app" "$@"
EOF
      sudo chmod +x /usr/local/bin/lack
      ;;
  esac
  sleep 0.5
  echo ""
done

echo "Trovi Lack nella cartella Applicazioni o puoi avviarlo da terminale con 'lack nomefile.tex'."
