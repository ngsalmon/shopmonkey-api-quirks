import { call, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '03-equality-filters',
  title: 'Non-status equality filters silently ignored',
  hypothesis:
    'Only `where: { status: "..." }` is honored server-side. Other documented field equalities (e.g., on Customer.id) are silently dropped.',
};

interface Order {
  id: string;
  customerId?: string | null;
  status?: string;
}

async function run(): Promise<TestResult> {
  const seed = await call<ListResponse<Order>>('/order', { query: { limit: 50 } });
  const sampleCustomerId = seed.data.find((o) => o.customerId)?.customerId;
  if (!sampleCustomerId) {
    return {
      id: meta.id,
      title: meta.title,
      hypothesis: meta.hypothesis,
      verdict: 'ERROR',
      summary: 'Could not find an order with a customerId in the first page; cannot construct equality filter.',
      evidence: { sampleSize: seed.data.length },
    };
  }

  const filtered = await call<ListResponse<Order>>('/order', {
    query: { limit: 100, where: JSON.stringify({ customerId: sampleCustomerId }) },
  });

  const allMatch = filtered.data.every((o) => o.customerId === sampleCustomerId);
  const baselineUnique = new Set(seed.data.map((o) => o.customerId)).size;

  const verdict = allMatch
    ? 'NOT_REPRODUCED'
    : filtered.data.length > 0
      ? 'CONFIRMED_BUG'
      : 'NOT_REPRODUCED';
  const summary = allMatch
    ? `customerId equality filter honored — all ${filtered.data.length} returned rows match.`
    : `customerId equality filter ignored — returned ${filtered.data.length} rows but only ${
        filtered.data.filter((o) => o.customerId === sampleCustomerId).length
      } matched. Baseline first page contained ${baselineUnique} distinct customerIds.`;

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    verdict,
    summary,
    evidence: {
      endpoint: 'GET /v3/order',
      filter: { customerId: sampleCustomerId },
      filteredDataLength: filtered.data.length,
      filteredMatchingTarget: filtered.data.filter((o) => o.customerId === sampleCustomerId).length,
      filteredMetaTotal: filtered.meta.total,
      baselineDistinctCustomerIds: baselineUnique,
    },
  };
}

const mod: TestModule = { meta, run };
export default mod;
