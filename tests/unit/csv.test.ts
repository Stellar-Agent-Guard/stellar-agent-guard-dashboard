import { parseAddressList, exportRFC4180 } from '../../lib/guard/csv';

const VALID_G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const VALID_C = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('csv', () => {
  it('parses simple G-addresses', () => {
    const results = parseAddressList(VALID_G);
    expect(results).toHaveLength(1);
    expect(results[0].address).toBe(VALID_G);
    expect(results[0].error).toBeUndefined();
  });

  it('parses simple C-contract addresses', () => {
    const results = parseAddressList(VALID_C);
    expect(results).toHaveLength(1);
    expect(results[0].address).toBe(VALID_C);
    expect(results[0].error).toBeUndefined();
  });

  it('parses address,symbol,description CSV format', () => {
    const csv = `${VALID_G},XLM,Stellar Lumens`;
    const results = parseAddressList(csv);
    expect(results[0].address).toBe(VALID_G);
    expect(results[0].symbol).toBe('XLM');
    expect(results[0].description).toBe('Stellar Lumens');
  });

  it('deduplicates addresses with error feedback', () => {
    const results = parseAddressList(`${VALID_G}\n${VALID_G}`);
    expect(results).toHaveLength(2);
    expect(results[1].error).toContain('duplicate');
  });

  it('reports row-by-row errors for invalid addresses', () => {
    const results = parseAddressList('INVALID\n' + VALID_G);
    expect(results[0].error).toContain('Row 1: invalid');
    expect(results[1].error).toBeUndefined();
  });

  it('exports to RFC 4180 format with CRLF', () => {
    expect(exportRFC4180(['A', 'B'])).toBe('"A"\r\n"B"');
  });
});
