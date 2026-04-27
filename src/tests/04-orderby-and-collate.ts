import { call, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '04-orderby-and-collate',
  title: '`orderBy` accepted but does not produce monotonic ordering; `collate=true` does not stabilize',
  hypothesis:
    'GET /v3/order with orderBy={"createdDate":"asc"} should return records sorted ascending by createdDate. Records arrive non-monotonic. Repeating with collate=true does not change the result.',
};

interface Order {
  id: string;
  createdDate?: string;
}

function countInversions(values: string[]): number {
  let inversions = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > values[i]) inversions++;
  }
  return inversions;
}

async function run(): Promise<TestResult> {
  const orderBy = JSON.stringify({ createdDate: 'asc' });

  const noCollate = await call<ListResponse<Order>>('/order', { query: { limit: 100, orderBy } });
  const withCollate = await call<ListResponse<Order>>('/order', {
    query: { limit: 100, orderBy, collate: 'true' },
  });

  const datesA = noCollate.data.map((o) => o.createdDate ?? '');
  const datesB = withCollate.data.map((o) => o.createdDate ?? '');
  const invA = countInversions(datesA);
  const invB = countInversions(datesB);

  const sortedHonored = invA === 0 && invB === 0;
  const verdict = sortedHonored ? 'NOT_REPRODUCED' : 'CONFIRMED_BUG';
  const summary = sortedHonored
    ? 'orderBy produced fully monotonic ordering on both runs.'
    : `orderBy returned ${datesA.length} rows with ${invA} adjacent-pair inversions. With collate=true: ${invB} inversions. Expected 0 if sort were honored.`;

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    verdict,
    summary,
    evidence: {
      endpoint: 'GET /v3/order',
      orderBy: { createdDate: 'asc' },
      withoutCollate: {
        rows: datesA.length,
        adjacentInversions: invA,
        first5Dates: datesA.slice(0, 5),
        last5Dates: datesA.slice(-5),
      },
      withCollate: {
        rows: datesB.length,
        adjacentInversions: invB,
        first5Dates: datesB.slice(0, 5),
        last5Dates: datesB.slice(-5),
      },
    },
  };
}

const mod: TestModule = { meta, run };
export default mod;
