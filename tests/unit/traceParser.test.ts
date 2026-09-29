import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseDiagnosticLogs } from '../../lib/guard/traceParser';

describe('traceParser', () => {
  it('parses empty logs', () => {
    assert.strictEqual(parseDiagnosticLogs([]).tree.length, 0);
  });

  it('decodes SpendCapExceeded error', () => {
    const res = parseDiagnosticLogs(['Error(Contract, #100)']);
    assert.strictEqual(res.tree[0]?.error, 'SpendCapExceeded');
  });

  it('decodes object events', () => {
    const res = parseDiagnosticLogs([{ type: 'diagnostic', contractId: 'C123', functionName: 'test', args: [], error: 100 }]);
    assert.strictEqual(res.tree[0]?.error, 'SpendCapExceeded');
  });
});
