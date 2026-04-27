import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearRequestLog, getRequestLog } from './client.js';
import { redact } from './redact.js';

import test01 from './tests/01-non-determinism.js';
import test02 from './tests/02-where-range-operators.js';
import test03 from './tests/03-orderby-and-collate.js';
import test04 from './tests/04-offset-vs-skip.js';
import test05 from './tests/05-limit-clamp.js';
import test06 from './tests/06-payment-date-filter.js';
import test07 from './tests/07-subcontract-rename.js';

export type Verdict = 'CONFIRMED_BUG' | 'NOT_REPRODUCED' | 'INFORMATIONAL' | 'ERROR';

export interface TestResult {
  id: string;
  title: string;
  hypothesis: string;
  verdict: Verdict;
  summary: string;
  evidence: Record<string, unknown>;
}

export interface TestModule {
  meta: { id: string; title: string; hypothesis: string };
  run: () => Promise<TestResult>;
}

const TESTS: TestModule[] = [test01, test02, test03, test04, test05, test06, test07];

function rootDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..');
}

const VERDICT_GLYPH: Record<Verdict, string> = {
  CONFIRMED_BUG: 'X',
  NOT_REPRODUCED: '.',
  INFORMATIONAL: 'i',
  ERROR: '!',
};

async function runOne(mod: TestModule, evidenceDir: string): Promise<TestResult> {
  process.stdout.write(`[${mod.meta.id}] ${mod.meta.title} ... `);
  clearRequestLog();
  let result: TestResult;
  try {
    result = await mod.run();
  } catch (err) {
    result = {
      id: mod.meta.id,
      title: mod.meta.title,
      hypothesis: mod.meta.hypothesis,
      verdict: 'ERROR',
      summary: err instanceof Error ? err.message : String(err),
      evidence: {},
    };
  }
  const requests = getRequestLog().map((r) => ({ ...r, body: r.body ? redact(r.body) : undefined }));
  const evidencePath = resolve(evidenceDir, `${mod.meta.id}.json`);
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        id: result.id,
        title: result.title,
        hypothesis: result.hypothesis,
        verdict: result.verdict,
        summary: result.summary,
        evidence: redact(result.evidence),
        requests,
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  process.stdout.write(`${VERDICT_GLYPH[result.verdict]}  ${result.verdict}\n`);
  if (result.summary) process.stdout.write(`     ${result.summary}\n`);
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const mod of TESTS) console.log(`${mod.meta.id}\t${mod.meta.title}`);
    return;
  }
  const onlyIdx = args.indexOf('--only');
  const onlyId = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;
  const selected = onlyId ? TESTS.filter((t) => t.meta.id === onlyId) : TESTS;
  if (selected.length === 0) {
    console.error(`No test matched id "${onlyId}". Run with --list to see available ids.`);
    process.exit(1);
  }

  const evidenceDir = resolve(rootDir(), 'evidence');
  await mkdir(evidenceDir, { recursive: true });

  const results: TestResult[] = [];
  for (const mod of selected) {
    const r = await runOne(mod, evidenceDir);
    results.push(r);
  }

  const summaryPath = resolve(evidenceDir, 'summary.json');
  await writeFile(
    summaryPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        results: results.map((r) => ({
          id: r.id,
          title: r.title,
          verdict: r.verdict,
          summary: r.summary,
        })),
      },
      null,
      2,
    ),
  );

  console.log('\n--- Summary ---');
  for (const r of results) console.log(`  ${VERDICT_GLYPH[r.verdict]} [${r.id}] ${r.verdict}: ${r.title}`);
  const bad = results.filter((r) => r.verdict === 'CONFIRMED_BUG').length;
  const errs = results.filter((r) => r.verdict === 'ERROR').length;
  console.log(`\n${results.length} tests, ${bad} confirmed bugs, ${errs} errors.`);
  console.log(`Evidence written to ${evidenceDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
