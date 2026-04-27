import { createHash } from 'node:crypto';

const SALT = 'shopmonkey-api-quirks-public';

const PII_KEY_PATTERNS: RegExp[] = [
  /firstname/i,
  /lastname/i,
  /fullname/i,
  /generated.*name/i,
  /^name$/i,
  /^company$/i,
  /companyname/i,
  /email/i,
  /phone/i,
  /mobile/i,
  /address/i,
  /^street/i,
  /^city$/i,
  /postal/i,
  /^zip/i,
  /^vin$/i,
  /licenseplate/i,
  /^plate$/i,
  /odometer/i,
  /mileage/i,
  /^note$/i,
  /^notes$/i,
  /^description$/i,
  /^message$/i,
  /^title$/i,
  /^subtitle$/i,
];

const ID_KEY_PATTERNS: RegExp[] = [/Id$/, /^id$/, /Uuid$/i, /^uuid$/i];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hashId(s: string): string {
  return createHash('sha256').update(SALT).update(s).digest('hex').slice(0, 12);
}

function maskString(value: string): string {
  if (value.length === 0) return value;
  return `<redacted:${value.length}>`;
}

export function redact(input: unknown, parentKey: string | null = null, depth = 0): unknown {
  if (depth > 14) return '<deep>';
  if (input === null || input === undefined) return input;

  if (typeof input === 'string') {
    if (parentKey && PII_KEY_PATTERNS.some((re) => re.test(parentKey))) return maskString(input);
    if (parentKey && ID_KEY_PATTERNS.some((re) => re.test(parentKey))) {
      return UUID_RE.test(input) || /^[A-Za-z0-9_-]{12,}$/.test(input) ? `id:${hashId(input)}` : input;
    }
    if (UUID_RE.test(input)) return `id:${hashId(input)}`;
    return input;
  }

  if (typeof input === 'number' || typeof input === 'boolean') return input;

  if (Array.isArray(input)) return input.map((v) => redact(v, parentKey, depth + 1));

  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = redact(v, k, depth + 1);
    }
    return out;
  }
  return '<unknown>';
}

export function publicId(s: string): string {
  return `id:${hashId(s)}`;
}
