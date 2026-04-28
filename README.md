# shopmonkey-api-quirks

A small, reproducible test harness that demonstrates six behaviors in the Shopmonkey REST API (`https://api.shopmonkey.cloud/v3`) that diverge from what the public docs at https://shopmonkey.dev/ imply.

Assembled by an integration partner running a production sync. Every claim ships with the exact request that produced it, the response counts, and the data we drew the conclusion from. The harness is intentionally minimal: TypeScript, fetch, no test framework. Each test is one short file under `src/tests/`.

## Bugs (with reproduction tests)

| Test | What it shows |
|---|---|
| 01 — Non-determinism with sort + filter | 5 identical `GET /v3/order` calls — same `skip`, same `limit`, `orderBy={"id":"asc"}` *(test 02 confirms this is the one orderBy form that works)*, and a working `where={"createdDate":{"gte":...}}` filter — return **5 mostly-disjoint sets**. Min Jaccard close to 0 across pairs. With both a working sort and a working filter applied, identical paginated calls still produce different result sets. |
| 02 — `orderBy` honored on `id`, ignored on date fields | `orderBy={"id":"asc"}` produces 1–5 alphabetic inversions out of 49 (effectively sorted). The same syntax on `createdDate` produces ≥21/49 inversions; on `updatedDate` ≥21/49. We tested 8 alternative encodings (string forms, hyphen-prefix, JSON `1/-1`, array shapes); none sort the date fields. So this isn't a syntax issue — date fields simply aren't orderable through this endpoint. |
| 03 — `limit` silently clamped above 100 | The order resource page documents `limit` as type `number` with no maximum. Values 1–100 return exactly that count (`limit=1→1`, `limit=99→99`, `limit=100→100`). `limit=101+` silently clamps to 100 — no `4xx`, no warning header. The cap itself isn't documented anywhere. |
| 04 — Cursor pagination on `id` is also non-deterministic | The recommended workaround for test 01 is cursor-based pagination on `id` (drop `skip`, keep `orderBy={"id":"asc"}`, page N+1 uses `where: {id: {gt: lastIdOfPageN}}`). Three identical runs of that pattern over 3 pages of 100 return **mostly-disjoint ID sets** — pairwise Jaccard ≈ 0.05–0.20 across runs. Some runs also disagree on how many records exist past a given cursor (page sizes vary), though not in every run. Whatever underlies test 01 affects cursor pagination too. |
| 05 — Cursor pagination returns duplicate IDs across pages within a single run | With `orderBy={"id":"asc"}` and each page filtered by `where: {id: {gt: lastIdOfPreviousPage}}`, no ID can correctly appear in more than one page of the same run — the next page's filter excludes everything ≤ the cursor. We observe within-run duplicates anyway (same id returned in page N and a later page). The returned IDs **do** all satisfy `id > cursor` — the `gt` filter itself is honored — which narrows the root cause: `orderBy={"id":"asc"}` is not producing a strict total order, so the last id of page N is not always the maximum, and page N+1's `id > lastId` legitimately readmits ids that already appeared. Either way, safe cursor pagination is not achievable here today. |
| 06 — Even strictly correct (MAX-id) cursor pagination drops records non-deterministically | The obvious fix to test 05 is to compute the MAX id of each page client-side and use that as the cursor — by construction this gives zero within-run duplicates. We tested it. Three identical runs against a bounded universe (`createdDate >= 2026-04-15`) produced 0 within-run dups (good) but each run returned only ~100 ids while the union across runs was 170+ — the smallest run **missed 41% of the records that exist**. Pagination exits early after page 1 (page 2 routinely returns 0–5 records), even though across runs we can prove the universe holds substantially more. The API non-deterministically picks ~100 ids from a larger universe and signals "no more results"; no client-side pagination strategy can recover the dropped records on its own. |

Per-test evidence with raw request logs is in `evidence/`.

## Documentation issues (not exercised by tests)

- **`where` operator syntax is undocumented.** No resource page lists any operator examples — `where` is typed as `any`. Empirically, bare-name operators work (`{"createdDate":{"gte":"..."}}`) and MongoDB-style `$`-prefixed operators are silently dropped. Most integrators reach for `$gte` first because that's the convention elsewhere. Documenting the bare form, accepting both, or returning a `400` on unknown operators would prevent the silent-ignore footgun.
- **`orderBy` parameter name case mismatch.** The order resource page renders the parameter name as lowercase `orderby`, but the API only accepts camelCase `orderBy` — sending `orderby` returns `400 Bad Request`. Looks like a docs lowercasing bug; the contract itself is fine.
- **`limit` cap not documented.** Tied to test 03 above — the cap exists and is consistently 100, but isn't mentioned anywhere in the resource pages.

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
    04-cursor-non-determinism.ts
    05-cursor-within-run-duplicates.ts
    06-max-cursor-coverage.ts
evidence/              # populated by `pnpm test:all` — one JSON file per test
.env.example
```

## License

MIT. Use it, fork it, file issues.
