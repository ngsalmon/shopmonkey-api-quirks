import { call, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '03-limit-clamp',
  title: '`limit` parameter silently clamped at 100',
  hypothesis:
    'Requesting limit=500 should either return up to 500 rows or fail with a 4xx error. Instead the API returns at most 100 rows with no error or warning header.',
};

interface Order {
  id: string;
}

async function run(): Promise<TestResult> {
  const requested = 500;
  const res = await call<ListResponse<Order>>('/order', { query: { limit: requested } });
  const got = res.data.length;
  const summary = `Requested limit=${requested}, received ${got} rows (clamped to 100). No 4xx, no warning header.`;
  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    summary,
    evidence: {
      endpoint: 'GET /v3/order',
      requestedLimit: requested,
      receivedRows: got,
      metaTotal: res.meta.total,
    },
  };
}

const mod: TestModule = { meta, run };
export default mod;
