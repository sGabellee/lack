const { linter } = require('@codemirror/lint');
const { lintLatexDocument } = require('./linter-logic');
const path = require('path');

function latexLinterExtension(manager = null) {
  return linter((view) => {
    const text = view.state.doc.toString();
    const staticDiagnostics = lintLatexDocument(text);
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

    // Merge compiler issues if provided by manager
    if (manager && manager.compilerIssues && manager.compilerIssues.length > 0) {
      const activeFilePath = manager.activeFilePath;
      const activeBase = activeFilePath ? path.basename(activeFilePath) : null;
      const docLines = view.state.doc.lines;

      for (const iss of manager.compilerIssues) {
        if (iss.type !== 'error' && iss.type !== 'warning') continue;
        if (iss.file && activeBase && path.basename(iss.file) !== activeBase) continue;

        const lineNum = iss.line;
        if (!lineNum || lineNum < 1 || lineNum > docLines) continue;

        const line = view.state.doc.line(lineNum);
        const lineText = line.text;

        let from = line.from;
        let to = line.to;

        if (iss.command) {
          const cleanCmd = iss.command.startsWith('\\') ? iss.command : `\\${iss.command}`;
          const idx = lineText.indexOf(cleanCmd);
          if (idx !== -1) {
            from = line.from + idx;
            to = from + cleanCmd.length;
          }
        } else {
          // Look for any LaTeX command \\[a-zA-Z@]+ on that line
          const cmdMatch = lineText.match(/\\[a-zA-Z@]+/);
          if (cmdMatch) {
            from = line.from + cmdMatch.index;
            to = from + cmdMatch[0].length;
          } else {
            const trimmed = lineText.trim();
            if (trimmed.length > 0) {
              const start = lineText.indexOf(trimmed);
              from = line.from + start;
              to = from + trimmed.length;
            }
          }
        }

        const isDup = result.some(d => d.from === from && d.to === to);
        if (!isDup) {
          result.push({
            from: Math.max(0, Math.min(from, text.length)),
            to: Math.max(0, Math.min(to, text.length)),
            severity: iss.type === 'warning' ? 'warning' : 'error',
            message: `[LaTeX] ${iss.message}`
          });
        }
      }
    }

    return result;
  }, { delay: 250 });
}

module.exports = { latexLinterExtension };
