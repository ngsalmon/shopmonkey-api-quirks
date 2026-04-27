import { call, jaccard, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '01-non-determinism',
  title: 'REST list endpoints return non-deterministic results across identical calls — even with `orderBy` on a sortable field and a `gte` filter',
  hypothesis:
    'Five identical GET /v3/order calls with the same skip/limit, an `orderBy={"id":"asc"}` clause (which test 02 confirms is the one orderBy form that is honored), and a `where={"createdDate":{"gte":...}}` filter should return the same 100 IDs every time. Instead the result sets are mostly disjoint (Jaccard < 1.0 across pairs). Pagination is unstable even when sort and filter both work.',
};

interface OrderRow {
  id: string;
}

const ENDPOINT = '/order';
const QUERY = {
  limit: 100,
  skip: 200,
  orderBy: JSON.stringify({ id: 'asc' }),
  where: JSON.stringify({ createdDate: { gte: '2025-01-01T00:00:00Z' } }),
};
const PASSES = 5;

async function run(): Promise<TestResult> {
  const results: { call: number; ids: string[] }[] = [];
  for (let i = 0; i < PASSES; i++) {
    const res = await call<ListResponse<OrderRow>>(ENDPOINT, { query: QUERY });
    results.push({ call: i + 1, ids: res.data.map((r) => r.id) });
  }

  const sets = results.map((r) => new Set(r.ids));
  const pairwise: { a: number; b: number; jaccard: number; aOnly: number; bOnly: number; common: number }[] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const j_ = jaccard(sets[i], sets[j]);
      const common = [...sets[i]].filter((x) => sets[j].has(x)).length;
      const aOnly = sets[i].size - common;
      const bOnly = sets[j].size - common;
      pairwise.push({ a: i + 1, b: j + 1, jaccard: j_, aOnly, bOnly, common });
    }
  }

  const minJaccard = Math.min(...pairwise.map((p) => p.jaccard));
  const summary = `Min Jaccard across ${pairwise.length} pairs = ${minJaccard.toFixed(3)} (1.0 means identical sets). Identical calls — same skip/limit, working orderBy on id, working \`gte\` filter on createdDate — returned different ID sets.`;

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    summary,
    evidence: {
      endpoint: `GET /v3${ENDPOINT}`,
      query: QUERY,
      passes: PASSES,
      perCallCounts: results.map((r) => ({ call: r.call, count: r.ids.length })),
      pairwiseJaccard: pairwise,
      minJaccard,
    },
  };
}

const mod: TestModule = { meta, run };
export default mod;
