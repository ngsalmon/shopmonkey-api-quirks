import { call, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '10-field-divergence',
  title: 'Documented schema field names confirmed in live responses',
  hypothesis:
    'Field names that historically diverged from older docs are now matched in current docs. This test captures live response samples confirming: services use `labors` (plural), parts expose retail/wholesale split, canned-service ref is `sourceServiceId`, orders carry generatedCustomerName / generatedVehicleName, labors carry both shop-cost (costRateCents/costHours) and bill-rate (rateCents/hours).',
};

interface Order {
  id: string;
  generatedCustomerName?: string | null;
  generatedVehicleName?: string | null;
}

interface Service {
  id: string;
  sourceServiceId?: string | null;
  labors?: Array<Record<string, unknown>>;
  parts?: Array<Record<string, unknown>>;
}

async function run(): Promise<TestResult> {
  const orders = await call<ListResponse<Order>>('/order', { query: { limit: 50 } });
  const observations: Record<string, unknown> = {};

  const orderTopKeys = Object.keys(orders.data[0] ?? {});
  observations.orderHasGeneratedCustomerName = orderTopKeys.includes('generatedCustomerName');
  observations.orderHasGeneratedVehicleName = orderTopKeys.includes('generatedVehicleName');

  let chosen: { orderId: string; services: Service[] } | null = null;
  for (const o of orders.data) {
    const svcRes = await call<ListResponse<Service>>(`/order/${o.id}/service`);
    if (svcRes.data.length > 0 && svcRes.data.some((s) => s.labors && s.labors.length > 0)) {
      chosen = { orderId: o.id, services: svcRes.data };
      break;
    }
  }

  if (!chosen) {
    return {
      id: meta.id,
      title: meta.title,
      hypothesis: meta.hypothesis,
      verdict: 'ERROR',
      summary: 'Could not find an order with services + labor lines in the first 50 orders.',
      evidence: { observations },
    };
  }

  const sampleService = chosen.services.find((s) => s.labors && s.labors.length > 0)!;
  const serviceKeys = Object.keys(sampleService);
  const laborKeys = sampleService.labors ? Object.keys(sampleService.labors[0] ?? {}) : [];
  const partKeys = sampleService.parts && sampleService.parts.length > 0 ? Object.keys(sampleService.parts[0] ?? {}) : [];

  observations.serviceTopKeys = serviceKeys;
  observations.serviceHasLaborsPlural = serviceKeys.includes('labors');
  observations.serviceHasLaborSingular = serviceKeys.includes('labor');
  observations.serviceHasSourceServiceId = serviceKeys.includes('sourceServiceId');
  observations.serviceHasCannedServiceId = serviceKeys.includes('cannedServiceId');
  observations.laborKeys = laborKeys;
  observations.laborHasShopCostFields = ['costHours', 'costRateCents', 'costTotalCents'].every((k) => laborKeys.includes(k));
  observations.laborHasBillFields = ['hours', 'rateCents'].every((k) => laborKeys.includes(k));
  observations.partKeys = partKeys;
  observations.partHasRetailWholesaleSplit =
    partKeys.includes('retailCostCents') && partKeys.includes('wholesaleCostCents');

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    verdict: 'INFORMATIONAL',
    summary: 'Captured live key sets for Order/Service/Labor/Part. See evidence for field-name confirmation.',
    evidence: observations,
  };
}

const mod: TestModule = { meta, run };
export default mod;
