# shopmonkey-api-quirks

A reproducible test harness that exercises a small set of Shopmonkey REST API behaviors and reports whether each matches expectations from the public docs at https://shopmonkey.dev/.

This was assembled by an integration partner running a production sync against `https://api.shopmonkey.cloud/v3`. It exists to make a constructive conversation easier: every claim ships with the exact request that produced it, the response counts, and a verdict.

The harness is intentionally minimal: TypeScript, fetch, no test framework. Every test is one short file under `src/tests/`.

## Findings (live run, 2026-04-27)

| Test | Verdict | Headline |
|---|---|---|
| 01 — Non-determinism | **CONFIRMED** | 5 identical `GET /v3/order` calls with identical `skip`/`limit`/`orderBy` returned **5 mostly-disjoint sets**. Min Jaccard = 0.0 across 10 pairs (some pairs shared zero IDs). |
| 02 — `where` range operators | **CONFIRMED** | `where={"createdDate":{"$gte":"2099-01-01"}}` returned `meta.total=5719`, identical to the unfiltered call. Filter silently dropped. |
| 03 — Non-status equality filters | **NOT REPRODUCED** | `where={"customerId": "<id>"}` correctly returned only matching rows. Equality filters on non-status fields appear to work now. |
| 04 — `orderBy` does not sort | **CONFIRMED** | `orderBy={"createdDate":"asc"}` produced 50 of 99 adjacent-pair inversions. Adding `collate=true` produced 46 inversions. Records arrive in essentially random order. |
| 05 — `offset` ignored on `/customer` | **CONFIRMED** | `?limit=10&offset=0` and `?limit=10&offset=50` returned the **same 10 customer IDs** (intersection = 10/10). Re-running with `skip=0` vs `skip=50` produced **disjoint pages** (intersection = 0/10). |
| 06 — `hasMore` past `meta.total` | **NOT REPRODUCED** | Probing `skip=meta.total+1000` returned `data: []` and `hasMore: false`. Looks fixed since 2026-02. |
| 07 — `limit` silently clamped | **CONFIRMED** | `?limit=500` returned exactly 100 rows. No `400`, no warning header. |
| 08 — Payment search date filter | **CONFIRMED** | `POST /v3/integration/payment/search` with `where={"createdDate":{"$gte":"2099-01-01"}}` returned `meta.total=3358`, identical to the unfiltered call. |
| 09 — Services not nested | **INFORMATIONAL** | Neither `GET /v3/order` nor `GET /v3/order/:id` includes a `services` array; matches current public docs. Captured here as a workload note: pulling services for N orders requires N+1 round-trips. |
| 10 — Field-name capture | **INFORMATIONAL** | Live response key sets confirm current schema docs: services use `labors` (plural), parts expose both `retailCostCents` and `wholesaleCostCents`, canned-service ref is `sourceServiceId`, orders carry `generatedCustomerName` / `generatedVehicleName`, labors carry both shop-cost (`costRateCents`/`costHours`/`costTotalCents`) and bill-rate (`rateCents`/`hours`). |
| 11 — Subcontract field rename | **CONFIRMED** | Across 5 live subcontracts, `costCents` is present on all 5 (populated on all 5). `wholesaleCostCents` is **not present** on any. Older client code reading `wholesaleCostCents` will silently see `undefined`. |

**Summary:** 7 confirmed bugs, 2 issues that have been fixed since 2026-02 (great news), 2 informational corroborations of current docs.

Per-test evidence with raw request logs is in `evidence/`.

## What this changes vs. our 2026-02 issue list

Two findings from our older internal notes are no longer reproducible — credit where it's due:

- **Equality filters beyond `status`**: an equality `where` clause on `customerId` is honored on `/v3/order` (test 03).
- **`hasMore` past end**: `skip > meta.total` correctly returns `hasMore: false` (test 06).

The remaining 7 issues still reproduce.

## How to run

Requires Node ≥ 20.10 and a Shopmonkey API key (Bearer token from Settings → API).

```bash
git clone <this repo>
cd shopmonkey-api-quirks
cp .env.example .env       # paste your API key into .env
pnpm install
pnpm test:all              # runs all tests, writes evidence/<id>.json + summary.json
pnpm test:all -- --only 04-orderby-and-collate   # run a single test
pnpm list                  # list test ids
```

Each test pulls a small number of public records (orders, customers, payments) from your shop. The polite delay between requests is 250 ms (configurable via `REQUEST_DELAY_MS`). A full run is ~2–4 minutes.

## What the harness captures

For each test the runner writes `evidence/<id>.json` containing:

- The hypothesis being tested (what the docs imply *should* happen).
- A `verdict`: `CONFIRMED_BUG`, `NOT_REPRODUCED`, `INFORMATIONAL`, or `ERROR`.
- A short `summary` of the observed behavior.
- A structured `evidence` block with counts, intersections, inversions, key sets — whatever made the call.
- A complete `requests` log: method, path, query/body, HTTP status, response timing, and `meta.total` / `meta.hasMore` / `data.length` from each response.

