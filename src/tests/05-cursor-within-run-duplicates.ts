import { call, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '05-cursor-within-run-duplicates',
  title: 'Cursor pagination on `id` returns duplicate IDs across pages within a single run',
  hypothesis:
    'When paginating /v3/order with `orderBy={"id":"asc"}` and each successive page filtered with `where: {id: {gt: lastIdOfPreviousPage}}`, every returned ID must be strictly greater than every ID in earlier pages — so no ID can appear twice in the same run. We observe within-run duplicates (an ID returned in page N also returned in page N+1 or later). That requires either (a) the `where: {id: {gt: X}}` filter is not strictly applied, or (b) `orderBy={"id":"asc"}` is not producing a strict total order. Either way, safe cursor pagination is not achievable against this endpoint as currently implemented. We run 3 independent paginations and aggregate evidence so the test reproduces even when individual runs happen to be clean.',
};

interface OrderRow {
  id: string;
}

const ENDPOINT = '/order';
const PAGE_SIZE = 100;
const PAGES = 4;
const RUNS = 3;

interface PageRecord {
  page: number;
  cursorAfter: string | null;
  ids: string[];
}

async function paginateOnce(): Promise<PageRecord[]> {
  const pages: PageRecord[] = [];
  let lastId: string | undefined;
  for (let p = 0; p < PAGES; p++) {
    const query: Record<string, string | number> = {
      limit: PAGE_SIZE,
      orderBy: JSON.stringify({ id: 'asc' }),
    };
    if (lastId) query.where = JSON.stringify({ id: { gt: lastId } });
    const res = await call<ListResponse<OrderRow>>(ENDPOINT, { query });
    const pageIds = res.data.map((r) => r.id);
    pages.push({ page: p + 1, cursorAfter: lastId ?? null, ids: pageIds });
    if (pageIds.length < PAGE_SIZE) break;
    lastId = pageIds[pageIds.length - 1];
  }
  return pages;
}

interface RunFinding {
  run: number;
  totalIds: number;
  uniqueIds: number;
  duplicateIdCount: number;
  cursorInvariantViolations: number;
  sampleDuplicateIds: { id: string; pages: number[] }[];
  sampleViolations: { id: string; appearedInPage: number; cursorAfter: string }[];
}

function analyze(pages: PageRecord[], runIdx: number): RunFinding {
  const idToPages = new Map<string, number[]>();
  for (const { page, ids } of pages) {
    for (const id of ids) {
      const arr = idToPages.get(id) ?? [];
      arr.push(page);
      idToPages.set(id, arr);
    }
  }
  const dups: { id: string; pages: number[] }[] = [];
  for (const [id, pageList] of idToPages) {
    if (pageList.length > 1) dups.push({ id, pages: pageList });
  }

  const violations: { id: string; appearedInPage: number; cursorAfter: string }[] = [];
  for (const { page, cursorAfter, ids } of pages) {
    if (!cursorAfter) continue;
    for (const id of ids) {
      if (id <= cursorAfter) violations.push({ id, appearedInPage: page, cursorAfter });
    }
  }

  const totalIds = pages.reduce((s, p) => s + p.ids.length, 0);
  const uniqueIds = new Set(pages.flatMap((p) => p.ids)).size;

  return {
    run: runIdx,
    totalIds,
    uniqueIds,
    duplicateIdCount: dups.length,
    cursorInvariantViolations: violations.length,
    sampleDuplicateIds: dups.slice(0, 5),
    sampleViolations: violations.slice(0, 5),
  };
}

async function run(): Promise<TestResult> {
  const findings: RunFinding[] = [];
  const runPages: PageRecord[][] = [];
  for (let r = 0; r < RUNS; r++) {
    const pages = await paginateOnce();
    runPages.push(pages);
    findings.push(analyze(pages, r + 1));
  }

  const totalDups = findings.reduce((s, f) => s + f.duplicateIdCount, 0);
  const totalViolations = findings.reduce((s, f) => s + f.cursorInvariantViolations, 0);
  const runsWithDups = findings.filter((f) => f.duplicateIdCount > 0).length;

  const summary = `Across ${RUNS} independent cursor paginations of ${PAGES} pages each, ${runsWithDups}/${RUNS} runs produced duplicate IDs across pages — ${totalDups} duplicate ids in total. ${totalViolations} returned ids violated the cursor invariant outright (id ≤ the cursor passed in to that page's where filter). With orderBy={"id":"asc"} and where={id:{gt:lastId}}, no id should appear in more than one page of the same run.`;

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    summary,
    evidence: {
      endpoint: `GET /v3${ENDPOINT}`,
      pattern: 'cursor: orderBy={"id":"asc"}, no skip, page 2+ uses where={id:{gt:lastIdOfPrevPage}}',
      pageSize: PAGE_SIZE,
      maxPages: PAGES,
      runs: findings,
      pagesPerRun: runPages.map((pages, i) => ({
        run: i + 1,
        pages: pages.map((p) => ({ page: p.page, cursorAfter: p.cursorAfter, returned: p.ids.length })),
      })),
      totals: {
        runsWithDuplicates: runsWithDups,
        duplicateIds: totalDups,
        cursorInvariantViolations: totalViolations,
      },
    },
  };
}

const mod: TestModule = { meta, run };
export default mod;
