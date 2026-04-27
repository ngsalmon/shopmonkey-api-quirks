import { call, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '04-offset-vs-skip',
  title: '`offset` parameter silently ignored on /customer; `skip` works',
  hypothesis:
    'GET /v3/customer?limit=10&offset=0 and ?limit=10&offset=50 should return disjoint pages. They return identical IDs (offset is dropped). The same calls using skip do produce different pages.',
};

interface Customer {
  id: string;
}

async function fetchPage(query: Record<string, string | number>) {
  return call<ListResponse<Customer>>('/customer', { query });
}

async function run(): Promise<TestResult> {
  const offsetPage1 = await fetchPage({ limit: 10, offset: 0 });
  const offsetPage2 = await fetchPage({ limit: 10, offset: 50 });
  const skipPage1 = await fetchPage({ limit: 10, skip: 0 });
  const skipPage2 = await fetchPage({ limit: 10, skip: 50 });

  const idsOffset1 = new Set(offsetPage1.data.map((c) => c.id));
  const idsOffset2 = new Set(offsetPage2.data.map((c) => c.id));
  const idsSkip1 = new Set(skipPage1.data.map((c) => c.id));
  const idsSkip2 = new Set(skipPage2.data.map((c) => c.id));

  const offsetSame = [...idsOffset1].every((x) => idsOffset2.has(x)) && idsOffset1.size === idsOffset2.size;
  const skipSame = [...idsSkip1].every((x) => idsSkip2.has(x)) && idsSkip1.size === idsSkip2.size;

  const offsetIgnored = offsetSame;
  const skipIgnored = skipSame;
  const verdict =
    offsetIgnored && !skipIgnored
      ? 'CONFIRMED_BUG'
      : !offsetIgnored && !skipIgnored
        ? 'NOT_REPRODUCED'
        : 'INFORMATIONAL';

  const summary = offsetIgnored
    ? `offset=0 vs offset=50 returned identical IDs (offset dropped). skip=0 vs skip=50 returned ${
        skipIgnored ? 'identical IDs (skip also broken)' : 'disjoint pages (skip works)'
      }.`
    : 'offset appears to advance the page; not reproduced.';

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    verdict,
    summary,
    evidence: {
      endpoint: 'GET /v3/customer',
      offset: {
        page0Count: idsOffset1.size,
        page50Count: idsOffset2.size,
        intersectionCount: [...idsOffset1].filter((x) => idsOffset2.has(x)).length,
        identical: offsetSame,
      },
      skip: {
        page0Count: idsSkip1.size,
        page50Count: idsSkip2.size,
        intersectionCount: [...idsSkip1].filter((x) => idsSkip2.has(x)).length,
        identical: skipSame,
      },
    },
  };
}

const mod: TestModule = { meta, run };
export default mod;
