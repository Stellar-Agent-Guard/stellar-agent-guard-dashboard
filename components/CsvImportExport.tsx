import React from 'react';
export function CsvImportExport({ onImport }: any) {
  return <div>
    <button className="p-2 border" onClick={() => onImport("C123,whitelist")}>Import CSV</button>
    <button className="p-2 border ml-2">Export CSV</button>
  </div>;
}
