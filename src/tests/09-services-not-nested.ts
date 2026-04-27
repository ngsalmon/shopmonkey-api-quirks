import { call, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '09-services-not-nested',
  title: 'Order responses do not include services (N+1 sync pattern required)',
  hypothesis:
    'Both GET /v3/order (list) and GET /v3/order/:id (detail) omit the services array. Pulling services for N orders requires N additional round-trips. Confirmed by current public schema (intentional design); this test captures it as evidence of the workload it imposes.',
};

interface Order {
  id: string;
  services?: unknown;
}

async function run(): Promise<TestResult> {
  const list = await call<ListResponse<Order>>('/order', { query: { limit: 5 } });
  const sample = list.data[0];
  if (!sample) {
    return {
      id: meta.id,
      title: meta.title,
      hypothesis: meta.hypothesis,
      verdict: 'ERROR',
      summary: 'No orders returned to sample.',
      evidence: {},
    };
  }
  const detail = await call<{ data: Order }>(`/order/${sample.id}`);
  const listHasServices = list.data.some((o) => Array.isArray((o as Order).services));
  const detailHasServices = Array.isArray(detail.data.services);
  const services = await call<{ data: unknown[] }>(`/order/${sample.id}/service`);
  const serviceCount = services.data?.length ?? 0;

  const verdict = listHasServices || detailHasServices ? 'NOT_REPRODUCED' : 'INFORMATIONAL';
  const summary =
    verdict === 'INFORMATIONAL'
      ? `List response lacks services. Detail response lacks services. Sample order has ${serviceCount} services fetched via separate /service call. For N orders with services, N+1 round-trips required.`
      : 'Order response unexpectedly contained services.';

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    verdict,
    summary,
    evidence: {
      endpoints: ['GET /v3/order', 'GET /v3/order/:id', 'GET /v3/order/:id/service'],
      listResponseTopKeys: Object.keys(list.data[0] ?? {}),
      detailResponseTopKeys: Object.keys(detail.data ?? {}),
      sampleServiceCount: serviceCount,
      listResponseHasServicesKey: 'services' in (list.data[0] ?? {}),
      detailResponseHasServicesKey: 'services' in (detail.data ?? {}),
    },
  };
}

const mod: TestModule = { meta, run };
export default mod;
