const { checkBackspacePair, checkBeginEnvEnter } = require('./autopair-logic');
const { EditorSelection, Prec } = require('@codemirror/state');
const { EditorView } = require('@codemirror/view');

function backspacePairCommand(view) {
  const { state } = view;
  if (!state.selection.main.empty) return false;
  const pos = state.selection.main.head;
  const docText = state.doc.toString();
  const pairInfo = checkBackspacePair(docText, pos);
  if (pairInfo && pairInfo.shouldDelete) {
    view.dispatch({
      changes: { from: pairInfo.from, to: pairInfo.to },
      selection: { anchor: pairInfo.from }
    });
    return true;
  }
  return false;
}

function enterBeginEnvCommand(view) {
  const { state } = view;
  if (!state.selection.main.empty) return false;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const colInLine = pos - line.from;
  const enterInfo = checkBeginEnvEnter(line.text, colInLine);
  if (enterInfo && enterInfo.shouldExpand) {
    view.dispatch({
      changes: { from: pos, insert: enterInfo.insertText },
      selection: { anchor: pos + enterInfo.cursorOffset }
    });
    return true;
  }
  return false;
}

// Custom pair typing helper for $, ", `, \(, \[
function customPairTypingExtension() {
  return Prec.high(
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (event.ctrlKey || event.metaKey || event.altKey) {
          return false;
        }

        const { state } = view;
        const sel = state.selection.main;

        // 1. Math delimiter: $
        if (event.key === '$') {
          if (!sel.empty) {
            // Wrap selection in $...$
            const selectedText = state.sliceDoc(sel.from, sel.to);
            view.dispatch({
              changes: { from: sel.from, to: sel.to, insert: `$${selectedText}$` },
              selection: { anchor: sel.from + 1, head: sel.to + 1 }
            });
            event.preventDefault();
            return true;
          }

          const pos = sel.head;
          const prevChar = pos > 0 ? state.doc.sliceString(pos - 1, pos) : '';
          const nextChar = pos < state.doc.length ? state.doc.sliceString(pos, pos + 1) : '';

          // Overtype closing $
          if (nextChar === '$' && prevChar !== '$') {
            view.dispatch({
              selection: { anchor: pos + 1 }
            });
            event.preventDefault();
            return true;
          }

          // In between $|$: turn into display math $$|$$
          if (prevChar === '$' && nextChar === '$') {
            view.dispatch({
              changes: { from: pos - 1, to: pos + 1, insert: '$$$$' },
              selection: { anchor: pos + 1 }
            });
            event.preventDefault();
            return true;
          }

          // Normal inline math: insert $$ and put cursor at $|$
          view.dispatch({
            changes: { from: pos, insert: '$$' },
            selection: { anchor: pos + 1 }
          });
          event.preventDefault();
          return true;
        }

        // 2. LaTeX quotes: " -> ``|''
        if (event.key === '"') {
          if (!sel.empty) {
            const selectedText = state.sliceDoc(sel.from, sel.to);
            view.dispatch({
              changes: { from: sel.from, to: sel.to, insert: `\`\`${selectedText}''` },
              selection: { anchor: sel.from + 2, head: sel.to + 2 }
            });
            event.preventDefault();
            return true;
          }

          const pos = sel.head;
          const next2 = state.doc.sliceString(pos, pos + 2);
          if (next2 === "''") {
            view.dispatch({
              selection: { anchor: pos + 2 }
            });
            event.preventDefault();
            return true;
          }

          view.dispatch({
            changes: { from: pos, insert: "``''" },
            selection: { anchor: pos + 2 }
          });
          event.preventDefault();
          return true;
        }

        // 3. Single LaTeX quote pair: ` -> `|'
        if (event.key === '`') {
          if (sel.empty) {
            const pos = sel.head;
            view.dispatch({
              changes: { from: pos, insert: "`'" },
              selection: { anchor: pos + 1 }
            });
            event.preventDefault();
            return true;
          }
        }

        return false;
      }
    })
  );
}

// Rename sync transaction filter
function createRenameSyncFilter() {
  return (tr) => {
    if (!tr.docChanged || tr.changes.empty || !tr.isUserEvent('input')) {
      return tr;
    }

    let extraChange = null;
    tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      const oldDoc = tr.startState.doc;
      const line = oldDoc.lineAt(fromA);
      const lineText = line.text;

      const beginRegex = /\\begin\{([a-zA-Z0-9*_-]+)\}/g;
      let m;
      while ((m = beginRegex.exec(lineText)) !== null) {
        const nameStart = line.from + m.index + 7;
        const nameEnd = nameStart + m[1].length;
        if (fromA >= nameStart && toA <= nameEnd) {
          const oldName = m[1];
          const textAfter = oldDoc.sliceString(line.to);
          const endPattern = new RegExp(`\\\\end\\{${oldName.replace(/[*_]/g, '\\$&')}\\}`, 'g');
          const endMatch = endPattern.exec(textAfter);
          if (endMatch) {
            const targetNameStart = line.to + endMatch.index + 5;
            const diffFrom = fromA - nameStart;
            const diffLen = toA - fromA;
            extraChange = {
              from: targetNameStart + diffFrom,
              to: targetNameStart + diffFrom + diffLen,
              insert: inserted.toString()
            };
          }
          break;
        }
      }
    });

    if (extraChange) {
      return [tr, { changes: extraChange }];
    }
    return tr;
  };
}

module.exports = {
  backspacePairCommand,
  enterBeginEnvCommand,
  customPairTypingExtension,
  createRenameSyncFilter
};
