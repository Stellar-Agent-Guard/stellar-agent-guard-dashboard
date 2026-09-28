export function calculateFeeHeadroom(cpu: number, baseFee: bigint) {
  const paddedCpu = Math.ceil(cpu * 1.15);
  const paddedFee = (baseFee * 120n) / 100n;
  return { cpu: paddedCpu, fee: paddedFee };
}
