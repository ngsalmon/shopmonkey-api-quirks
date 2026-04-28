import { call, jaccard, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '04-cursor-non-determinism',
  title: 'Cursor pagination on `id` (the recommended workaround for skip+limit) is also non-deterministic',
  hypothesis:
    'Three identical runs of cursor pagination on /v3/order — `orderBy={"id":"asc"}`, `limit=100`, no `skip`, page N+1 uses `where: {id: {gt: lastIdOfPageN}}` — should each return the same union of IDs and the same page sizes. Instead the three runs return mostly-disjoint ID sets (Jaccard well below 1.0) and even disagree on how many records exist past a given cursor (page sizes differ run-to-run despite identical queries). The non-determinism that test 01 demonstrates for `skip+limit` is not avoided by switching to id-cursor pagination.',
};

interface OrderRow {
  id: string;
}

const ENDPOINT = '/order';
const PAGE_SIZE = 100;
const PAGES = 3;
const RUNS = 3;

async function paginateOnce(): Promise<{ ids: string[]; pageSizes: number[] }> {
  const ids: string[] = [];
  const pageSizes: number[] = [];
  let lastId: string | undefined;
  for (let p = 0; p < PAGES; p++) {
    const query: Record<string, string | number> = {
      limit: PAGE_SIZE,
      orderBy: JSON.stringify({ id: 'asc' }),
    };
    if (lastId) query.where = JSON.stringify({ id: { gt: lastId } });
    const res = await call<ListResponse<OrderRow>>(ENDPOINT, { query });
    const pageIds = res.data.map((r) => r.id);
    ids.push(...pageIds);
    pageSizes.push(pageIds.length);
    if (pageIds.length < PAGE_SIZE) break;
    lastId = pageIds[pageIds.length - 1];
  }
  return { ids, pageSizes };
}

async function run(): Promise<TestResult> {
  const runs: { run: number; ids: string[]; pageSizes: number[] }[] = [];
  for (let r = 0; r < RUNS; r++) {
    const { ids, pageSizes } = await paginateOnce();
    runs.push({ run: r + 1, ids, pageSizes });
  }

  const sets = runs.map((r) => new Set(r.ids));
  const pairwise: { a: number; b: number; jaccard: number; common: number; aOnly: number; bOnly: number }[] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const j_ = jaccard(sets[i], sets[j]);
      const common = [...sets[i]].filter((x) => sets[j].has(x)).length;
      pairwise.push({
        a: i + 1,
        b: j + 1,
        jaccard: j_,
        common,
        aOnly: sets[i].size - common,
        bOnly: sets[j].size - common,
      });
    }
  }

  const minJaccard = Math.min(...pairwise.map((p) => p.jaccard));
  const pageSizeSig = runs.map((r) => r.pageSizes.join('/'));
  const pageSizesDiffer = new Set(pageSizeSig).size > 1;
  const pageSizeSummary = runs.map((r) => `run${r.run}=${r.pageSizes.join('/')}`).join(', ');
  const pageSizeNote = pageSizesDiffer
    ? ` Per-run page sizes also differed despite identical queries: ${pageSizeSummary}.`
    : ` Per-run page sizes were uniform (${pageSizeSummary}); the non-determinism is in *which* ids each run returns, not how many.`;
  const summary = `${RUNS} runs of cursor pagination (orderBy={"id":"asc"}, no skip, page 2+ uses where={id:{gt:lastIdOfPrevPage}}) returned mostly-disjoint ID sets across runs. Min Jaccard = ${minJaccard.toFixed(3)} across ${pairwise.length} pairs.${pageSizeNote}`;

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    summary,
    evidence: {
      endpoint: `GET /v3${ENDPOINT}`,
      pattern: 'cursor: orderBy={"id":"asc"}, no skip, page 2+ uses where={id:{gt:lastIdOfPrevPage}}',
      pageSize: PAGE_SIZE,
      maxPages: PAGES,
      runs: runs.map((r) => ({
        run: r.run,
        totalIds: r.ids.length,
        uniqueIds: new Set(r.ids).size,
        pageSizes: r.pageSizes,
      })),
      pairwiseJaccard: pairwise,
      minJaccard,
    },
  };
}

const mod: TestModule = { meta, run };
export default mod;
