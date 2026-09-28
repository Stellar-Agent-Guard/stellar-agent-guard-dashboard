import React from 'react';
export function SpendingProjectionChart({ data }: any) {
  return <div className="p-4 bg-gray-100 rounded">7-day Spend Projection: {data?.length} days simulated.</div>;
}
