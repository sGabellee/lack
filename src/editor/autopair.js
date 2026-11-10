const { checkBackspacePair, checkBeginEnvEnter } = require('./autopair-logic');
const { EditorSelection, Prec } = require('@codemirror/state');
const { EditorView } = require('@codemirror/view');

function backspacePairCommand(view) {
  const { state } = view;
  if (!state.selection.main.empty) return false;
  const pos = state.selection.main.head;
  const docText = state.doc.toString();
  const pairInfo = checkBackspacePair(docText, pos);
  if (pairInfo) {
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
  const docText = state.doc.toString();
  const enterInfo = checkBeginEnvEnter(docText, pos);
  if (enterInfo) {
    const line = state.doc.lineAt(pos);
    const indent = line.text.match(/^\s*/)[0];
    const insertText = `\n${indent}  \n${indent}\\end{${enterInfo.envName}}`;
    const cursorOffset = indent.length + 3; // pos + 1 (newline) + indent + 2 spaces
    view.dispatch({
      changes: { from: pos, insert: insertText },
      selection: { anchor: pos + cursorOffset }
    });
    return true;
  }
  return false;
}

// Custom pair typing helper for $, \(, \[, `
function customPairTypingExtension() {
  return Prec.high(
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (event.key === '$' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const { state } = view;
          if (state.selection.main.empty) {
            const pos = state.selection.main.head;
            const nextChar = state.doc.sliceString(pos, pos + 1);
            if (nextChar === '$') {
              // Skip over existing closing $
              view.dispatch({
                selection: { anchor: pos + 1 }
              });
              event.preventDefault();
              return true;
            }
            // Insert $$ and place cursor inside
            view.dispatch({
              changes: { from: pos, insert: '$$' },
              selection: { anchor: pos + 1 }
            });
            event.preventDefault();
            return true;
          }
        } else if (event.key === '`' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const { state } = view;
          if (state.selection.main.empty) {
            const pos = state.selection.main.head;
            // LaTeX quote pair `... '
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
    // Only inspect single-range changes made by user
    if (!tr.docChanged || tr.changes.empty || !tr.isUserEvent('input')) {
      return tr;
    }

    let extraChange = null;
    tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      // Check if this change occurred inside \begin{name} or \end{name}
      const oldDoc = tr.startState.doc;
      const line = oldDoc.lineAt(fromA);
      const lineText = line.text;
      const relFrom = fromA - line.from;

      const beginRegex = /\\begin\{([a-zA-Z0-9*_-]+)\}/g;
      let m;
      while ((m = beginRegex.exec(lineText)) !== null) {
        const nameStart = line.from + m.index + 7;
        const nameEnd = nameStart + m[1].length;
        if (fromA >= nameStart && toA <= nameEnd) {
          // Editing inside \begin{env}
          const oldName = m[1];
          // Find matching \end{oldName} forward
          const textAfter = oldDoc.sliceString(line.to);
          const endPattern = new RegExp(`\\\\end\\{${oldName.replace(/[*_]/g, '\\$&')}\\}`, 'g');
          const endMatch = endPattern.exec(textAfter);
          if (endMatch) {
            const targetNameStart = line.to + endMatch.index + 5;
            const targetNameEnd = targetNameStart + oldName.length;
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
