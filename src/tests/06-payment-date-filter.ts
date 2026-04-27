import { call, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '06-payment-date-filter',
  title: 'POST /integration/payment/search — `$gte` silently ignored, `gte` honored',
  hypothesis:
    'Same as test 02 but for the documented payment search endpoint. The MongoDB-style `$gte` operator is silently dropped; the bare `gte` form filters correctly. Neither syntax is documented.',
};

interface Payment {
  id: string;
  createdDate?: string;
}

const FUTURE = '2099-01-01T00:00:00Z';
const RECENT = '2026-04-01T00:00:00Z';

async function searchPayments(body: Record<string, unknown>) {
  return call<ListResponse<Payment>>('/integration/payment/search', { method: 'POST', body });
}

async function run(): Promise<TestResult> {
  const baseline = await searchPayments({ limit: 100 });
  const dollar = await searchPayments({ limit: 100, where: { createdDate: { $gte: FUTURE } } });
  const bareFuture = await searchPayments({ limit: 100, where: { createdDate: { gte: FUTURE } } });
  const bareRecent = await searchPayments({ limit: 100, where: { createdDate: { gte: RECENT } } });

  const baselineTotal = baseline.meta.total ?? 0;
  const dollarTotal = dollar.meta.total ?? 0;
  const bareFutureTotal = bareFuture.meta.total ?? 0;
  const bareRecentTotal = bareRecent.meta.total ?? 0;

  const dollarIgnored = dollarTotal === baselineTotal;
  const bareWorks = bareFutureTotal === 0 && bareRecentTotal > 0 && bareRecentTotal < baselineTotal;

  let verdict: TestResult['verdict'] = 'INFORMATIONAL';
  let summary = '';
  if (dollarIgnored && bareWorks) {
    verdict = 'CONFIRMED_BUG';
    summary = `\`$gte\` is silently dropped (total ${dollarTotal} = baseline ${baselineTotal}); bare \`gte\` correctly returns 0 for far-future and ${bareRecentTotal} for ${RECENT}. Same silent-ignore pattern as test 02.`;
  } else {
    summary = `$gte total=${dollarTotal}, gte future=${bareFutureTotal}, gte recent=${bareRecentTotal}, baseline=${baselineTotal}.`;
    verdict = bareFutureTotal === 0 ? 'CONFIRMED_BUG' : 'NOT_REPRODUCED';
  }

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    verdict,
    summary,
    evidence: {
      endpoint: 'POST /v3/integration/payment/search',
      baseline: { metaTotal: baselineTotal },
      dollarPrefix: { body: { where: { createdDate: { $gte: FUTURE } } }, metaTotal: dollarTotal },
      barePrefixFuture: { body: { where: { createdDate: { gte: FUTURE } } }, metaTotal: bareFutureTotal },
      barePrefixRecent: { body: { where: { createdDate: { gte: RECENT } } }, metaTotal: bareRecentTotal },
    },
  };
}

const mod: TestModule = { meta, run };
export default mod;
