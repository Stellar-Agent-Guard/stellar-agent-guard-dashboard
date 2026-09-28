import React from 'react';
import { PolicySimulationView } from './PolicySimulationView';
import { CsvImportExport } from './CsvImportExport';
import { fetchTokenMetadata } from '../lib/guard/tokenMetadata';

export function PolicyForm() {
  return (
    <div>
      <PolicySimulationView />
      <CsvImportExport />
    </div>
  );
}
