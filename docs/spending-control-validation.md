# Spending protection validation — 2026-10-08

- TypeScript check passed; 138 Worker tests and 30 client tests passed.
- Worker bundle built with the existing pinned container image. The generic
  Docker rebuild in this managed environment failed to trust its proxy CA; no
  container image change was deployed or claimed verified.
- Tests cover concurrent reservations, unknown/stale billing, expired periods,
  operator authority, revision conflicts, reservation retention after failures,
  retries, native browsing, and the actual container start primitive.
- Worker `a8834728-b356-4adc-a968-61f33d2780e4` was deployed at 100% to avoid
  mixed coordinator protocols. Production Observatory/CSP and authenticated
  operations passed; native history remained available.
- A valid Hello World application request returned HTTP 429 before dispatch.
  Daily counters and monetary reservations remained unchanged. No paid model or
  container invocation was made for this production check.
- Production currently has no verified billing observation and therefore blocks
  new paid execution. The supplied zero-dollar screenshot covers the previous
  September 8–October 7 period, not the active October 8–November 7 period.

The guard controls ACE AI/container admission using observed spend plus planning
allowances. This is not an invoice cap or certification of Cloudflare reporting
latency. Fixed subscriptions, storage, requests and external account activity
can continue to incur charges. See [operator instructions](spending-control.md).

The release-check client also now quotes version override IDs as required by
Cloudflare's structured header syntax. Previous unquoted-header smoke results
must not be interpreted as proof that a request reached the specified version.
