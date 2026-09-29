import { scValToNative, xdr } from '@stellar/stellar-sdk';

export interface TraceNode {
  contractId: string;
  functionName: string;
  arguments: any[];
  error?: string;
  events: any[];
  subCalls: TraceNode[];
}

export interface ParsedDiagnostic {
  tree: TraceNode[];
}

export function parseDiagnosticLogs(events: any[]): ParsedDiagnostic {
  if (!events || events.length === 0) return { tree: [] };
  
  const tree: TraceNode[] = [];

  for (const event of events) {
    let error: string | undefined;
    let contractId = 'C_UNKNOWN';
    let functionName = 'unknown';
    let args: any[] = [];
    let logs: any[] = [];

    if (typeof event === 'string') {
      if (event.includes('Error(Contract, #100)')) {
        error = 'SpendCapExceeded';
      }
      logs.push(event);
    } else {
      if (event.type === 'diagnostic') {
         contractId = event.contractId || contractId;
         functionName = event.functionName || functionName;
         if (event.args) args = event.args;
         if (event.logs) logs = event.logs;
         if (event.error) error = event.error === 100 ? 'SpendCapExceeded' : 'UnknownError';
      } else if (event.type === 'contract') {
         try {
           const scval = typeof event.data === 'string' ? xdr.ScVal.fromXDR(event.data, 'base64') : event.data;
           if (scval && (scval as any).switch) {
             const native = scValToNative(scval as xdr.ScVal);
             logs.push(native);
           }
         } catch {
           logs.push(event.data);
         }
      }
    }

    tree.push({
      contractId,
      functionName,
      arguments: args,
      error,
      events: logs,
      subCalls: []
    });
  }

  return { tree };
}
