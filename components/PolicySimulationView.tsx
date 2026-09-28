import React from 'react';
import { simulateRollingSpend } from '../lib/guard/policySimulator';

interface SpendPoint {
  time: number;
  amount: number;
}

interface Props {
  spendHistory?: SpendPoint[];
  ceilingStroops?: number;
}

export function PolicySimulationView({ spendHistory = [], ceilingStroops = 1000000 }: Props) {
  const width = 400;
  const height = 200;
  const padding = 40;

  const simulation = simulateRollingSpend(spendHistory, 86400000);

  const maxAmount = Math.max(ceilingStroops, ...spendHistory.map(p => p.amount), 1);
  const maxTime = spendHistory.length > 0 ? Math.max(...spendHistory.map(p => p.time)) : Date.now();
  const minTime = spendHistory.length > 0 ? Math.min(...spendHistory.map(p => p.time)) : Date.now() - 86400000;

  const toX = (t: number) =>
    padding + ((t - minTime) / (maxTime - minTime || 1)) * (width - 2 * padding);
  const toY = (a: number) =>
    height - padding - (a / maxAmount) * (height - 2 * padding);

  const ceilingY = toY(ceilingStroops);
  const pathD = spendHistory
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.time)},${toY(p.amount)}`)
    .join(' ');

  return (
    <div>
      <h3>Rolling 24h Spend Simulation</h3>
      <svg width={width} height={height} aria-label="Rolling spend curve vs ceiling">
        {/* Ceiling line */}
        <line
          x1={padding} y1={ceilingY}
          x2={width - padding} y2={ceilingY}
          stroke="red" strokeDasharray="4 2" strokeWidth={1.5}
        />
        <text x={padding + 4} y={ceilingY - 4} fontSize={10} fill="red">
          Ceiling: {ceilingStroops.toLocaleString()} stroops
        </text>

        {/* Spend curve */}
        {pathD && (
          <path d={pathD} fill="none" stroke="#4f8ef7" strokeWidth={2} />
        )}

        {/* Rejection highlights */}
        {spendHistory.map((p, i) =>
          p.amount > ceilingStroops ? (
            <circle key={i} cx={toX(p.time)} cy={toY(p.amount)} r={4} fill="red" opacity={0.7} />
          ) : null
        )}

        {/* Axes */}
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#888" />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#888" />
      </svg>
      <div>
        <small>Simulated: {simulation.summary} | Rejected: {simulation.rejected ? 'Yes' : 'No'}</small>
      </div>
    </div>
  );
}
