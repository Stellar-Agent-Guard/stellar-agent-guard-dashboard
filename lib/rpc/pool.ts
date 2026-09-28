export function createConnectionPool() {
  // connection pool multiplexing for high-throughput block subscriptions
  return { pool: [], status: "active" };
}
