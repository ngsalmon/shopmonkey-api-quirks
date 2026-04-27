# shopmonkey-api-quirks

A reproducible test harness that exercises a small set of Shopmonkey REST API behaviors and reports whether each matches expectations from the public docs at https://shopmonkey.dev/.

This was assembled by an integration partner running a production sync against `https://api.shopmonkey.cloud/v3`. It exists to make a constructive conversation easier: every claim ships with the exact request that produced it, the response counts, and a verdict.

The harness is intentionally minimal: TypeScript, fetch, no test framework. Every test is one short file under `src/tests/`. Each test was validated against alternative syntaxes and against community sources before being included — see [`docs/validation-notes.md`](#validation-notes) below.

## Findings

| Test | Headline |
|---|---|
| 01 — Non-determinism with sort + filter | 5 identical `GET /v3/order` calls — same `skip`, same `limit`, `orderBy={"id":"asc"}` *(test 03 confirms this is honored)*, and `where={"createdDate":{"gte":"2025-01-01"}}` *(test 02 confirms this is honored)* — returned **5 mostly-disjoint sets**. Min Jaccard close to 0 across pairs. With both a working sort and a working filter applied, identical paginated calls still produce different result sets. |
| 02 — `where` operator syntax | The MongoDB-style `$gte` operator is silently dropped (`metaTotal` unchanged from baseline). The bare `gte` form (no `$` prefix) filters correctly (`metaTotal=0` for a future date). Neither syntax is documented — the public docs describe `where` only as type "any" with no examples. |
| 03 — `orderBy` honored on `id`, ignored on `createdDate` | `orderBy={"id":"asc"}` produces 1–5 alphabetic inversions out of 49 (effectively sorted). The same syntax on `createdDate` produces 20–28 adjacent-pair inversions — random. We tested 8 alternative encodings (string forms, hyphen-prefix, JSON `1/-1`, array shapes); none sort `createdDate`. So this isn't a syntax issue — `createdDate` simply isn't orderable through this endpoint. |
| 04 — `offset` ignored on `/customer` | `?limit=10&offset=0` and `?limit=10&offset=50` returned the **same 10 customer IDs** (intersection 10/10). The same calls with `skip=0` vs `skip=50` produced **disjoint pages** (intersection 0/10). `offset` is not a documented parameter — the bug is that it's silently accepted rather than rejected. |
| 05 — `limit` silently clamped | `?limit=500` returned exactly 100 rows. No `400`, no warning header. The 100-row cap is not documented anywhere. |
| 06 — Payment search operator syntax | Same pattern as test 02 against `POST /v3/integration/payment/search`. `$gte` silently dropped (returns full unfiltered total of 3359). Bare `gte` correctly filters (0 for far-future, 221 for `2026-04-01`). |
| 07 — Subcontract field-name inconsistency | Across 10 live subcontract line items, `costCents` is the populated field on all 10. `wholesaleCostCents` is **not present** on any. **The inconsistency vs other line items is the real finding**: the [`Part` schema](https://shopmonkey.dev/schema/Part) and [`Tire` schema](https://shopmonkey.dev/schema/Tire) both still use `wholesaleCostCents`. Integration code that handles all line-item types uniformly silently sees `undefined` on subcontracts and falls through to a worse default. |

Per-test evidence with raw request logs is in `evidence/`.

## Validation notes

Before publishing, every claim above was checked two ways:

1. **Alternative syntax sweeps.** For each filter/sort claim we tested 5–8 alternative encodings against the live API to confirm we weren't using the wrong shape. This is what surfaced the `$gte` vs `gte` distinction (tests 02 and 06) and the `id`-sortable-but-`createdDate`-isn't asymmetry (test 03). The sweeps are reproduced as one-off probes during development; the committed tests assert the resulting findings.

2. **External corroboration / contradiction.** For each finding we searched the Shopmonkey developer site, support knowledge base, [`shopmonkeyus` GitHub org](https://github.com/shopmonkeyus) (especially the EDS streaming server), Reddit, Stack Overflow, and the broader web for prior reports or hints that we were holding the API wrong. Two consequences:
   - We **dropped** four findings from an earlier draft that had been resolved on the server side or were design-by-intent in the current docs (an equality filter on `customerId` that does work, `hasMore` correctly returning `false` past `meta.total`, services-not-nested in order responses, and field-name divergences that the current schema docs already match).
   - We **reframed** tests 02, 03, and 06 after sweeps showed our earlier characterization was too coarse.

## How to run

Requires Node ≥ 20.10 and a Shopmonkey API key (Bearer token from Settings → API).

```bash
git clone <this repo>
cd shopmonkey-api-quirks
cp .env.example .env       # paste your API key into .env
pnpm install
pnpm test:all              # runs all tests, writes evidence/<id>.json + summary.json
pnpm test:all -- --only 03-orderby-and-collate   # run a single test
pnpm list                  # list test ids
```

Each test pulls a small number of public records (orders, customers, payments) from your shop. The polite delay between requests is 250 ms (configurable via `REQUEST_DELAY_MS`). A full run is ~3–5 minutes (test 07 walks 800 orders to find subcontracts; tests 03 and 04 issue 8 and 4 calls respectively for the syntax sweeps).

## What the harness captures

For each test the runner writes `evidence/<id>.json` containing:

- The hypothesis being tested (what the docs imply *should* happen).
- A `verdict`: `CONFIRMED_BUG`, `NOT_REPRODUCED`, `INFORMATIONAL`, or `ERROR`.
- A short `summary` of the observed behavior.
- A structured `evidence` block with counts, intersections, inversions, key sets — whatever made the call.
- A complete `requests` log: method, path, query/body, HTTP status, response timing, and `meta.total` / `meta.hasMore` / `data.length` from each response.

PII (names, emails, phones, addresses, vehicle make/model/VIN, plate, mileage, free-text notes/descriptions) is replaced with `<redacted:N>` markers preserving only string length. UUIDs and ID-typed fields are replaced with stable salted hashes (`id:<12 hex>`) so cross-call comparisons (e.g., the Jaccard computation in test 01) remain meaningful without exposing real record IDs. The implementation is in `src/redact.ts` and runs over the entire payload before anything is written to disk.

The harness only ever issues `GET` requests, and one `POST` to `/v3/integration/payment/search` for test 06. It does not write to your shop.

## Layout

```
src/
  client.ts            # tiny fetch wrapper: rate limit, request log, no header logging
  redact.ts            # PII / ID scrubber applied before anything is written to disk
  runner.ts            # imports the test modules, runs them, writes evidence
  tests/
    01-non-determinism.ts
    02-where-range-operators.ts
    03-orderby-and-collate.ts
    04-offset-vs-skip.ts
    05-limit-clamp.ts
    06-payment-date-filter.ts
    07-subcontract-rename.ts
evidence/              # populated by `pnpm test:all` — one JSON file per test
.env.example
```

## Notes on issues not covered by the harness

A few things from our notes were intentionally excluded from automated tests:

- **Bulk export (`POST /v3/export` / `POST /v3/export/presigned_url`)**. The endpoint contract is documented at https://shopmonkey.dev/resources/export, but the page is marked **WIP** with the placeholder "A summary needs to be written for Export" and is not indexed by Google — `site:shopmonkey.dev export` returns nothing. The contract is enough to integrate against (we did), but the doc gives no guidance on freshness lag (we measure ~4–5 hours), no list of available `tables`, no parity statement against the REST schema, and no mention that soft-deleted rows are included. We'd love a real prose section. Not exercised in the harness because the export downloads several MB of full-shop data and would mostly duplicate what `/order` etc. already show.
- **Server-side timeouts / hung connections**. The shopmonkey.dev Overview page documents rate limits but no response-time SLA. We hit one indefinite hang during initial backfill in 2026-02 and added a 30 s client-side `AbortSignal.timeout` — that's been adequate since. Hard to test on demand, so left as a doc-and-discussion item.
- **Webhook trigger event types**. `/v3/webhook` is documented as a CRUD resource, but the list of available `triggers` (event types) and payload schemas isn't published. We didn't try to enumerate this in the harness.

## What we'd love to discuss

In rough order of impact:

1. **Stable, deterministic pagination.** Test 01 is the headline finding: even with `orderBy` on a sortable field (`id`) and a working `where` filter, identical paginated calls return mostly-disjoint result sets. Today partners build multi-pass scrapers with multiple sort strategies and post-hoc dedup to approximate completeness. A stable cursor token would let an integration finish a full sync in `O(total / 100)` calls instead of `O(total / 100 × passes)`.
2. **Document the `where` operator syntax.** Tests 02 and 06 show that bare-name operators (`gte`, `lte`) work but MongoDB-style `$`-prefixed operators are silently dropped. Most integrators reach for `$gte` first because it matches the convention of every other "any-shaped where" parameter we've seen. Either document the bare form, or accept both, or return a 400 on unknown operators — but silent ignore is the worst case.
3. **`orderBy` parity across fields.** Test 03 shows `orderBy={"id":"asc"}` works but `orderBy={"createdDate":"asc"}` is ignored. If only some fields are orderable, document which. Ideally every indexed field should be sortable.
4. **EDS (Enterprise Data Streaming) availability outside of HQ.** [`shopmonkeyus/eds`](https://github.com/shopmonkeyus/eds) would solve essentially every issue in this report — it's CDC, no pagination, no filtering. Today it's gated behind enterprise tier. Even read-only access at lower tiers would be transformative.
5. **Behavior when `limit > 100`.** Either return more rows or return a `400`. Silent clamping (test 05) is the surprising case.
6. **Subcontract field-name parity (test 07).** Either rename `Part.wholesaleCostCents` and `Tire.wholesaleCostCents` to `costCents` (breaking but symmetric), or rename `Subcontract.costCents` back to `wholesaleCostCents`. The current asymmetry means uniform line-item code silently sees `undefined`.
7. **Documented event triggers for `/v3/webhook`.** If we can webhook on order updates, we can avoid most polling.

We'd be happy to pair on any of these — or to be told we're holding the API wrong and pointed at the right knob.

## License

MIT. Use it, fork it, file issues.
