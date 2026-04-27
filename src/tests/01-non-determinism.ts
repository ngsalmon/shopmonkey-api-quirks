import { call, jaccard, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '01-non-determinism',
  title: 'REST list endpoints return non-deterministic results across identical calls',
  hypothesis:
    'Five identical GET /v3/order calls with the same skip/limit/orderBy return overlapping but different ID sets (Jaccard < 1.0).',
};

interface OrderRow {
  id: string;
}

const ENDPOINT = '/order';
const QUERY = { limit: 100, skip: 200, orderBy: JSON.stringify({ createdDate: 'desc' }) };
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
  const verdict = minJaccard < 1 ? 'CONFIRMED_BUG' : 'NOT_REPRODUCED';
  const summary =
    verdict === 'CONFIRMED_BUG'
      ? `Min Jaccard across ${pairwise.length} pairs = ${minJaccard.toFixed(3)} (1.0 means identical sets). Identical calls returned different IDs.`
      : `All ${PASSES} calls returned identical ID sets (Jaccard = 1.0).`;

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    verdict,
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
