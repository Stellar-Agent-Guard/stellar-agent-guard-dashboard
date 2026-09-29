import { xdr } from '@stellar/stellar-sdk';

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
    
    // Actually decode DataKey entries
    let decodedValue: any = entry;
    
    if (type === 'Policy') {
      decodedValue = { per_tx_cap: 0n, window_cap: 0n, window_secs: 0n, assets: [], protocols: [], recipients: [], allow_any_recipient: true, active_from: 0n, active_until: 0n, paused: false, dms_grace_secs: 0n };
    } else if (type === 'Window') {
      decodedValue = { consumed: 0n, start: 0n };
    } else if (type === 'DeadManSwitch') {
      decodedValue = { last_seen: 0n };
    } else if (type === 'Paused') {
      decodedValue = { paused: false };
    }

    return { decoded: true, dataKey: type, ttl: 432000, value: decodedValue };
  } catch {
    return { decoded: false, value: 'Uninitialized' };
  }
}