PII (names, emails, phones, addresses, vehicle make/model/VIN, plate, mileage, free-text notes/descriptions) is replaced with `<redacted:N>` markers preserving only string length. UUIDs and ID-typed fields are replaced with stable salted hashes (`id:<12 hex>`) so cross-call comparisons (e.g., the Jaccard computation in test 01) remain meaningful without exposing real record IDs. The implementation is in `src/redact.ts` and runs over the entire payload before anything is written to disk.

The harness only ever issues `GET` requests, and one `POST` to `/v3/integration/payment/search` for test 08. It does not write to your shop.

## Layout

```
src/
  client.ts            # tiny fetch wrapper: rate limit, request log, no header logging
  redact.ts            # PII / ID scrubber applied before anything is written to disk
  runner.ts            # imports the test modules, runs them, writes evidence
  tests/
    01-non-determinism.ts
    02-where-range-operators.ts
    03-equality-filters.ts
    04-orderby-and-collate.ts
    05-offset-vs-skip.ts
    06-hasmore-past-total.ts
    07-limit-clamp.ts
    08-payment-date-filter.ts
    09-services-not-nested.ts
    10-field-divergence.ts
    11-subcontract-rename.ts
evidence/              # populated by `pnpm test:all` — one JSON file per test
.env.example
```

## Notes on issues not covered by the harness

A few things from our old issue list were intentionally excluded from automated tests:

- **Bulk export (`POST /v3/export` / `POST /v3/export/presigned_url`)**. The endpoint contract is documented at https://shopmonkey.dev/resources/export, but the page is marked **WIP** with the placeholder "A summary needs to be written for Export" and is not indexed by Google — `site:shopmonkey.dev export` returns nothing. The contract is enough to integrate against (we did), but the doc gives no guidance on freshness lag (we measure ~4–5 hours), no list of available `tables`, no parity statement against the REST schema, and no mention that soft-deleted rows are included. We'd love a real prose section. There are also minor field-name divergences between export payloads and REST payloads — e.g., `fee.percentValue` vs `fee.percent`. Subcontract `wholesaleCostCents` vs `costCents` looks similar but is actually the REST schema catching up to the export schema (see test 11). Not exercised in the harness because the export downloads several MB of full-shop data and would mostly duplicate what `/order` etc. already show.
- **Server-side timeouts / hung connections**. The shopmonkey.dev Overview page documents rate limits but no response-time SLA. We hit one indefinite hang during initial backfill in 2026-02 and added a 30 s client-side `AbortSignal.timeout` — that's been adequate since. Hard to test on demand, so left as a doc-and-discussion item.
- **Webhook trigger event types**. `/v3/webhook` is now documented as a CRUD resource, but the list of available `triggers` (event types) and payload schemas isn't published. We didn't try to enumerate this in the harness.

## What we'd love to discuss

The biggest practical asks, from most to least disruptive to fix:

1. **Stable, deterministic pagination.** The combination of test 01 (non-determinism), test 04 (`orderBy` doesn't sort), and test 07 (`limit` ≤ 100) means there is no reliable way to walk a Shopmonkey table through the public REST API. Today partners build multi-pass scrapers with multiple sort strategies and post-hoc dedup to approximate completeness. A stable sort + a real cursor token would let an integration finish a full sync in `O(total / 100)` calls instead of `O(total / 100 × passes)`.
2. **Honored server-side filters on dates.** Tests 02 and 08 are both about silently-ignored date filters. `updatedDate.$gte` on `/v3/order` and `createdDate.$gte` on `/v3/integration/payment/search` would, on their own, eliminate the need for full-table scans on every incremental sync.
3. **EDS (Enterprise Data Streaming) availability outside of HQ.** [`shopmonkeyus/eds`](https://github.com/shopmonkeyus/eds) would solve essentially every issue in this report — it's CDC, no pagination, no filtering. Today it's gated behind enterprise tier. Even read-only access at lower tiers would be transformative.
4. **Documentation of supported `where` predicates per resource.** Tests 02, 03, and 08 took longer to figure out than they should have, because the public docs describe `where` as `any` with no examples. A short reference of which fields and operators each endpoint actually honors — even if the answer is "only `status` equality on this resource" — would be a meaningful improvement.
5. **Behavior when `limit > 100`.** Either return more rows or return a `400`. Silent clamping (test 07) is the surprising case.
6. **Documented event triggers for `/v3/webhook`.** If we can webhook on order updates, we can avoid most polling.

We'd be happy to pair on any of these — or to be told we're holding the API wrong and pointed at the right knob.

## License

MIT. Use it, fork it, file issues.
