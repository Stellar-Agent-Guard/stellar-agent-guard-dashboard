import { parseDiagnosticLogs } from '../../lib/guard/traceParser';
describe('traceParser', () => {
  it('parses logs', () => {
    expect(parseDiagnosticLogs([]).tree.length).toBe(0);
  });
});
