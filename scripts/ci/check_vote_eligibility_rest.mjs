const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const EFFECTIVE_ROUND_ID = process.env.EFFECTIVE_ROUND_ID || '';

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!SUPABASE_URL) fail('SUPABASE_URL is required.');
if (!SUPABASE_SERVICE_ROLE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is required.');
if (!/^[1-9][0-9]*$/.test(EFFECTIVE_ROUND_ID)) {
  fail(`EFFECTIVE_ROUND_ID must be a positive integer. Got: ${EFFECTIVE_ROUND_ID}`);
}

const pageSize = 1000;

async function fetchPage(path, offset) {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${SUPABASE_URL}/rest/v1/${path}${separator}limit=${pageSize}&offset=${offset}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      accept: 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    fail(`Supabase REST query failed ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function fetchAll(path) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(path, offset);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase();
}

const effectiveRoundId = Number(EFFECTIVE_ROUND_ID);
const sourceRoundId = effectiveRoundId - 1;

const expectedRows = await fetchAll(
  `vote_wallet_mapping?select=passport_address&round_id=eq.${sourceRoundId}&voted_any_app=eq.true`
);
const actualRows = await fetchAll(
  `bigbottle_vote_bonus_eligibility?select=passport_address&effective_round_id=eq.${effectiveRoundId}&bonus_type=eq.vebetter_vote_bonus&status=eq.eligible`
);

const expected = new Set(expectedRows.map((row) => normalizeAddress(row.passport_address)).filter(Boolean));
const actual = new Set(actualRows.map((row) => normalizeAddress(row.passport_address)).filter(Boolean));

const missing = [...expected].filter((address) => !actual.has(address));
const extra = [...actual].filter((address) => !expected.has(address));
const mismatchCount = missing.length + extra.length;

if (mismatchCount > 0) {
  console.error(`Vote eligibility mismatch detected for EFFECTIVE_ROUND_ID=${effectiveRoundId}.`);
  console.error(`Mismatch count: ${mismatchCount}`);
  console.error(
    JSON.stringify(
      {
        missing_from_eligibility_sample: missing.slice(0, 20),
        unexpected_eligible_sample: extra.slice(0, 20),
      },
      null,
      2
    )
  );
  process.exit(1);
}

console.log(`Vote eligibility audit passed for EFFECTIVE_ROUND_ID=${effectiveRoundId}. mismatch_count=0`);

if (process.env.GITHUB_STEP_SUMMARY) {
  await import('node:fs').then(({ appendFileSync }) => {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        '## Vote eligibility audit passed',
        '',
        `- effective_round_id: \`${effectiveRoundId}\``,
        '- mismatch_count: `0`',
        '- result: expected and actual eligibility sets are consistent',
        '',
      ].join('\n')
    );
  });
}
