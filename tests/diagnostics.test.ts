import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBuildLog } from '../src/main/diagnostics.ts';

test('wrapped citation/reference warnings and citation summaries share one blocking classification', () => {
  for (const warning of ["Package natbib Warning: Citation `long-key' o\nn page 1 unde\nfined on input line 4.", 'Package natbib Warning: There were undefined citations.', "LaTeX Warning: Reference `long-key' on page\n1 undefined on input line 8.", 'Missing character: There is no x in font missing!']) {
    const result = classifyBuildLog(warning);
    assert.equal(result.blockingWarnings, true, warning); assert.equal(result.diagnostics[0].severity, 'warning');
  }
});
test('the classifier does not join unrelated warnings and retains nonblocking layout messages', () => {
  const result = classifyBuildLog('Package sample Warning: Citation formatting changed.\n\nPackage other Warning: undefined option ignored.\n\nOverfull \\hbox (1.0pt too wide)\n./main.tex:7: Undefined control sequence.');
  assert.equal(result.blockingWarnings, false);
  assert.equal(result.diagnostics.filter(d => d.severity === 'warning').length, 1);
  assert.equal(result.diagnostics.find(d => d.severity === 'error')?.line, 7);
});
