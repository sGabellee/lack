const { StateField, StateEffect, Annotation } = require('@codemirror/state');
const { Decoration, EditorView } = require('@codemirror/view');
const { linter } = require('@codemirror/lint');
const { lintLatexDocument } = require('./linter-logic');
const path = require('path');

const tabSwitchAnnotation = Annotation.define();
const setCompilerIssuesEffect = StateEffect.define();
const setExtraHighlightEffect = StateEffect.define();

const errorLineDeco = Decoration.line({
  class: 'cm-lint-error-line'
});

function doesIssueMatchFile(iss, activeFilePath) {
  if (!iss || (!iss.file && !iss.rawFile) || !activeFilePath) return true;
  const norm = (p) => path.basename(String(p)).replace(/\.tex$/i, '').toLowerCase();
  const activeBase = norm(activeFilePath);
  const issueBase = norm(iss.rawFile || iss.file);
  if (!activeBase || !issueBase) return true;
  return activeBase === issueBase;
}

/** Resolve a compiler issue's anchor span `[from, to]` against a CodeMirror Text document. */
function resolveCompilerIssueRange(doc, iss) {
  if (!doc || !iss || (iss.type !== 'error' && iss.type !== 'warning')) return null;
  const lineNum = Number(iss.line);
  if (!lineNum || lineNum < 1 || lineNum > doc.lines) return null;

  const line = doc.line(lineNum);
  const lineText = line.text;
  let from = line.from;
  let to = line.to;
  let origToken = null;

  if (iss.command) {
    const cleanCmd = iss.command.startsWith('\\') ? iss.command : `\\${iss.command}`;
    const idx = lineText.indexOf(cleanCmd);
    if (idx !== -1) {
      from = line.from + idx;
      to = from + cleanCmd.length;
      origToken = cleanCmd;
    }
  } else {
    // Prefer the first LaTeX control sequence on the line so deletions/edits track the token
    const cmdMatch = lineText.match(/\\[a-zA-Z@]+/);
    if (cmdMatch) {
      from = line.from + cmdMatch.index;
      to = from + cmdMatch[0].length;
      origToken = cmdMatch[0];
    } else {
      const trimmed = lineText.trim();
      if (trimmed.length > 0) {
        const start = lineText.indexOf(trimmed);
        from = line.from + start;
        to = from + trimmed.length;
        origToken = trimmed;
      }
    }
  }

  from = Math.max(0, Math.min(from, doc.length));
  to = Math.max(from, Math.min(to, doc.length));
  return {
    from,
    to,
    line: line.number,
    nonEmpty: to > from,
    origToken
  };
}

/** Map a single tracked `[from, to]` range through a CodeMirror ChangeSet. */
function mapTrackedEntry(entry, changes, newDoc, isUndo = false) {
  const docLen = newDoc.length;

  if (entry.deleted) {
    const undoStart = Math.max(0, Math.min(changes.mapPos(entry.anchor, -1), docLen));
    const undoEnd = Math.max(undoStart, Math.min(changes.mapPos(entry.anchor, 1), docLen));
    if (isUndo && entry.origToken && undoEnd > undoStart) {
      const firstLine = newDoc.lineAt(undoStart).number;
      const lastLine = newDoc.lineAt(undoEnd).number;
      for (let ln = firstLine; ln <= lastLine; ln++) {
        const line = newDoc.line(ln);
        const idx = line.text.indexOf(entry.origToken);
        if (idx !== -1) {
          const from = line.from + idx;
          const to = Math.min(from + entry.origToken.length, docLen);
          return {
            ...entry,
            from,
            to,
            line: line.number,
            deleted: false,
            anchor: from
          };
        }
      }
    }
    return { ...entry, from: undoStart, to: undoStart, anchor: undoStart };
  }

  const mappedFrom = Math.max(0, Math.min(changes.mapPos(entry.from, 1), docLen));
  const mappedTo = Math.max(0, Math.min(changes.mapPos(entry.to, -1), docLen));

  // If a non-empty token/range was completely deleted or replaced, collapse the error
  if (entry.nonEmpty && mappedFrom >= mappedTo) {
    const anchor = Math.max(0, Math.min(changes.mapPos(entry.from, -1), docLen));
    return {
      ...entry,
      from: anchor,
      to: anchor,
      deleted: true,
      anchor
    };
  }

  const clampedTo = Math.max(mappedFrom, mappedTo);
  const lineNum = newDoc.lineAt(mappedFrom).number;
  return {
    ...entry,
    from: mappedFrom,
    to: clampedTo,
    line: lineNum,
    deleted: false,
    anchor: mappedFrom
  };
}

/** Build tracked compiler issue entries for the given document and optional pre-compile ChangeSet. */
function buildTrackedEntries(doc, issues, activeFilePath = null, options = {}) {
  const { preChanges = null, targetDoc = doc, deletedSet = null } = options;
  if (!doc || !Array.isArray(issues) || issues.length === 0) return [];

  const entries = [];
  for (const iss of issues) {
    if (!iss || (iss.type !== 'error' && iss.type !== 'warning')) continue;
    if (!doesIssueMatchFile(iss, activeFilePath)) continue;
    if (deletedSet && deletedSet.has(iss)) continue;

    const range = resolveCompilerIssueRange(doc, iss);
    if (!range) continue;

    let entry = {
      issue: iss,
      from: range.from,
      to: range.to,
      line: range.line,
      nonEmpty: range.nonEmpty,
      origToken: range.origToken,
      deleted: false,
      anchor: range.from
    };

    if (preChanges) {
      entry = mapTrackedEntry(entry, preChanges, targetDoc, false);
    }
    if (!entry.deleted) {
      iss.line = entry.line;
    }
    entries.push(entry);
  }
  return entries;
}

