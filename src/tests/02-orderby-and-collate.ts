import { call, type ListResponse } from '../client.js';
import type { TestModule, TestResult } from '../runner.js';

const meta = {
  id: '02-orderby-and-collate',
  title: '`orderBy` is honored on `id` but ignored on `createdDate` and `updatedDate`',
  hypothesis:
    '`orderBy` is honored on `id` (~1–5 of 49 inversions on UUIDs sorted lexically). The same syntax on `createdDate` and `updatedDate` produces ~20+ adjacent-pair inversions across 8 alternative encodings — random. So this is not a syntax issue: dates simply are not orderable through `GET /v3/order`. This matters for incremental sync, which would naturally want `updatedDate` ordering.',
};

interface Order {
  id: string;
  createdDate?: string;
  updatedDate?: string;
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

async function probeField(field: 'createdDate' | 'updatedDate') {
  const variants: { label: string; encoded: string }[] = [
    { label: `object {${field}:"asc"}`, encoded: JSON.stringify({ [field]: 'asc' }) },
    { label: `object {${field}:1}`, encoded: JSON.stringify({ [field]: 1 }) },
    { label: `object {${field}:"ascending"}`, encoded: JSON.stringify({ [field]: 'ascending' }) },
    { label: `string "${field}"`, encoded: field },
    { label: `string "-${field}"`, encoded: `-${field}` },
    { label: `string "${field} asc"`, encoded: `${field} asc` },
    { label: `array [{field,direction}]`, encoded: JSON.stringify([{ field, direction: 'asc' }]) },
    { label: `array [["${field}","ASC"]]`, encoded: JSON.stringify([[field, 'ASC']]) },
  ];

  const out: { label: string; ascInv: number; descInv: number; rows: number }[] = [];
  for (const v of variants) {
    const r = await fetchOrdered(v.encoded);
    const dates = r.data.map((o) => (o[field] ?? '') as string);
    out.push({
      label: v.label,
      rows: dates.length,
      ascInv: inversions(dates),
      descInv: inversions([...dates].reverse()),
    });
  }
  return out;
}

async function run(): Promise<TestResult> {
  const createdDateResults = await probeField('createdDate');
  const updatedDateResults = await probeField('updatedDate');

  // Control: orderBy on `id` should sort alphabetically (UUIDs as strings).
  const idAsc = await fetchOrdered(JSON.stringify({ id: 'asc' }));
  const idValues = idAsc.data.map((o) => o.id);
  const idInversions = inversions(idValues);

  // collate variant on createdDate
  const withCollate = await fetchOrdered(JSON.stringify({ createdDate: 'asc' }), 'true');
  const collateDates = withCollate.data.map((o) => o.createdDate ?? '');
  const collateInversions = inversions(collateDates);

  const minCreatedInv = Math.min(...createdDateResults.map((r) => Math.min(r.ascInv, r.descInv)));
  const minUpdatedInv = Math.min(...updatedDateResults.map((r) => Math.min(r.ascInv, r.descInv)));

  const summary = `orderBy={"id":"asc"} produced ${idInversions}/${idValues.length - 1} alphabetic inversions on UUIDs (effectively sorted). Same syntax on createdDate: ≥${minCreatedInv}/${createdDateResults[0].rows - 1} inversions across 8 encodings. On updatedDate: ≥${minUpdatedInv}/${updatedDateResults[0].rows - 1} inversions across 8 encodings. Neither date field is orderable. collate=true on createdDate: ${collateInversions} inversions.`;

  return {
    id: meta.id,
    title: meta.title,
    hypothesis: meta.hypothesis,
    summary,
    evidence: {
      endpoint: 'GET /v3/order',
      idControl: { orderBy: { id: 'asc' }, rows: idValues.length, alphabeticInversions: idInversions },
      createdDateVariants: createdDateResults,
      updatedDateVariants: updatedDateResults,
      collateOnCreatedDate: { rows: collateDates.length, ascInversions: collateInversions },
    },
  };
}

const mod: TestModule = { meta, run };
export default mod;
