#!/usr/bin/env node

const GRAPH_URL = process.env.VEBETTER_DAO_SUBGRAPH_URL || 'https://graph.vet/subgraphs/name/vebetter/dao';
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.BB_SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.BB_SUPABASE_SERVICE_ROLE_KEY || '';
const BIGBOTTLE_APP_ID = (
  process.env.VEBETTER_APP_ID ||
  '0x68c854d0aef9f5517d58d4772395d0ab44d914070fa6ca5a96f2146ca1449248'
).toLowerCase();
const RETAIN_ROUNDS = parsePositiveInt(process.env.RETAIN_ROUNDS, 4);
const BATCH_SIZE = parsePositiveInt(process.env.SUPABASE_BATCH_SIZE, 500);
const DRY_RUN = process.env.DRY_RUN === 'true';

function fail(message) {
  console.error(`[vote-bonus-sync] ${message}`);
  process.exit(1);
}

function parsePositiveInt(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

async function graphQuery(query, variables = {}) {
  const res = await fetch(GRAPH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const body = await res.json();
  if (!res.ok || body.errors) {
    throw new Error(`subgraph query failed: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.data;
}

async function supabaseFetch(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      ...(init.headers ?? {})
    }
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(`Supabase ${init.method ?? 'GET'} ${path} failed ${res.status}: ${text}`);
  }
  return json;
}

async function resolveLatestRound() {
  const data = await graphQuery(`{
    rounds(first: 1, orderBy: number, orderDirection: desc) {
      number
    }
  }`);
  const latest = Number(data.rounds?.[0]?.number);
  if (!Number.isInteger(latest) || latest <= 1) {
    throw new Error(`invalid latest round from subgraph: ${JSON.stringify(data)}`);
  }
  return latest;
}

async function fetchAllocationVotes(sourceRound) {
  const byPair = new Map();
  let skip = 0;
  let fetched = 0;

  while (true) {
    const data = await graphQuery(
      `query($round: BigInt!, $skip: Int!) {
        allocationVotes(
          first: 1000,
          skip: $skip,
          orderBy: id,
          orderDirection: asc,
          where: { round_: { number: $round } }
        ) {
          voter { id }
          passport { id }
          app { id }
          timestamp
        }
      }`,
      { round: String(sourceRound), skip }
    );

    const rows = data.allocationVotes ?? [];
    fetched += rows.length;

    for (const vote of rows) {
      const voter = String(vote.voter?.id ?? '').toLowerCase();
      const passport = String(vote.passport?.id ?? '').toLowerCase();
      const app = String(vote.app?.id ?? '').toLowerCase();
      if (!voter || !passport) continue;

      const key = `${passport}:${voter}`;
      const voteAt = new Date(Number(vote.timestamp) / 1000).toISOString();
      const current =
        byPair.get(key) ??
        {
          round_id: sourceRound,
          voter_address: voter,
          passport_address: passport,
          voted_any_app: true,
          voted_bigbottle: false,
          apps: new Set(),
          first_vote_at: voteAt,
          last_vote_at: voteAt,
          source: 'vebetter_subgraph'
        };

      current.apps.add(app);
      current.voted_bigbottle ||= app === BIGBOTTLE_APP_ID;
      if (voteAt < current.first_vote_at) current.first_vote_at = voteAt;
      if (voteAt > current.last_vote_at) current.last_vote_at = voteAt;
      byPair.set(key, current);
    }

    if (rows.length < 1000) break;
    skip += 1000;
    if (skip % 10000 === 0) {
      console.log(`[vote-bonus-sync] fetched ${skip} allocation vote rows...`);
    }
  }

  return {
    fetched,
    rows: [...byPair.values()].map((item) => ({
      round_id: item.round_id,
      voter_address: item.voter_address,
      passport_address: item.passport_address,
      voted_any_app: item.voted_any_app,
      voted_bigbottle: item.voted_bigbottle,
      apps_voted_count: item.apps.size,
      first_vote_at: item.first_vote_at,
      last_vote_at: item.last_vote_at,
      source: item.source
    }))
  };
}

async function upsertVoteMappings(rows) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    await supabaseFetch('/rest/v1/vote_wallet_mapping?on_conflict=round_id,passport_address,voter_address', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify(chunk)
    });
    if (i === 0 || (i / BATCH_SIZE) % 10 === 0) {
      console.log(`[vote-bonus-sync] upserted ${Math.min(i + chunk.length, rows.length)}/${rows.length}`);
    }
  }
}

async function rpc(name, body) {
  return await supabaseFetch(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function count(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'HEAD',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      prefer: 'count=exact'
    }
  });
  if (!res.ok) throw new Error(`count failed ${res.status} for ${path}`);
  return Number(res.headers.get('content-range')?.split('/')?.[1] ?? 0);
}

async function deleteCount(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'DELETE',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      prefer: 'count=exact'
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`delete failed ${res.status} for ${path}: ${text}`);
  return Number(res.headers.get('content-range')?.split('/')?.[1] ?? 0);
}

async function cleanupOldRounds(currentRound) {
  try {
    return await rpc('bb_cleanup_vote_bonus_rounds', {
      p_current_round_id: currentRound,
      p_retain_rounds: RETAIN_ROUNDS
    });
  } catch (err) {
    console.warn(`[vote-bonus-sync] cleanup rpc unavailable, falling back to direct delete: ${err.message}`);
  }

  const minEffectiveRound = currentRound - RETAIN_ROUNDS + 1;
  const minSourceRound = minEffectiveRound - 1;
  const deletedBonusEligibility = await deleteCount(
    `/rest/v1/bigbottle_vote_bonus_eligibility?effective_round_id=lt.${minEffectiveRound}`
  );
  const deletedVoteMapping = await deleteCount(
    `/rest/v1/vote_wallet_mapping?round_id=lt.${minSourceRound}`
  );
  return {
    deleted_bonus_eligibility: deletedBonusEligibility,
    deleted_vote_mapping: deletedVoteMapping,
    method: 'direct_delete'
  };
}

async function main() {
  const currentRound = parsePositiveInt(process.env.EFFECTIVE_ROUND_ID, await resolveLatestRound());
  const sourceRound = parsePositiveInt(process.env.SOURCE_ROUND_ID, currentRound - 1);
  if (sourceRound >= currentRound) {
    fail(`SOURCE_ROUND_ID (${sourceRound}) must be less than EFFECTIVE_ROUND_ID (${currentRound}).`);
  }

  console.log(`[vote-bonus-sync] graph=${GRAPH_URL}`);
  console.log(`[vote-bonus-sync] source_round=${sourceRound} effective_round=${currentRound}`);

  const { fetched, rows } = await fetchAllocationVotes(sourceRound);
  console.log(
    `[vote-bonus-sync] allocation_vote_rows=${fetched} distinct_passport_voter_pairs=${rows.length}`
  );

  if (DRY_RUN) {
    console.log(
      JSON.stringify(
        {
          dry_run: true,
          source_round: sourceRound,
          effective_round: currentRound,
          allocation_vote_rows: fetched,
          distinct_passport_voter_pairs: rows.length
        },
        null,
        2
      )
    );
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    fail('Missing SUPABASE_URL/BB_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/BB_SUPABASE_SERVICE_ROLE_KEY.');
  }

  await upsertVoteMappings(rows);

  const refreshedMappings = await rpc('bb_refresh_vote_mapping_user_ids', { target_round_id: sourceRound });
  const generatedEligibility = await rpc('bb_generate_vote_bonus_eligibility', {
    p_source_round_id: sourceRound,
    p_effective_round_id: currentRound,
    p_bonus_type: 'vebetter_vote_bonus',
    p_bonus_multiplier: 10,
    p_source: 'vebetter_subgraph'
  });
  const refreshedEligibility = await rpc('bb_refresh_bonus_eligibility_user_ids', {
    target_effective_round_id: currentRound
  });

  const cleanup = await cleanupOldRounds(currentRound);

  const mappingCount = await count(
    `/rest/v1/vote_wallet_mapping?round_id=eq.${sourceRound}&voted_any_app=eq.true`
  );
  const eligibilityCount = await count(
    `/rest/v1/bigbottle_vote_bonus_eligibility?effective_round_id=eq.${currentRound}&bonus_type=eq.vebetter_vote_bonus`
  );

  console.log(
    JSON.stringify(
      {
        source_round: sourceRound,
        effective_round: currentRound,
        allocation_vote_rows: fetched,
        vote_mapping_count: mappingCount,
        generated_eligibility: generatedEligibility,
        eligibility_count: eligibilityCount,
        refreshed_mappings: refreshedMappings,
        refreshed_eligibility: refreshedEligibility,
        cleanup
      },
      null,
      2
    )
  );
}

main().catch((err) => fail(err instanceof Error ? err.stack || err.message : String(err)));
