# Fleet refresh at scale

The fleet view reads one snapshot per guard in the address book. Each snapshot
is several RPC calls, so a large registry read all at once is an RPC burst.
Public endpoints rate-limit a burst like that, and slow ones time out.

## Concurrency cap

`pollFleet` reads at most `FLEET_POLL_CONCURRENCY` (6) guards at a time. Further
reads wait for a free slot. As a result:

- Refresh time grows roughly linearly with registry size: about `ceil(n / 6)`
  rounds of the slowest read.
- The RPC endpoint never sees more than six snapshot reads in flight from one
  tab.
- Every guard gets exactly one row, in address-book order. A guard whose read
  fails gets a row with its error instead of failing the whole refresh, and
  that row can be retried on its own.

## Measured behaviour

`tests/unit/fleetRefreshScaling.test.ts` drives `pollFleet` with registries of
1, 10, 50 and 200 guards and a fake reader with mixed latency: fast guards,
slow guards and unreachable guards. For every size it asserts:

- the peak number of reads in flight equals the cap and never exceeds it;
- every guard is read exactly once, rows stay in order, and failures become
  error rows;
- the refresh finishes within the bound the waves of the slowest read allow.

```bash
node --import tsx --test tests/unit/fleetRefreshScaling.test.ts
```
