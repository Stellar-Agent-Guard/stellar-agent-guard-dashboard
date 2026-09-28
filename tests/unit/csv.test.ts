import { parseAddressList, exportRFC4180 } from '../../lib/guard/csv';
describe('csv', () => {
  it('parses and deduplicates addresses', () => {
    const addr = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(parseAddressList(addr + '\\n' + addr)).toEqual([addr]);
  });
  it('exports to rfc4180', () => {
    expect(exportRFC4180(['A', 'B'])).toBe('"A"\\r\\n"B"');
  });
});
