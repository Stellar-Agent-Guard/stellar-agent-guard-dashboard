export interface TraceNode {
  contractId: string;
  functionName: string;
  arguments: string[];
  error?: string;
  events: any[];
}

export interface ParsedDiagnostic {
  tree: TraceNode[];
}

export function parseDiagnosticLogs(logs: string[]): ParsedDiagnostic {
  if (!logs || logs.length === 0) return { tree: [] };
  
  const tree: TraceNode[] = logs.map(log => {
    let error: string | undefined;
    if (log.includes('Error(Contract, #100)')) {
      error = 'SpendCapExceeded';
    }
    return {
      contractId: 'C_UNKNOWN',
      functionName: 'unknown',
      arguments: [],
      error,
      events: []
    };
  });

  return { tree };
}
