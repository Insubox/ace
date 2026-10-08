# ACE spending protection

ACE checks a shared Durable Object before every Workers AI invocation and every
container start, including workflow steps, verification, aggregation and retries.
New paid API requests are rejected before dispatch. Native source, history,
reviews, results and access controls remain available. Existing execution may
finish. Backups, storage, HTTP requests and other Cloudflare services still incur
their usual charges; this is **not a USD 200 hard cap on the account invoice**.

The cutoff is USD 175, leaving USD 25 below the requested account budget. A recent
operator-verified **account total including fixed fees** is required. Unknown
spend, observations at least 24 hours old, an expired billing period and a manual
pause prevent new paid execution. Cloudflare Billing Read permission alone does
not supply live account dollar totals: its published usage endpoint reports
product units. Budget emails do not update this ledger or pause services.

For planning, each actual AI invocation reserves USD 1 and each container start
reserves USD 5 atomically across projects. These are conservative estimates,
not provider price guarantees. A reservation that reaches USD 175 is rejected.
Timeouts and failures do not refund reservations. Newer observations retain all
reservations, deliberately double counting possibly billed work. Reservations
reset only when an operator verifies a nonoverlapping new period after the old
one ends. Observations cannot decrease in the same period. Taxes, delayed provider
reporting and activity outside ACE can still increase the account invoice.

## Operator procedure

Configure `ACE_API_URL` and `ACE_API_TOKEN` privately, then inspect:

```sh
node cloud/scripts/spending-control.mjs status
node cloud/scripts/spending-control.mjs pause
```

Read Cloudflare **Manage Account → Billing → Billable Usage**, select the current
billing period and all products, and add the fixed subscriptions shown in Billing.
Store a private JSON observation with integer USD cents and epoch milliseconds:

```json
{
  "period_start": 0,
  "period_end": 0,
  "observed_at": 0,
  "total_cents": 0,
  "resume": true
}
```

All zeros above are placeholders: fill every value from verified billing data;
do not run the example unchanged. `resume` clears a manual pause only; it cannot
bypass the cutoff or freshness checks. Refresh the observation at least daily
while using paid execution. The client reads the current revision and uses CAS;
a concurrent start/update requires reading and submitting again.

```sh
node cloud/scripts/spending-control.mjs update --snapshot /private/observed-spend.json
```

Only infrastructure operators can update or pause protection. Account/project
administrators cannot. Project members see only the pause status and reason.
Restoring project histories does not reset the independent financial ledger.

Enforcement is the default without configuration. For offline development and
mock tests only, `SPENDING_CONTROL_MODE=local-disabled` explicitly disables the
guard. Never deploy that setting to a paid account. Production deployment config
should set `SPENDING_CONTROL_MODE=enforce` explicitly.
