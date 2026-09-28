export function createTransactionEnvelope(currentTime: number) {
  const minTime = currentTime - 60;
  const maxTime = currentTime + 300;
  return { minTime, maxTime };
}
export function detectExpiration(currentTime: number, maxTime: number) {
  return currentTime >= maxTime;
}
