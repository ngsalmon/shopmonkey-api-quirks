import { call, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '07-subcontract-rename',
  title: 'Subcontract field renamed: `wholesaleCostCents` no longer present; `costCents` is the actual key',
  hypothesis:
    'The current public schema documents Subcontract.costCents as the wholesale/base-cost field. Older integrations referencing `wholesaleCostCents` get undefined. This test scans live subcontracts and reports which keys are actually present.',
};

interface Subcontract {
  id: string;
  costCents?: number | null;
  wholesaleCostCents?: number | null;
  retailCostCents?: number | null;
}

interface Service {
  id: string;
  subcontracts?: Subcontract[];
}

interface Order {
  id: string;
}

async function run(): Promise<TestResult> {
  // Pull multiple pages so non-determinism (test 01) doesn't starve the sample.
  // Subcontracts are rare (~1%) so we cast a wide net.
  const orders: Order[] = [];
  for (const skip of [0, 100, 200, 300, 400, 500, 600, 700]) {
    const page = await call<ListResponse<Order>>('/order', { query: { limit: 100, skip } });
    orders.push(...page.data);
  }

  const subcontracts: Subcontract[] = [];
  let scanned = 0;
  for (const o of orders) {
    if (subcontracts.length >= 25) break;
    scanned++;
    const services = await call<ListResponse<Service>>(`/order/${o.id}/service`);
    for (const s of services.data) {
      if (s.subcontracts && s.subcontracts.length > 0) {
        for (const sc of s.subcontracts) subcontracts.push(sc);
      }
    }
  }

  if (subcontracts.length === 0) {
    return {
      id: meta.id,
      title: meta.title,
      hypothesis: meta.hypothesis,
      verdict: 'INFORMATIONAL',
      summary: `Scanned services for ${scanned} orders; no subcontract line items found in this run. Rename is confirmed by current public schema (https://shopmonkey.dev/schema/Subcontract lists costCents, no wholesaleCostCents).`,
      evidence: { ordersScanned: scanned },
    };
  }

  const allKeys = new Set<string>();
  for (const sc of subcontracts) for (const k of Object.keys(sc)) allKeys.add(k);
  const hasCostCents = subcontracts.filter((sc) => 'costCents' in sc).length;
  const hasWholesale = subcontracts.filter((sc) => 'wholesaleCostCents' in sc).length;
  const costCentsPopulated = subcontracts.filter((sc) => typeof sc.costCents === 'number').length;
  const wholesalePopulated = subcontracts.filter((sc) => typeof sc.wholesaleCostCents === 'number').length;
  const retailPopulated = subcontracts.filter((sc) => typeof sc.retailCostCents === 'number').length;

  const verdict =
    hasWholesale === 0 && hasCostCents > 0
      ? 'CONFIRMED_BUG'
      : hasWholesale > 0 && hasCostCents === 0
        ? 'NOT_REPRODUCED'
        : 'INFORMATIONAL';

  const summary = `Scanned ${subcontracts.length} subcontracts across ${scanned} orders. costCents present on ${hasCostCents} (populated on ${costCentsPopulated}). wholesaleCostCents present on ${hasWholesale} (populated on ${wholesalePopulated}). retailCostCents populated on ${retailPopulated}.`;

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    verdict,
    summary,
    evidence: {
      endpoint: 'GET /v3/order/:id/service',
      ordersScanned: scanned,
      subcontractsObserved: subcontracts.length,
      keysObserved: [...allKeys].sort(),
      hasCostCents,
      hasWholesaleCostCents: hasWholesale,
      costCentsPopulated,
      wholesaleCostCentsPopulated: wholesalePopulated,
      retailCostCentsPopulated: retailPopulated,
    },
  };
}

const mod: TestModule = { meta, run };
export default mod;
