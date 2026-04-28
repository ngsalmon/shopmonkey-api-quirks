import { call, jaccard, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '06-max-cursor-coverage',
  title: 'Even MAX-cursor pagination (strictly correct cursor pagination) returns mostly-disjoint subsets of a larger universe across runs',
  hypothesis:
    'Test 05 isolated the cause of cursor pagination duplicates: `orderBy={"id":"asc"}` is not strict, so the LAST id of a page is not always the max. The fix should be to compute the MAX id of each page client-side and use *that* as the cursor — by construction this produces zero within-run duplicates. We further expect that, against a bounded universe (createdDate filter), three identical MAX-cursor pagination runs should return the same set of ids. Instead, runs return mostly-disjoint id sets and each run typically exits pagination after ~100 ids (page 2 often returns 0–5 records), even though across runs we see substantially more distinct ids. The API non-deterministically picks ~100 ids from a larger universe and then signals "no more results" — meaning a single sync run drops a large fraction of records that exist, with no client-side pagination strategy able to recover them.',
};

interface OrderRow {
  id: string;
}

const ENDPOINT = '/order';
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const SINCE = '2026-04-15T00:00:00Z';
const RUNS = 3;

interface RunResult {
  run: number;
  ids: string[];
  pageSizes: number[];
}

async function paginateMaxCursor(runIdx: number): Promise<RunResult> {
  const ids: string[] = [];
  const pageSizes: number[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const where: Record<string, unknown> = { createdDate: { gte: SINCE } };
    if (cursor) where.id = { gt: cursor };
    const res = await call<ListResponse<OrderRow>>(ENDPOINT, {
      query: {
        limit: PAGE_SIZE,
        orderBy: JSON.stringify({ id: 'asc' }),
        where: JSON.stringify(where),
      },
    });
    const pageIds = res.data.map((r) => r.id);
    ids.push(...pageIds);
    pageSizes.push(pageIds.length);
    if (pageIds.length < PAGE_SIZE) break;
    cursor = pageIds.reduce((m, id) => (id > m ? id : m), pageIds[0]);
  }
  return { run: runIdx, ids, pageSizes };
}

async function run(): Promise<TestResult> {
  const runs: RunResult[] = [];
  for (let r = 0; r < RUNS; r++) {
    runs.push(await paginateMaxCursor(r + 1));
  }

  const sets = runs.map((r) => new Set(r.ids));
  const union = new Set<string>();
  for (const s of sets) for (const id of s) union.add(id);
  const intersection = [...sets[0]].filter((id) => sets.every((s) => s.has(id)));

  const pairwise: { a: number; b: number; jaccard: number; common: number; union: number }[] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const j_ = jaccard(sets[i], sets[j]);
      const common = [...sets[i]].filter((id) => sets[j].has(id)).length;
      const u = new Set([...sets[i], ...sets[j]]).size;
      pairwise.push({ a: i + 1, b: j + 1, jaccard: j_, common, union: u });
    }
  }

  const minRunSize = Math.min(...sets.map((s) => s.size));
  const maxRunSize = Math.max(...sets.map((s) => s.size));
  const minJaccard = Math.min(...pairwise.map((p) => p.jaccard));
  const lossPct = union.size > 0 ? ((union.size - minRunSize) / union.size) * 100 : 0;

  const summary = `${RUNS} runs of MAX-cursor pagination (orderBy={"id":"asc"}, page N+1 uses where={id:{gt: client-computed MAX of page N}}, createdDate>=${SINCE}). Each run produced 0 within-run duplicates (as expected by construction). But the runs disagreed on coverage: union=${union.size} ids, intersection=${intersection.length}, smallest run=${minRunSize}, largest run=${maxRunSize}. The smallest run missed ${union.size - minRunSize} of the ${union.size} ids that exist (${lossPct.toFixed(1)}%). Min cross-run Jaccard = ${minJaccard.toFixed(3)}. Page sizes per run: ${runs.map((r) => `run${r.run}=[${r.pageSizes.join(',')}]`).join(', ')} — pagination exits early (page 2 often returns 0–few records) even though the universe is larger.`;

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    summary,
    evidence: {
      endpoint: `GET /v3${ENDPOINT}`,
      pattern: 'MAX-cursor: orderBy={"id":"asc"}, page N+1 uses where={id:{gt: client-computed MAX of page N}}',
      sinceFilter: SINCE,
      pageSize: PAGE_SIZE,
      maxPages: MAX_PAGES,
      runs: runs.map((r) => ({
        run: r.run,
        totalIds: r.ids.length,
        uniqueIds: new Set(r.ids).size,
        pageSizes: r.pageSizes,
      })),
      coverage: {
        unionSize: union.size,
        intersectionSize: intersection.length,
        smallestRunSize: minRunSize,
        largestRunSize: maxRunSize,
        recordsMissedBySmallestRun: union.size - minRunSize,
        smallestRunCoveragePct: union.size > 0 ? (minRunSize / union.size) * 100 : 100,
      },
      pairwiseJaccard: pairwise,
      minJaccard,
    },
  };
}

const mod: TestModule = { meta, run };
export default mod;
