import { xdr } from '@stellar/stellar-sdk';
import type { PolicyConfig } from 'stellar-agent-guard-sdk';

export type DataKey = 'Policy' | 'Window' | 'DeadManSwitch' | 'Paused';

export interface DecodedStorage<T> {
  decoded: boolean;
  ttl?: number;
  dataKey?: DataKey;
  value?: T | 'Uninitialized';
}

export function decodeStorageFootprint(xdrStr: string, type: DataKey): DecodedStorage<any> {
  if (!xdrStr) return { decoded: false, value: 'Uninitialized' };
  try {
    const entry = xdr.LedgerEntryData.fromXDR(xdrStr, 'base64');
    return { decoded: true, dataKey: type, ttl: 3600, value: entry };
  } catch {
    return { decoded: false, value: 'Uninitialized' };
  }
}
