import { call, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '06-hasmore-past-total',
  title: '`meta.hasMore` returns `true` when skip exceeds `meta.total`',
  hypothesis:
    'When skip is set above meta.total, the response should have meta.hasMore=false. Instead the API returns hasMore=true with empty or near-empty data, which causes infinite pagination loops if hasMore is the only termination signal.',
};

interface Order {
  id: string;
}

async function run(): Promise<TestResult> {
  const probe = await call<ListResponse<Order>>('/order', { query: { limit: 1, skip: 0 } });
  const total = probe.meta.total;
  if (typeof total !== 'number') {
    return {
      id: meta.id,
      title: meta.title,
      hypothesis: meta.hypothesis,
      verdict: 'ERROR',
      summary: 'meta.total not present on probe response; cannot test.',
      evidence: { meta: probe.meta },
    };
  }

  const skip = total + 1000;
  const past = await call<ListResponse<Order>>('/order', { query: { limit: 100, skip } });

  const dataLen = past.data.length;
  const hasMore = past.meta.hasMore;
  const verdict = hasMore === true && dataLen === 0 ? 'CONFIRMED_BUG' : 'NOT_REPRODUCED';
  const summary =
    verdict === 'CONFIRMED_BUG'
      ? `Probe meta.total=${total}. Querying skip=${skip} returned 0 rows but meta.hasMore=true.`
      : `Probe meta.total=${total}. skip=${skip} returned ${dataLen} rows, hasMore=${hasMore}.`;

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    verdict,
    summary,
    evidence: {
      endpoint: 'GET /v3/order',
      probe: { metaTotal: total, metaHasMore: probe.meta.hasMore },
      pastEnd: {
        query: { limit: 100, skip },
        dataLength: dataLen,
        metaTotal: past.meta.total,
        metaHasMore: past.meta.hasMore,
      },
    },
  };
}

const mod: TestModule = { meta, run };
export default mod;
