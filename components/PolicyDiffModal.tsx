import React from 'react';
import { PolicyDiff } from '../lib/guard/policyDiff';

export function PolicyDiffModal({ diff, onConfirm, onCancel }: { diff: PolicyDiff, onConfirm: () => void, onCancel: () => void }) {
  return (
    <div className="modal">
      <h2>Policy Changes</h2>
      {diff.warnings.map((w, i) => <div key={i} className="warning-badge">{w}</div>)}
      <ul>
        {diff.entries.filter(e => e.status !== 'unchanged').map(e => (
          <li key={e.field}>
            {e.status === 'modified' ? '~' : e.status === 'added' ? '+' : '-'} {e.field}: {String(e.oldValue)} {"->"} {String(e.newValue)}
          </li>
        ))}
      </ul>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}
