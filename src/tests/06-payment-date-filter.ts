import { call, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '06-payment-date-filter',
  title: 'POST /integration/payment/search ignores `createdDate.$gte` filter',
  hypothesis:
    'Posting where={createdDate:{$gte:"2099-01-01"}} should return zero payments. Instead the endpoint returns the same payments as an unfiltered search.',
};

interface Payment {
  id: string;
  createdDate?: string;
}

const FUTURE = '2099-01-01T00:00:00Z';

async function searchPayments(body: Record<string, unknown>) {
  return call<ListResponse<Payment>>('/integration/payment/search', { method: 'POST', body });
}

async function run(): Promise<TestResult> {
  const baseline = await searchPayments({ limit: 100 });
  const filtered = await searchPayments({ limit: 100, where: { createdDate: { $gte: FUTURE } } });

  const baselineLen = baseline.data.length;
  const filteredLen = filtered.data.length;
  const baselineTotal = baseline.meta.total;
  const filteredTotal = filtered.meta.total;

  const filterHonored = filteredLen === 0 || filteredTotal === 0;
  const verdict = filterHonored ? 'NOT_REPRODUCED' : 'CONFIRMED_BUG';
  const summary = filterHonored
    ? 'Future-date filter produced 0 results — appears honored.'
    : `Future-date filter returned ${filteredLen} rows (meta.total=${filteredTotal}); baseline returned ${baselineLen} (meta.total=${baselineTotal}). Filter ignored.`;

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    verdict,
    summary,
    evidence: {
      endpoint: 'POST /v3/integration/payment/search',
      baseline: { body: { limit: 100 }, dataLength: baselineLen, metaTotal: baselineTotal },
      filtered: {
        body: { limit: 100, where: { createdDate: { $gte: FUTURE } } },
        dataLength: filteredLen,
        metaTotal: filteredTotal,
      },
    },
  };
}

const mod: TestModule = { meta, run };
export default mod;
