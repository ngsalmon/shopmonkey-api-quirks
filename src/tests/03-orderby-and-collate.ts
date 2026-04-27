import { call, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '03-orderby-and-collate',
  title: '`orderBy` is honored on `id` but not on `createdDate`; `collate=true` does not change behavior',
  hypothesis:
    '`orderBy` syntax `{"<field>":"asc"}` works on `id` (1 of 49 inversions across 50 rows — essentially sorted). The same syntax on `createdDate` produces ~25 of 49 inversions — random. Tested 8 alternative encodings (string, hyphen-prefix, JSON 1/-1, array forms); none sort `createdDate`. So this is not a syntax issue — `createdDate` simply is not orderable through this endpoint.',
};

interface Order {
  id: string;
  createdDate?: string;
}

function inversions(values: string[]): number {
  let n = 0;
  for (let i = 1; i < values.length; i++) if (values[i - 1] > values[i]) n++;
  return n;
}

async function fetchOrdered(orderBy: string, collate?: string) {
  const query: Record<string, string> = { limit: '50', orderBy };
  if (collate) query.collate = collate;
  return call<ListResponse<Order>>('/order', { query });
}

async function run(): Promise<TestResult> {
  const variants: { label: string; encoded: string }[] = [
    { label: 'object {createdDate:"asc"}', encoded: JSON.stringify({ createdDate: 'asc' }) },
    { label: 'object {createdDate:1}', encoded: JSON.stringify({ createdDate: 1 }) },
    { label: 'object {createdDate:"ascending"}', encoded: JSON.stringify({ createdDate: 'ascending' }) },
    { label: 'string "createdDate"', encoded: 'createdDate' },
    { label: 'string "-createdDate"', encoded: '-createdDate' },
    { label: 'string "createdDate asc"', encoded: 'createdDate asc' },
    { label: 'array [{field,direction}]', encoded: JSON.stringify([{ field: 'createdDate', direction: 'asc' }]) },
    { label: 'array [["createdDate","ASC"]]', encoded: JSON.stringify([['createdDate', 'ASC']]) },
  ];

  const createdDateResults: { label: string; ascInv: number; descInv: number; rows: number }[] = [];
  for (const v of variants) {
    const r = await fetchOrdered(v.encoded);
    const dates = r.data.map((o) => o.createdDate ?? '');
    createdDateResults.push({
      label: v.label,
      rows: dates.length,
      ascInv: inversions(dates),
      descInv: inversions([...dates].reverse()),
    });
  }

  // Control: orderBy on `id` should sort alphabetically (UUIDs are strings).
  const idAsc = await fetchOrdered(JSON.stringify({ id: 'asc' }));
  const idValues = idAsc.data.map((o) => o.id);
  const idInversions = inversions(idValues);

  // collate variant on createdDate
  const withCollate = await fetchOrdered(JSON.stringify({ createdDate: 'asc' }), 'true');
  const collateDates = withCollate.data.map((o) => o.createdDate ?? '');
  const collateInversions = inversions(collateDates);

  const minCreatedDateInversions = Math.min(...createdDateResults.map((r) => Math.min(r.ascInv, r.descInv)));
  // id sort can show a few inversions because the underlying record set is itself non-deterministic
  // (test 01) — what matters is that id-sort is dramatically lower than createdDate-sort.
  const idIsSorted = idInversions <= 5;
  const createdDateIsRandom = minCreatedDateInversions > 10;

  const verdict =
    idIsSorted && createdDateIsRandom ? 'CONFIRMED_BUG' : !createdDateIsRandom ? 'NOT_REPRODUCED' : 'INFORMATIONAL';

  const summary = idIsSorted
    ? `orderBy={"id":"asc"} produced ${idInversions}/${idValues.length - 1} alphabetic inversions on UUIDs (effectively sorted). Same syntax on createdDate produced ≥${minCreatedDateInversions}/${createdDateResults[0].rows - 1} adjacent-pair inversions across all 8 encodings tested. createdDate is not orderable. collate=true: ${collateInversions} inversions.`
    : `orderBy on id had ${idInversions} inversions, comparable to createdDate (${minCreatedDateInversions}). orderBy may not be honored on any field, or this run was unlucky.`;

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    verdict,
    summary,
    evidence: {
      endpoint: 'GET /v3/order',
      idControl: { orderBy: { id: 'asc' }, rows: idValues.length, alphabeticInversions: idInversions },
      createdDateVariants: createdDateResults,
      collateOnCreatedDate: { rows: collateDates.length, ascInversions: collateInversions },
    },
  };
}

const mod: TestModule = { meta, run };
export default mod;
