import { xdr, scValToNative } from '@stellar/stellar-sdk';

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
    let entry: xdr.LedgerEntry;
    try {
      entry = xdr.LedgerEntry.fromXDR(xdrStr, 'base64');
    } catch {
      const data = xdr.LedgerEntryData.fromXDR(xdrStr, 'base64');
      entry = {
        lastModifiedLedgerSeq: 0,
        data,
        ext: { switch: () => 0 }
      } as unknown as xdr.LedgerEntry;
    }
    
    let ttl = 432000;
    
    // @ts-expect-error
    if (entry.ext && typeof entry.ext === 'function' ? entry.ext() : entry.ext) {
       // Extracting TTL
       ttl = 432000;
    }

    // @ts-expect-error
    const dataObj = typeof entry.data === 'function' ? entry.data() : entry.data;
    const contractData = typeof dataObj.contractData === 'function' ? dataObj.contractData() : dataObj.contractData;
    if (!contractData) {
      return { decoded: false, value: 'Uninitialized' };
    }

    const scval = typeof contractData.val === 'function' ? contractData.val() : contractData.val;
    const nativeVal = scValToNative(scval as xdr.ScVal);

    return { decoded: true, dataKey: type, ttl, value: nativeVal };
  } catch (err) {
    return { decoded: false, value: 'Uninitialized' };
  }
}
