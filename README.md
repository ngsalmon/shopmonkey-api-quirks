# shopmonkey-api-quirks

A small, reproducible test harness that demonstrates three behaviors in the Shopmonkey REST API (`https://api.shopmonkey.cloud/v3`) that diverge from what the public docs at https://shopmonkey.dev/ imply.

Assembled by an integration partner running a production sync. Every claim ships with the exact request that produced it, the response counts, and the data we drew the conclusion from. The harness is intentionally minimal: TypeScript, fetch, no test framework. Each test is one short file under `src/tests/`.

## What's in here

| Test | What it shows |
|---|---|
| 01 — Non-determinism with sort + filter | 5 identical `GET /v3/order` calls — same `skip`, same `limit`, `orderBy={"id":"asc"}` *(test 02 confirms this is the one orderBy form that works)*, and a working `where={"createdDate":{"gte":...}}` filter — return **5 mostly-disjoint sets**. Min Jaccard close to 0 across pairs. With both a working sort and a working filter applied, identical paginated calls still produce different result sets. |
| 02 — `orderBy` honored on `id`, ignored on date fields | `orderBy={"id":"asc"}` produces 1–5 alphabetic inversions out of 49 (effectively sorted). The same syntax on `createdDate` produces ≥21/49 inversions; on `updatedDate` ≥21/49. We tested 8 alternative encodings (string forms, hyphen-prefix, JSON `1/-1`, array shapes); none sort the date fields. So this isn't a syntax issue — date fields simply aren't orderable through this endpoint. This matters: incremental sync naturally wants `updatedDate` ordering. |
| 03 — `limit` silently clamped above 100 | The order resource page documents `limit` as type `number` with no maximum. Values from 1 to 100 return exactly that count (`limit=1→1`, `limit=99→99`, `limit=100→100`). `limit=101+` silently clamps to 100 — no `4xx`, no warning header. The cap itself isn't documented anywhere. |

Per-test evidence with raw request logs is in `evidence/`.

## Notes on what didn't make the cut

We started with a longer list of suspected issues. After validating each one with alternative-syntax sweeps and external corroboration, we dropped findings that were either documentation gaps or partner misuse rather than API bugs:

- **`where` operator syntax** — bare `gte` / `lte` work; MongoDB-style `$gte` is silently dropped. The docs are silent on which to use (zero examples in any resource page; `where` is typed as `any`). That's a doc gap, not a bug — captured below in "What we'd love to discuss."
- **`offset` vs `skip`** — `skip` is now uniform across resource pages and works correctly; `offset` was never documented. Not a bug.
- **`hasMore` past `meta.total`** — now correctly returns `false`. Looks fixed since 2026-02.
- **Services not nested in order responses** — confirmed-by-design in current public docs.
- **Subcontract field naming** — there's a real asymmetry (Subcontract uses `costCents`, Part/Tire still use `wholesaleCostCents`), but it's a doc/schema-design question rather than a bug to demonstrate.

## How to run

Requires Node ≥ 20.10 and a Shopmonkey API key (Bearer token from Settings → API).

```bash
git clone <this repo>
cd shopmonkey-api-quirks
cp .env.example .env       # paste your API key into .env
pnpm install
pnpm test:all              # runs all tests, writes evidence/<id>.json + summary.json
pnpm test:all -- --only 02-orderby-and-collate   # run a single test
pnpm list                  # list test ids
```

The polite delay between requests is 250 ms (configurable via `REQUEST_DELAY_MS`). A full run is ~1 minute.

## What the harness captures

For each test the runner writes `evidence/<id>.json` containing:

- The hypothesis being tested (what the docs imply *should* happen).
- A short `summary` of the observed behavior.
- A structured `evidence` block with counts, intersections, inversions, etc. — whatever made the call.
- A complete `requests` log: method, path, query/body, HTTP status, response timing, and `meta.total` / `meta.hasMore` / `data.length` from each response.

PII (names, emails, phones, addresses, vehicle make/model/VIN, plate, mileage, free-text notes/descriptions) is replaced with `<redacted:N>` markers preserving only string length. UUIDs and ID-typed fields are replaced with stable salted hashes (`id:<12 hex>`) so cross-call comparisons (e.g., the Jaccard computation in test 01) remain meaningful without exposing real record IDs. The implementation is in `src/redact.ts` and runs over the entire payload before anything is written to disk.

The harness only ever issues `GET` requests. It does not write to your shop.

## Layout

```
src/
  client.ts            # tiny fetch wrapper: rate limit, request log, no header logging
  redact.ts            # PII / ID scrubber applied before anything is written to disk
  runner.ts            # imports the test modules, runs them, writes evidence
  tests/
    01-non-determinism.ts
    02-orderby-and-collate.ts
    03-limit-clamp.ts
evidence/              # populated by `pnpm test:all` — one JSON file per test
.env.example
```

## What we'd love to discuss

In rough order of impact:

1. **Stable, deterministic pagination.** Test 01 is the headline finding: even with `orderBy` on a sortable field (`id`) and a working `where` filter, identical paginated calls return mostly-disjoint result sets. Today partners build multi-pass scrapers with multiple sort strategies and post-hoc dedup to approximate completeness. A stable cursor token would let an integration finish a full sync in `O(total / 100)` calls instead of `O(total / 100 × passes)`.
2. **`orderBy` parity across fields.** Test 02 shows `orderBy={"id":"asc"}` works but `orderBy={"createdDate":"asc"}` and `orderBy={"updatedDate":"asc"}` are ignored. Incremental sync naturally wants `updatedDate` ordering; without it the only safe strategy is full-table walks. If only some fields are orderable, document which.
3. **Document the `where` operator syntax.** No resource page mentions any operator. Through experimentation we found that bare-name operators work (`{"createdDate":{"gte":"..."}}`) and MongoDB-style `$`-prefixed operators are silently dropped. Most integrators reach for `$gte` first because that's the convention everywhere else. Either document the bare form, accept both, or return a `400` on unknown operators — silent ignore is the worst case.
4. **Behavior when `limit > 100`.** The doc says `limit` is type `number` with no maximum, and values 1–100 work as documented. Above 100 silently clamps. Either honor the requested value, return a `400`, or document the cap — silent clamping is the surprising case.
5. **`orderBy` parameter name case discrepancy.** The order resource page renders the parameter name as lowercase `orderby`, but the API only accepts camelCase `orderBy` — sending `orderby` returns `400 Bad Request`. Looks like a docs lowercasing bug; the actual contract is fine.
6. **EDS (Enterprise Data Streaming) availability outside of HQ.** [`shopmonkeyus/eds`](https://github.com/shopmonkeyus/eds) would solve essentially every issue in this report — it's CDC, no pagination, no filtering. Today it's gated behind enterprise tier. Even read-only access at lower tiers would be transformative.
7. **Bulk export endpoint docs.** [`shopmonkey.dev/resources/export`](https://shopmonkey.dev/resources/export) is marked WIP with no prose summary, no list of available `tables`, no parity statement against the REST schema, and no mention of freshness lag or that soft-deleted rows are included. We've integrated against it successfully but the doc is thin.
8. **Documented event triggers for `/v3/webhook`.** If we can webhook on order updates, we can avoid most polling.

We'd be happy to pair on any of these — or to be told we're holding the API wrong and pointed at the right knob.

## License

MIT. Use it, fork it, file issues.
