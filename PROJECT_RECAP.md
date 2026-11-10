# LACK - LaTeX Desktop Editor & Suite
> **Documento di Riepilogo Completo del Progetto**  
> *Da utilizzare come prompt iniziale o contesto per una nuova chat.*

---

## 1. Visione e Obiettivo del Progetto

**LACK** è un editor desktop nativo e open-source per **LaTeX**, sviluppato su piattaforma **Electron**.

### Relazione con "Mark"
LACK nasce come gemello e compagno di suite di **Mark** (l'editor Markdown situato in `/home/sgabelli/github/mark`):
- **Identità Visiva e UX Unificata:** Condivide lo stesso identico design system, i medesimi colori di sistema (incluso il colore d'accento firma viola `#80007f`), la struttura a tre sezioni (Explorer laterale, Editor centrale, Anteprima destra), la gestione delle schede (Tabs), la barra superiore frameless con controlli finestra nativi (Ubuntu GNOME circolare, macOS traffic lights, Windows 10/11), le modali delle impostazioni e la galleria template.
- **Suite Coordinate:** Mark gestisce i documenti Markdown; Lack gestisce i documenti scientifici, tesi, articoli e presentazioni in LaTeX.

### La Filosofia "Overleaf Desktop Senza Limiti"
L'obiettivo di Lack è offrire tutte le funzionalità avanzate che caratterizzano la versione **Pro di Overleaf** e i migliori ambienti TeX (TeXstudio, VS Code LaTeX Workshop), ma in forma di **applicazione desktop libera**:
- **Compilazioni illimitate:** Nessun timeout, nessun limite di secondi o di crediti di calcolo.
- **Collaborazione Real-Time Gratuita:** Editing collaborativo multi-utente simultaneo tramite tecnologia **P2P WebRTC**, senza server proprietari a pagamento o limiti al numero di partecipanti.
- **Orchestrazione Multi-Motore Locale + Motore Built-In:** Supporto nativo ai compilatori TeX installati nel sistema con fallback istantaneo su un motore visivo integrato (KaTeX).

---

## 2. Tutte le Funzionalità Implementate ("Cosa C'è")

### 2.1 Orchestrazione Compilatori TeX
- **Riconoscimento Automatico Motori Locali:** Trova ed esegue automaticamente `pdflatex`, `xelatex`, `lualatex`, `tectonic` e `latexmk` dai percorsi di sistema (Linux PATH, TeX Live 2024/2025/2026, MacTeX, MiKTeX su Windows).
- **Motore Interno "Built-in":** Se sulla macchina dell'utente non è installato alcun compilatore TeX (che spesso richiede svariati gigabyte), Lack non si blocca: attiva un motore interno ad alta velocità basato su KaTeX e un parser AST LaTeX custom. Renderizza istantaneamente formule, sezioni, titoli, formattazione, tabelle, figure e liste in HTML visualizzabile subito.
- **Pulizia File Ausiliari (`Clean Aux`):** Opzione e comando da menu per eliminare i file temporanei generati da TeX (`.aux`, `.log`, `.out`, `.toc`, `.nav`, `.snm`, `.synctex.gz`).

### 2.2 Interfaccia Utente e Workspace (Overleaf + Mark Style)
- **Tasto "Compila" Overleaf-Style:**
  - Posizionato esattamente sul bordo divisorio tra il codice sorgente ("il non compilato") e l'anteprima PDF ("il compilato").
  - Colorato con il **viola firma di Mark (`#80007f`)**, con hover dinamico (`#990099`), stato attivo durante la compilazione (`#660066`) e dot di stato live (viola pronto, giallo compilazione in corso, verde successo, rosso errore).
- **Drawer dei Log e Segnalazione Errori:**
  - Pannello a comparsa dal basso stile Overleaf (apribile con `Ctrl+Shift+U` o cliccando sul badge errori).
  - Scheda "Errori e Avvisi": estrae dal log TeX ogni singolo errore, indicando file e numero di riga.
  - **Jump to Line:** Cliccando su un errore nel drawer, l'editor salta automaticamente alla riga corrispondente evidenziando il codice errato.
  - Scheda "Log Raw TeX": visualizzazione del testo completo del log per utenti avanzati.
- **Viewer PDF e Anteprima Integrata:**
  - Visualizzatore PDF nativo con iframe e supporto allo zoom progressivo (`40%` - `300%`), adatta alla larghezza (`↔`) e adatta alla pagina (`↕`).
  - Navigazione rapida tra le pagine (`← Pag. [ 1 ] di 1 →`).
  - Tasto di download diretto del file PDF compilato nella cartella desiderata dall'utente.
  - Tasto refresh per ricompilare al volo.
  - Placeholder elegante quando nessun documento è ancora stato compilato.
- **Editor di Codice con Gutter dei Numeri di Riga:**
  - Numeri di riga dedicati allineati al millimetro con la linea di testo (stesso font monospace `13.5px`, line-height identica a `22px`, padding-top identico a `12px`).
  - Sincronizzazione automatica dello scroll tra numeri di riga e textarea.
  - Evidenziazione visiva in rosso dei numeri di riga contenenti errori di compilazione TeX.
  - Contatori in tempo reale nella status bar: cursore `Ln X, Col Y`, conteggio parole `parole: N`, indicatore file modificato (`dirty dot` sul tab).
- **File Explorer ad Albero:**
  - Barra laterale con supporto a cartelle di progetto e file multipli (`.tex`, `.bib`, `.sty`, `.cls`).
  - Pulsanti rapidi di creazione nuovo file (con popup scelta template), creazione cartella, apertura cartella di progetto, refresh albero e compressione cartelle.
  - Separatore ridimensionabile (`#explorer-resizer`) con trascinamento fluido del mouse.
- **Toolbar LaTeX con Inserimento Rapido:**
  - Sezioni: dropdown per `\section`, `\subsection`, `\subsubsection`, `\paragraph`.
  - Formattazione testo: Grassetto (`\textbf`), Corsivo (`\textit`), Sottolineato (`\underline`), Monospace (`\texttt`).
  - Formule matematiche: Inline (`$x$`), Display (`\[ ... \]`), Frazioni (`\frac{num}{den}`), Radici quadrate (`\sqrt`).
  - Tavolozza lettere greche complete ($\alpha, \beta, \gamma, \delta, \epsilon, \theta, \lambda, \mu, \pi, \sigma, \tau, \omega, \Delta, \Sigma, \Omega, \infty$).
  - Ambienti avanzati: Inserimento figure con `\includegraphics`, tabelle `tabular`, equazioni numerate `equation` e allineate `align`, liste puntate `itemize` e numerate `enumerate`, citazioni bibliografiche `\cite` e riferimenti incrociati `\ref`.
- **Autocompletamento Fuzzy per Comandi LaTeX (`\xxx`):**
  - Popover automatico non appena l'utente digita il carattere `\`.
  - Database integrato di decine di comandi e macro TeX/LaTeX con documentazione in italiano e snippet di espansione. Navigabile con frecce `↑`/`↓` e selezione con `Enter` o `Tab`.
- **Collaborazione Real-Time P2P:**
  - Generazione ID stanza casuale o connessione a stanza esistente.
  - Sincronizzazione remota basata su WebRTC e CRDT Yjs: non necessita di account o pagamenti mensili.
- **Galleria Template:**
  - Template predefiniti integrati: *Documento Standard*, *Articolo Scientifico (AMS)*, *Tesi di Laurea Triennale/Magistrale*, *Presentazione Slide Beamer*, *Curriculum Vitae (ModernCV)*, *Foglio Esercizi/Esame*.
  - Funzione "Salva come Template Personale" per salvare configurazioni ricorrenti.
- **Modalità di Visualizzazione (View Modes):**
  - *Vista Divisa (`>|<`):* 50% editor e 50% PDF affiancati.
  - *Solo Editor (`<`):* editor espanso centralmente, anteprima nascosta.
  - *Solo Anteprima (`>`):* PDF espanso a schermo intero.
- **Temi e Controlli Finestra:**
  - 3 Temi: Scuro (Dark default), Chiaro (Light), GitHub Dark.
  - Stili controlli finestra selezionabili: Ubuntu GNOME (bottoni tondi con chiusura arancione), macOS (traffic lights colorati), Windows (pulsanti rettangolari compatti).
  - Internazionalizzazione dinamica (Italiano ed Inglese).

---

## 3. Struttura dei File del Progetto

```
/home/sgabelli/github/lack/
├── main.js                 # Processo principale Electron (finestre, IPC, menu nativo, auto-updater)
├── renderer.js             # Processo di rendering (UI, editor, tabs, explorer, compilazione, sync scroll)
├── index.html              # Struttura DOM dell'applicazione completa
├── style.css               # Foglio di stile CSS unificato (palette viola #80007f, temi, layout, animazioni)
├── latex-compiler.js       # Orchestratore motori TeX esterni + motore built-in KaTeX + log parser
├── latex-autocomplete.js   # Motore fuzzy autocompletamento macro TeX \xxx
├── collaboration.js        # Modulo WebRTC peer-to-peer per collaborazione real-time
├── templates.js            # Raccolta template pronti (Articolo, Tesi, Beamer, CV, etc.)
├── i18n.js                 # Dizionario bilingue per localizzazione completa (IT / EN)
├── lack.c                  # Wrapper launcher nativo C Linux (forka in background liberando il terminale)
├── lin-install.sh          # Script di installazione automatica e configurazione su Ubuntu/Debian
├── mac-install.sh          # Script di installazione per macOS
├── win-install.bat         # Script di installazione per Windows
├── package.json            # Configurazione npm, dipendenze ed electron-builder
├── logo_Lack.png           # Logo master originale ad alta risoluzione fornito dall'utente
├── images/
│   ├── lack.png            # Squircle 2000x2000 con angoli trasparenti smooth
│   ├── logo_dark.png       # Wordmark LACK per tema scuro
│   └── logo_white.png      # Wordmark LACK per tema chiaro
├── build/
│   ├── lack.png            # Icona Linux standard
│   ├── lack.ico            # Icona Windows multi-risoluzione (16, 24, 32, 48, 64, 128, 256)
│   └── lack.icns           # Icona macOS
└── dist/
    └── linux-unpacked/     # Build pacchettizzata pronta all'uso per Linux
```

---

## 4. Cronologia dei Bug Critici Identificati e Risolti

1. **Bug dell'Interfaccia Totalmente Bloccata / Non Cliccabile:**
   - *Causa:* In `index.html` erano presenti due tag `<script>` ridondanti per `latex-compiler.js` e `latex-autocomplete.js`. Poiché tali file e `renderer.js` contenevano entrambi `const fs = require('fs');` nello scope lessicale globale, Electron generava un `Uncaught SyntaxError: Identifier 'fs' has already been declared`. Questo interrompeva `renderer.js` alla riga 1, impedendo la registrazione di ogni singolo gestore eventi (pulsanti chiusura, compila, explorer, toolbar, tabs).
   - *Risoluzione:* Rimossi i tag `<script>` duplicati in `index.html`. Ora i moduli sono caricati esclusivamente via `require()` all'interno di `renderer.js`. La console si avvia con **0 errori**.

2. **Bug del Box Nero nell'Anteprima e Barre di Scorrimento Anomale:**
   - *Causa:* Regole in `style.css` copiate da Mark puntavano a `#editor-container, #preview`. In Lack, le due colonne della vista split sono `#editor-container` e `#preview-container`, mentre `#preview` è un elemento interno al viewport PDF. La regola forzava `#preview` ad avere `display: block !important; flex: 1 1 50%; padding-bottom: 80vh !important;`, mostrandolo come un enorme blocco nero accanto al placeholder del PDF e causando scrollbar orizzontali e verticali.
   - *Risoluzione:* Aggiornate le animazioni delle view mode per agire su `#preview-container`. Aggiunto `display: none !important;` per `#preview.hidden`, permettendo all'anteprima (o al placeholder quando vuoto) di occupare con precisione il 100% dell'area destra.

3. **Bug dell'Overflow della Toolbar PDF:**
   - *Causa:* Troppi elementi stipati in tre gruppi flessibili causavano il wrap di `Pag.` sopra `1 di 1` e sforavano dai bordi.
   - *Risoluzione:* Toolbar riorganizzata in due soli gruppi con `white-space: nowrap;` e layout compatto Overleaf-style. Il pulsante Log è stato dotato di icona e testo ("Log"), mentre la paginazione e lo zoom sono bloccati orizzontalmente.

4. **Bug dell'Allineamento Cursore e Numeri di Riga:**
   - *Causa:* Il gutter dei numeri di riga aveva font size e padding diversi rispetto alla textarea dell'editor.
   - *Risoluzione:* Parametri unificati: font `var(--code-font-family)`, dimensione `13.5px`, line-height `22px` e padding superiore `12px`. Il cursore è allineato al millimetro sulla riga 1 e segue lo scroll in perfetto blocco.

5. **Riposizionamento Notifiche:**
   - Le notifiche toast a comparsa sono state spostate in basso a destra (`bottom: 24px; right: 20px;`) con ordine `column-reverse`, evitando di coprire la toolbar PDF o il tasto di compilazione in alto.

6. **Aggiornamento Icone e Logo:**
   - Estratto e ritagliato il nuovo logo utente da `logo_Lack.png`, convertendolo in squircle con angoli arrotondati trasparenti anti-aliased e generando tutti i formati iconici per Linux, Windows (.ico) e macOS (.icns).

---

## 5. Come Avviare, Testare e Installare

### Avvio in Sviluppo (senza installazione di sistema):
```bash
cd /home/sgabelli/github/lack
npm start
```
*(Se eseguito in ambiente sandbox Linux senza privilegi speciali, avviare con: `./dist/linux-unpacked/lack --no-sandbox`)*

### Installazione di Sistema su Ubuntu / Debian:
Lo script [lin-install.sh](file:///home/sgabelli/github/lack/lin-install.sh) si occupa di:
1. Verificare le dipendenze npm
2. Eseguire la build completa con `electron-builder --dir`
3. Copiare i file in `/opt/lack`
4. Configurare `chrome-sandbox` con permessi `4755` e proprietario `root:root`
5. Compilare il wrapper [lack.c](file:///home/sgabelli/github/lack/lack.c) in `/usr/local/bin/lack`
6. Registrare l'icona e creare il file `.desktop` in `~/.local/share/applications/` per integrarsi con il menu delle app di GNOME / Ubuntu.

Esecuzione:
```bash
cd /home/sgabelli/github/lack
./lin-install.sh
```
Una volta installato, Lack può essere lanciato digitando semplicemente `lack` da terminale oppure aprendo l'app dal menu di sistema di Ubuntu.
