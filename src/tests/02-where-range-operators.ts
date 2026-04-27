import { call, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '02-where-range-operators',
  title: 'MongoDB-style operators (`$gte`) silently ignored; bare operators (`gte`) honored',
  hypothesis:
    'Public docs describe `where` only as type "any" with no operator examples. We expected MongoDB-style `$gte` (the convention the rest of the `where` shape suggests). The API silently drops `$gte` and returns an unfiltered result, but it does honor the bare `gte` form. Both behaviors are undocumented.',
};

const FUTURE = '2099-01-01T00:00:00Z';

async function listOrders(query: Record<string, string | number>) {
  return call<ListResponse<{ id: string; createdDate?: string }>>('/order', { query });
}

async function run(): Promise<TestResult> {
  const baseline = await listOrders({ limit: 100 });
  const dollar = await listOrders({ limit: 100, where: JSON.stringify({ createdDate: { $gte: FUTURE } }) });
  const bare = await listOrders({ limit: 100, where: JSON.stringify({ createdDate: { gte: FUTURE } }) });

  const baselineTotal = baseline.meta.total ?? 0;
  const dollarTotal = dollar.meta.total ?? 0;
  const bareTotal = bare.meta.total ?? 0;

  const dollarIgnored = dollarTotal === baselineTotal;
  const bareWorks = bareTotal === 0;

  let verdict: TestResult['verdict'] = 'INFORMATIONAL';
  let summary = '';
  if (dollarIgnored && bareWorks) {
    verdict = 'CONFIRMED_BUG';
    summary = `\`$gte\` is silently dropped (filtered total ${dollarTotal} = baseline ${baselineTotal}); bare \`gte\` correctly returns 0 rows for a far-future date. Doc page describes \`where\` only as type "any" with no examples, so partners can't tell which syntax is right.`;
  } else if (!dollarIgnored && bareWorks) {
    verdict = 'NOT_REPRODUCED';
    summary = `Both syntaxes filter (\$gte: ${dollarTotal}, gte: ${bareTotal}); previous claim that \`$gte\` is ignored is no longer reproducible.`;
  } else {
    summary = `Unexpected mix: $gte total=${dollarTotal}, gte total=${bareTotal}, baseline=${baselineTotal}.`;
  }

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    verdict,
    summary,
    evidence: {
      endpoint: 'GET /v3/order',
      baseline: { metaTotal: baselineTotal },
      dollarPrefix: { where: { createdDate: { $gte: FUTURE } }, metaTotal: dollarTotal, dataLength: dollar.data.length },
      barePrefix: { where: { createdDate: { gte: FUTURE } }, metaTotal: bareTotal, dataLength: bare.data.length },
    },
  };
}

const mod: TestModule = { meta, run };
export default mod;
