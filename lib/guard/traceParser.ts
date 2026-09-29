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
  
  const tree: TraceNode[] = events.map(event => {
    let error: string | undefined;
    if (typeof event === 'string' && event.includes('Error(Contract, #100)')) {
      error = 'SpendCapExceeded';
    } else if (event?.error) {
      error = event.error === 100 ? 'SpendCapExceeded' : 'UnknownError';
    }
    
    return {
      contractId: event?.contractId || 'C_UNKNOWN',
      functionName: event?.functionName || 'unknown',
      arguments: event?.args || [],
      error,
      events: event?.logs || [],
      subCalls: []
    };
  });

  return { tree };
}
