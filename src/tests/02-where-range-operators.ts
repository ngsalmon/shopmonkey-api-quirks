import { call, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '02-where-range-operators',
  title: '`where` range operators ($gte, $lte) silently ignored on list endpoints',
  hypothesis:
    'A `where` clause with $gte set to a far-future date should return zero records. Instead the API returns the same record count as an unfiltered call.',
};

const FAR_FUTURE = '2099-01-01T00:00:00Z';
const FAR_PAST_GTE = { createdDate: { $gte: FAR_FUTURE } };

async function listOrders(query: Record<string, string | number>) {
  return call<ListResponse<{ id: string; createdDate?: string }>>('/order', { query });
}

async function run(): Promise<TestResult> {
  const baseline = await listOrders({ limit: 100 });
  const filtered = await listOrders({ limit: 100, where: JSON.stringify(FAR_PAST_GTE) });

  const baselineCount = baseline.data.length;
  const filteredCount = filtered.data.length;
  const baselineTotal = baseline.meta.total;
  const filteredTotal = filtered.meta.total;

  const filterHonored = filteredCount === 0 || filteredTotal === 0;
  const verdict = filterHonored ? 'NOT_REPRODUCED' : 'CONFIRMED_BUG';
  const summary = filterHonored
    ? `Future-date $gte filter returned 0 records — filter appears honored.`
    : `Future-date $gte filter returned ${filteredCount} rows (meta.total=${filteredTotal}); unfiltered returned ${baselineCount} rows (meta.total=${baselineTotal}). Filter ignored.`;

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    verdict,
    summary,
    evidence: {
      endpoint: 'GET /v3/order',
      baseline: { query: { limit: 100 }, dataLength: baselineCount, metaTotal: baselineTotal },
      filtered: {
        query: { limit: 100, where: FAR_PAST_GTE },
        dataLength: filteredCount,
        metaTotal: filteredTotal,
      },
    },
  };
}

const mod: TestModule = { meta, run };
export default mod;