/** Build line-highlight decorations for active compiler errors and explicit highlight ranges. */
function buildErrorLineDecorations(doc, entries, extraRanges) {
  const lineStarts = new Set();
  const docLen = doc.length;

  for (const entry of entries) {
    if (entry.deleted || !entry.issue || entry.issue.type !== 'error') continue;
    const pos = Math.max(0, Math.min(entry.from, docLen));
    lineStarts.add(doc.lineAt(pos).from);
  }

  for (const r of extraRanges) {
    if (r.deleted) continue;
    const pos = Math.max(0, Math.min(r.from, docLen));
    lineStarts.add(doc.lineAt(pos).from);
  }

  if (lineStarts.size === 0) return Decoration.none;
  const sortedStarts = [...lineStarts].sort((a, b) => a - b);
  return Decoration.set(sortedStarts.map((pos) => errorLineDeco.range(pos)), true);
}

const compilerIssueStateField = StateField.define({
  create() {
    return {
      entries: [],
      extraRanges: [],
      lineDecos: Decoration.none
    };
  },
  update(value, tr) {
    let entries = value.entries;
    let extraRanges = value.extraRanges;
    let changed = false;

    if (tr.docChanged) {
      if (tr.annotation(tabSwitchAnnotation)) {
        if (entries.length > 0 || extraRanges.length > 0) {
          entries = [];
          extraRanges = [];
          changed = true;
        }
      } else {
        const isUndo = typeof tr.isUserEvent === 'function' && tr.isUserEvent('undo');
        if (entries.length > 0) {
          entries = entries.map((entry) => mapTrackedEntry(entry, tr.changes, tr.newDoc, isUndo));
          changed = true;
        }
        if (extraRanges.length > 0) {
          extraRanges = extraRanges
            .map((r) => mapTrackedEntry(r, tr.changes, tr.newDoc, isUndo))
            .filter((r) => !r.deleted);
          changed = true;
        }
      }
    }

    for (const effect of tr.effects) {
      if (effect.is(setCompilerIssuesEffect)) {
        entries = Array.isArray(effect.value) ? effect.value : [];
        changed = true;
      } else if (effect.is(setExtraHighlightEffect)) {
        extraRanges = Array.isArray(effect.value) ? effect.value : [];
        changed = true;
      }
    }

    if (!changed) return value;
    return {
      entries,
      extraRanges,
      lineDecos: buildErrorLineDecorations(tr.newDoc, entries, extraRanges)
    };
  },
  provide: (f) => EditorView.decorations.from(f, (val) => val.lineDecos)
});

/** Extract CodeMirror lint diagnostics from tracked compiler issue entries in editor state. */
function getCompilerDiagnosticsFromState(state, activeFilePath = null) {
  const fieldState = state.field(compilerIssueStateField, false);
  if (!fieldState || !fieldState.entries || fieldState.entries.length === 0) {
    return [];
  }
  const docLen = state.doc.length;
  const diags = [];
  for (const entry of fieldState.entries) {
    if (entry.deleted || !entry.issue) continue;
    const iss = entry.issue;
    if (iss.type !== 'error' && iss.type !== 'warning') continue;
    if (!doesIssueMatchFile(iss, activeFilePath)) continue;
    const from = Math.max(0, Math.min(entry.from, docLen));
    const to = Math.max(from, Math.min(entry.to, docLen));
    diags.push({
      from,
      to,
      severity: iss.type === 'warning' ? 'warning' : 'error',
      message: `[LaTeX] ${iss.message}`
    });
  }
  return diags;
}

function latexLinterExtension(manager = null) {
  return [
    compilerIssueStateField,
    linter((view) => {
      const text = view.state.doc.toString();
      const preambleText = (manager && typeof manager.getMainPreamble === 'function')
        ? (manager.getMainPreamble() || '')
        : '';
      const staticDiagnostics = lintLatexDocument(text, { preambleText });
      const result = staticDiagnostics.map((d) => {
        const item = {
          from: Math.max(0, Math.min(d.from, text.length)),
          to: Math.max(0, Math.min(d.to, text.length)),
          severity: d.severity || 'warning',
          message: d.message
        };

        if (d.actions && d.actions.length > 0) {
          item.actions = d.actions.map((act) => ({
            name: act.name,
            apply(v, from, to) {
              v.dispatch({
                changes: {
                  from: act.from !== undefined ? act.from : from,
                  to: act.to !== undefined ? act.to : to,
                  insert: act.insert
                }
              });
            }
          }));
        }

        return item;
      });

      const activeFilePath = manager ? manager.activeFilePath : null;
      const compilerDiags = getCompilerDiagnosticsFromState(view.state, activeFilePath);
      for (const d of compilerDiags) {
        const isDup = result.some(existing => existing.from === d.from && existing.to === d.to);
        if (!isDup) {
          result.push(d);
        }
      }

      return result;
    }, {
      delay: 250,
      needsRefresh: (update) => update.transactions.some(
        (tr) => tr.effects.some((e) => e.is(setCompilerIssuesEffect))
      )
    })
  ];
}

module.exports = {
  latexLinterExtension,
  doesIssueMatchFile,
  compilerIssueStateField,
  setCompilerIssuesEffect,
  setExtraHighlightEffect,
  tabSwitchAnnotation,
  resolveCompilerIssueRange,
  mapTrackedEntry,
  buildTrackedEntries,
  getCompilerDiagnosticsFromState
};
