// ====== LACK i18n MODULE ======
const translations = {
  en: {
    // App & Navbar
    app_title: "Lack",
    app_subtitle: "LaTeX Editor",
    toggle_explorer: "Toggle Explorer",
    compile_btn: "Compile",
    compiling: "Compiling...",
    compile_success: "Compiled successfully",
    compile_error: "Compilation failed",
    auto_compile: "Auto-compile",
    title_btn: "Section",
    title_1: "Section (\\section)",
    title_2: "Subsection (\\subsection)",
    title_3: "Subsubsection (\\subsubsection)",
    title_paragraph: "Paragraph (\\paragraph)",
    bold: "Bold (\\textbf)",
    italic: "Italic (\\textit)",
    underline: "Underline (\\underline)",
    code: "Teletype (\\texttt)",
    math_inline: "Inline Math ($...$)",
    math_display: "Display Math (\\[...\\])",
    fraction: "Fraction (\\frac)",
    sqrt: "Square Root (\\sqrt)",
    greek_symbols: "Greek Symbols",
    environments: "Environments",
    extra: "LaTeX Tools",
    link: "Insert Hyperlink (\\href)",
    image: "Insert Figure (\\includegraphics)",
    table: "Insert Table (tabular)",
    bullet_list: "Bullet List (itemize)",
    numeric_list: "Numbered List (enumerate)",
    quote: "Quote / Quotation",
    citation: "Citation (\\cite)",
    reference: "Cross Reference (\\ref)",
    label: "Insert Label (\\label)",
    collaborate: "Collaborate",
    view_editor: "Editor Only",
    view_split: "Split View",
    view_preview: "PDF Preview Only",
    win_minimize: "Minimize",
    win_maximize: "Maximize",
    win_restore: "Restore",
    win_close: "Close",

    // Logs & Issues
    logs_title: "Logs and Issues",
    logs_errors: "Errors",
    logs_warnings: "Warnings",
    logs_raw: "Raw TeX Log",
    logs_clear: "Clear",
    logs_no_issues: "No errors or warnings found.",
    logs_jump_to_line: "Jump to line {line}",

    // Search
    search_placeholder: "Search in LaTeX...",
    search_button: "Search",
    search_prev: "Previous",
    search_next: "Next",
    search_close: "Close",

    // Explorer
    explorer_title: "Explorer",
    new_file: "New file",
    new_folder: "New folder",
    open_folder: "Open folder",
    refresh: "Refresh",
    close_explorer: "Close Explorer",
    collapse_folders: "Collapse all folders",
    set_as_main: "Set as Main Document",

    // Editor & Preview
    editor_placeholder: "% Start writing your LaTeX document here...\n\\documentclass{article}\n\\begin{document}\n\n\\end{document}",
    reading_mode_exit: "Press ESC to exit Fullscreen Preview",
    pdf_page: "Page",
    pdf_of: "of",
    pdf_zoom_in: "Zoom In",
    pdf_zoom_out: "Zoom Out",
    pdf_fit_width: "Fit to Width",
    pdf_fit_page: "Fit to Page",
    pdf_download: "Download PDF",
    pdf_print: "Print PDF",
    pdf_refresh: "Recompile and Refresh",

    // Footer
    settings: "Settings",
    word_count: "words: {count}",
    char_count: "chars: {count}",
    line_col: "Ln {line}, Col {col}",
    main_doc: "Main: {name}",
    compiler_engine: "Engine: {engine}",
    status_online: "Online",
    status_offline: "Offline",

    // Settings Modal
    settings_title: "Settings",
    settings_cat_appearance: "Appearance",
    settings_cat_editor: "Editor",
    settings_cat_compiler: "LaTeX & Compiler",
    settings_cat_export: "Export",
    settings_cat_shortcuts: "Shortcuts",

    settings_desc_appearance: "Customize the look and feel of Lack",
    settings_desc_editor: "Configure code editor preferences and behaviors",
    settings_desc_compiler: "Configure TeX engine, compilation flags, and build directory",
    settings_desc_export: "PDF output settings and viewer preferences",
    settings_desc_shortcuts: "Keyboard shortcuts for quick access to actions",

    settings_theme: "Theme",
    settings_theme_desc: "Switch between Light, Dark, and GitHub interface themes",
    settings_language: "Language",
    settings_language_desc: "Select the display language for the application",
    settings_font_size: "Font Size",
    settings_font_size_desc: "Text size for the editor in pixels",
    settings_zoom: "Zoom",
    settings_zoom_desc: "Scale entire editor, preview, and interface",
    settings_zoom_reset: "Reset",
    settings_window_controls: "Window Controls Style",
    settings_window_controls_desc: "Choose the style of titlebar window buttons",
    settings_tab_size: "Tab Indentation Size",
    settings_tab_size_desc: "Number of spaces inserted for tab indentation",

    settings_autosave: "Autosave",
    settings_autosave_desc: "Automatically save changes to the current file while typing",
    settings_autocompile: "Auto-compile",
    settings_autocompile_desc: "Automatically recompile document on changes or save",
    settings_autoscroll: "SyncTeX Scroll",
    settings_autoscroll_desc: "Synchronize preview position with the editor cursor",
    settings_autocomplete: "LaTeX Autocomplete",
    settings_autocomplete_desc: "Show command suggestions when typing \\",
    settings_line_numbers: "Line Numbers",
    settings_line_numbers_desc: "Show line numbers in the editor margin",

    settings_engine: "TeX Engine",
    settings_engine_desc: "Compiler engine used to build LaTeX documents",
    settings_custom_engine_path: "Custom Compiler Path",
    settings_custom_engine_path_desc: "Path to pdflatex, xelatex, lualatex or tectonic binary",
    settings_build_dir: "Build Output Directory",
    settings_build_dir_desc: "Folder where auxiliary and PDF files are generated",
    settings_clean_aux: "Clean Auxiliary Files",
    settings_clean_aux_desc: "Delete .aux, .log, .out, .toc files after successful compile",

    // Collaboration
    collab_title: "Collaborate",
    collab_tab_create: "Create",
    collab_tab_join: "Join",
    collab_session_code: "Session code",
    collab_copy_code: "Copy code",
    collab_new_code: "New code",
    collab_start_session: "Start session",
    collab_join_session: "Join session",
    collab_enter_code_placeholder: "lack-xxxxxx",
    collab_session_active: "Active session",
    collab_participants: "Connected participants",
    collab_leave_session: "End session",

    // Template Gallery
    template_gallery_title: "Template Gallery",
    template_gallery_subtitle: "Choose a professional LaTeX template to start writing immediately",
    template_search_placeholder: "Search templates by title, description, or tags...",
    template_save_current_btn: "Save current file as template",
    template_all: "All Templates",
    template_official: "Built-in Templates",
    template_my_templates: "My Templates",
    template_section_views: "Views",
    template_section_categories: "Categories",
    template_use_this: "Use this template",
    template_preview_rendered: "Preview",
    template_preview_source: "LaTeX Source",
    template_blank: "Blank LaTeX Document",
    template_blank_desc: "Empty clean document with basic article structure",
    template_popup_header: "New File",
    template_popup_predefined: "Predefined Templates",
    template_browse_all: "Browse all templates...",
    template_save_modal_title: "Save as Template",
    template_field_title: "Template Name",
    template_field_category: "Category",
    template_field_desc: "Short Description",

    // Dialogs & Notifications
    confirm: "Confirm",
    cancel: "Cancel",
    save: "Save",
    save_changes_title: "Unsaved Changes",
    save_changes_message: "Do you want to save changes to \"{name}\" before closing?",
    save_dont_save: "Don't Save",
    notif_saved: "File saved successfully",
    notif_session_started: "Collaboration session started! Room: {room}",
    notif_session_joined: "Joined collaboration session: {room}",
    notif_session_ended: "Collaboration session ended",
    notif_copied: "Copied to clipboard!",
    notif_compiled_ok: "LaTeX compiled successfully in {time}s",
    notif_compiled_fail: "LaTeX compilation failed with errors",

    // Empty state
    empty_subtitle: "LaTeX Document Editor & Suite",
    empty_create_file: "New LaTeX Document",
    empty_open_file: "Open File",
    empty_open_folder: "Open Project Folder",
    empty_templates: "Browse Templates"
  },

  it: {
    // App & Navbar
    app_title: "Lack",
    app_subtitle: "Editor LaTeX",
    toggle_explorer: "Mostra/Nascondi Explorer",
    compile_btn: "Compila",
    compiling: "Compilazione in corso...",
    compile_success: "Compilato con successo",
    compile_error: "Errore di compilazione",
    auto_compile: "Auto-compilazione",
    title_btn: "Sezione",
    title_1: "Sezione (\\section)",
    title_2: "Sottosezione (\\subsection)",
    title_3: "Sotto-sottosezione (\\subsubsection)",
    title_paragraph: "Paragrafo (\\paragraph)",
    bold: "Grassetto (\\textbf)",
    italic: "Corsivo (\\textit)",
    underline: "Sottolineato (\\underline)",
    code: "Monospazio (\\texttt)",
    math_inline: "Matematica in linea ($...$)",
    math_display: "Matematica in blocco (\\[...\\])",
    fraction: "Frazione (\\frac)",
    sqrt: "Radice quadrata (\\sqrt)",
    greek_symbols: "Simboli Greci",
    environments: "Ambienti",
    extra: "Strumenti LaTeX",
    link: "Inserisci Collegamento (\\href)",
    image: "Inserisci Figura (\\includegraphics)",
    table: "Inserisci Tabella (tabular)",
    bullet_list: "Elenco puntato (itemize)",
    numeric_list: "Elenco numerato (enumerate)",
    quote: "Citazione / Blocco quote",
    citation: "Citazione bibliografica (\\cite)",
    reference: "Riferimento incrociato (\\ref)",
    label: "Inserisci Etichetta (\\label)",
    collaborate: "Collabora",
    view_editor: "Solo Editor",
    view_split: "Vista Divisa",
    view_preview: "Solo Anteprima PDF",
    win_minimize: "Riduci a icona",
    win_maximize: "Ingrandisci",
    win_restore: "Ripristina",
    win_close: "Chiudi",

    // Logs & Issues
    logs_title: "Log ed Errori",
    logs_errors: "Errori",
    logs_warnings: "Avvisi",
    logs_raw: "Log TeX Completo",
    logs_clear: "Pulisci",
    logs_no_issues: "Nessun errore o avviso trovato.",
    logs_jump_to_line: "Vai alla riga {line}",

    // Search
    search_placeholder: "Cerca nel documento LaTeX...",
    search_button: "Cerca",
    search_prev: "Precedente",
    search_next: "Successivo",
    search_close: "Chiudi",

    // Explorer
    explorer_title: "Explorer",
    new_file: "Nuovo file",
    new_folder: "Nuova cartella",
    open_folder: "Apri cartella",
    refresh: "Aggiorna",
    close_explorer: "Chiudi Explorer",
    collapse_folders: "Comprimi tutte le cartelle",
    set_as_main: "Imposta come Documento Principale",

    // Editor & Preview
    editor_placeholder: "% Inizia a scrivere il tuo documento LaTeX qui...\n\\documentclass{article}\n\\begin{document}\n\n\\end{document}",
    reading_mode_exit: "Premi ESC per uscire dall'anteprima a schermo intero",
    pdf_page: "Pagina",
    pdf_of: "di",
    pdf_zoom_in: "Ingrandisci",
    pdf_zoom_out: "Riduci",
    pdf_fit_width: "Adatta alla larghezza",
    pdf_fit_page: "Adatta alla pagina",
    pdf_download: "Scarica PDF",
    pdf_print: "Stampa PDF",
    pdf_refresh: "Ricompila e Aggiorna",

    // Footer
    settings: "Impostazioni",
    word_count: "parole: {count}",
    char_count: "caratteri: {count}",
    line_col: "Ln {line}, Col {col}",
    main_doc: "Principale: {name}",
    compiler_engine: "Motore: {engine}",
    status_online: "Online",
    status_offline: "Offline",

    // Settings Modal
    settings_title: "Impostazioni",
    settings_cat_appearance: "Aspetto",
    settings_cat_editor: "Editor",
    settings_cat_compiler: "LaTeX & Compilatore",
    settings_cat_export: "Esportazione",
    settings_cat_shortcuts: "Scorciatoie",

    settings_desc_appearance: "Personalizza l'aspetto grafico di Lack",
    settings_desc_editor: "Configura preferenze e comportamenti dell'editor",
    settings_desc_compiler: "Configura motore TeX, parametri di compilazione e cartella di output",
    settings_desc_export: "Impostazioni del file PDF e preferenze del visualizzatore",
    settings_desc_shortcuts: "Scorciatoie da tastiera per un accesso rapido",

    settings_theme: "Tema",
    settings_theme_desc: "Passa tra i temi Chiaro, Scuro e GitHub",
    settings_language: "Lingua",
    settings_language_desc: "Seleziona la lingua dell'interfaccia",
    settings_font_size: "Dimensione Carattere",
    settings_font_size_desc: "Dimensione del testo dell'editor in pixel",
    settings_zoom: "Zoom",
    settings_zoom_desc: "Scala l'intera interfaccia, editor e anteprima",
    settings_zoom_reset: "Ripristina",
    settings_window_controls: "Stile Controlli Finestra",
    settings_window_controls_desc: "Scegli lo stile dei pulsanti della barra del titolo",
    settings_tab_size: "Dimensione Tabulazione",
    settings_tab_size_desc: "Numero di spazi inseriti con il tasto Tab",

    settings_autosave: "Salvataggio Automatico",
    settings_autosave_desc: "Salva automaticamente le modifiche durante la digitazione",
    settings_autocompile: "Compilazione Automatica",
    settings_autocompile_desc: "Ricompila automaticamente il documento al salvataggio o modifica",
    settings_autoscroll: "Sincronizzazione SyncTeX",
    settings_autoscroll_desc: "Sincronizza la posizione dell'anteprima PDF con il cursore dell'editor",
    settings_autocomplete: "Autocompletamento LaTeX",
    settings_autocomplete_desc: "Mostra suggerimenti per i comandi digitando \\",
    settings_line_numbers: "Numeri di Riga",
    settings_line_numbers_desc: "Mostra i numeri di riga nel margine dell'editor",

    settings_engine: "Motore TeX",
    settings_engine_desc: "Compilatore usato per generare i documenti (pdflatex, xelatex, tectonic...)",
    settings_custom_engine_path: "Percorso Personalizzato Compilatore",
    settings_custom_engine_path_desc: "Percorso assoluto al binario di pdflatex, xelatex o tectonic",
    settings_build_dir: "Cartella File Temporanei",
    settings_build_dir_desc: "Cartella dove generare file ausiliari e il PDF finale",
    settings_clean_aux: "Pulisci File Ausiliari",
    settings_clean_aux_desc: "Elimina file intermedi (.aux, .log, .out, .toc) dopo la compilazione",

    // Collaboration
    collab_title: "Collabora",
    collab_tab_create: "Crea",
    collab_tab_join: "Unisciti",
    collab_session_code: "Codice sessione",
    collab_copy_code: "Copia codice",
    collab_new_code: "Nuovo codice",
    collab_start_session: "Avvia sessione",
    collab_join_session: "Partecipa alla sessione",
    collab_enter_code_placeholder: "lack-xxxxxx",
    collab_session_active: "Sessione attiva",
    collab_participants: "Partecipanti connessi",
    collab_leave_session: "Termina sessione",

    // Template Gallery
    template_gallery_title: "Galleria Template",
    template_gallery_subtitle: "Scegli un template professionale LaTeX per iniziare subito a scrivere",
    template_search_placeholder: "Cerca template per titolo, descrizione o tag...",
    template_save_current_btn: "Salva file corrente come template",
    template_all: "Tutti i template",
    template_official: "Predefiniti",
    template_my_templates: "I miei template",
    template_section_views: "Viste",
    template_section_categories: "Categorie",
    template_use_this: "Usa questo template",
    template_preview_rendered: "Anteprima",
    template_preview_source: "Sorgente LaTeX",
    template_blank: "Documento LaTeX Vuoto",
    template_blank_desc: "Struttura pulita con impostazione base article",
    template_popup_header: "Nuovo File",
    template_popup_predefined: "Template Predefiniti",
    template_browse_all: "Sfoglia tutti i template...",
    template_save_modal_title: "Salva come Template",
    template_field_title: "Nome Template",
    template_field_category: "Categoria",
    template_field_desc: "Descrizione Breve",

    // Dialogs & Notifications
    confirm: "Conferma",
    cancel: "Annulla",
    save: "Salva",
    save_changes_title: "Modifiche non salvate",
    save_changes_message: "Vuoi salvare le modifiche a \"{name}\" prima di chiudere?",
    save_dont_save: "Non salvare",
    notif_saved: "File salvato correttamente",
    notif_session_started: "Sessione collaborativa avviata! Stanza: {room}",
    notif_session_joined: "Ti sei unito alla sessione: {room}",
    notif_session_ended: "Sessione collaborativa terminata",
    notif_copied: "Copiato negli appunti!",
    notif_compiled_ok: "LaTeX compilato con successo in {time}s",
    notif_compiled_fail: "Compilazione LaTeX fallita con errori",

    // Empty state
    empty_subtitle: "Editor e Suite Documentale LaTeX",
    empty_create_file: "Nuovo Documento LaTeX",
    empty_open_file: "Apri File",
    empty_open_folder: "Apri Cartella Progetto",
    empty_templates: "Sfoglia Template"
  }
};

let currentLang = 'it'; // Default Italian as requested by user

function setLanguage(lang) {
  if (translations[lang]) {
    currentLang = lang;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('lack.lang', lang);
    }
  }
}

function getLanguage() {
  return currentLang;
}

function t(key, params = {}) {
  const dict = translations[currentLang] || translations.en;
  let val = dict[key] || translations.en[key] || key;
  if (typeof val === 'string' && params) {
    Object.keys(params).forEach(k => {
      val = val.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]);
    });
  }
  return val;
}

if (typeof module !== 'undefined') {
  module.exports = {
    setLanguage,
    getLanguage,
    t,
    translations
  };
}
