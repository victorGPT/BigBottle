import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  VEBETTER_DAO_SUBGRAPH_URL,
  buildThorNodesPageQuery,
  computeThorNodeDiff,
  normalizeThorNode,
  type ThorNodeRecord,
  type ThorNodeRow
} from './vebetter-nodes.js';

type GraphResponse = {
  data?: {
    _meta?: { block?: { number?: number | string } };
    thorNodes?: ThorNodeRow[];
  };
  errors?: Array<{ message?: string }>;
};

type SnapshotRow = {
  identifier: string | number;
  owner_address: string;
  level: number;
  is_x: boolean;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid positive integer: ${value}`);
  }
  return parsed;
}

function resolveSnapshotDate(value: string | undefined): string {
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`SNAPSHOT_DATE must be YYYY-MM-DD, got ${value}`);
  }

  if (value) return value;
  return new Date().toISOString().slice(0, 10);
}

function previousDateOf(dateText: string): string {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function compareIdentifiers(a: string, b: string): number {
  const aNum = BigInt(a);
  const bNum = BigInt(b);
  if (aNum < bNum) return -1;
  if (aNum > bNum) return 1;
  return 0;
}

async function fetchThorNodesAll(input: {
  endpoint: string;
  pageSize: number;
}): Promise<{ records: ThorNodeRecord[]; syncBlockNumber: number; pageCount: number }> {
  const all = new Map<string, ThorNodeRecord>();
  let identifierGt: string | undefined;
  let syncBlockNumber = 0;
  let pageCount = 0;

  while (true) {
    const request = identifierGt
      ? buildThorNodesPageQuery({ first: input.pageSize, identifierGt })
      : buildThorNodesPageQuery({ first: input.pageSize });
    const res = await fetch(input.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    });

    if (!res.ok) {
      throw new Error(`graph request failed with status ${res.status}`);
    }

    const payload = (await res.json()) as GraphResponse;
    if (payload.errors?.length) {
      throw new Error(`graph returned errors: ${JSON.stringify(payload.errors)}`);
    }

    const page = payload.data?.thorNodes ?? [];
    const blockNumberRaw = payload.data?._meta?.block?.number;
    const blockNumber = Number.parseInt(String(blockNumberRaw ?? '0'), 10);
    if (Number.isFinite(blockNumber) && blockNumber > syncBlockNumber) {
      syncBlockNumber = blockNumber;
    }

    for (const row of page) {
      const normalized = normalizeThorNode(row);
      if (normalized) all.set(normalized.identifier, normalized);
    }

    pageCount += 1;

    if (page.length === 0) break;

    identifierGt = page[page.length - 1]?.identifier;
    if (!identifierGt) break;
    if (page.length < input.pageSize) break;
  }

  if (syncBlockNumber <= 0) {
    throw new Error('failed to resolve sync block number from subgraph _meta');
  }

  const records = Array.from(all.values()).sort((a, b) =>
    compareIdentifiers(a.identifier, b.identifier)
  );

  return { records, syncBlockNumber, pageCount };
}

async function upsertCurrentRows(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  records: ThorNodeRecord[];
  syncBlockNumber: number;
  syncRunId: string;
}): Promise<void> {
  const supabase = createClient(input.supabaseUrl, input.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const chunkSize = 500;
  const updatedAt = new Date().toISOString();

  for (let offset = 0; offset < input.records.length; offset += chunkSize) {
    const chunk = input.records.slice(offset, offset + chunkSize).map((item) => ({
      identifier: item.identifier,
      owner_address: item.ownerAddress,
      level: item.level,
      is_x: item.isX,
      sync_block_number: input.syncBlockNumber,
      sync_run_id: input.syncRunId,
      updated_at: updatedAt
    }));

    if (chunk.length === 0) continue;

    const res = await supabase
      .from('vebetter_node_current')
      .upsert(chunk, { onConflict: 'identifier' });

    if (res.error) {
      throw new Error(`failed upsert vebetter_node_current: ${JSON.stringify(res.error)}`);
    }
  }
}

async function upsertSnapshotRows(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  snapshotDate: string;
  records: ThorNodeRecord[];
  syncBlockNumber: number;
  syncRunId: string;
}): Promise<void> {
  const supabase = createClient(input.supabaseUrl, input.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const chunkSize = 500;
  const updatedAt = new Date().toISOString();

  for (let offset = 0; offset < input.records.length; offset += chunkSize) {
    const chunk = input.records.slice(offset, offset + chunkSize).map((item) => ({
      snapshot_date: input.snapshotDate,
      identifier: item.identifier,
      owner_address: item.ownerAddress,
      level: item.level,
      is_x: item.isX,
      sync_block_number: input.syncBlockNumber,
      sync_run_id: input.syncRunId,
      updated_at: updatedAt
    }));

    if (chunk.length === 0) continue;

    const res = await supabase
      .from('vebetter_node_snapshot_daily')
      .upsert(chunk, { onConflict: 'snapshot_date,identifier' });

    if (res.error) {
      throw new Error(`failed upsert vebetter_node_snapshot_daily: ${JSON.stringify(res.error)}`);
    }
  }
}

async function finalizeCurrentRows(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  syncRunId: string;
}): Promise<number> {
  const supabase = createClient(input.supabaseUrl, input.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const res = await supabase.rpc('bb_finalize_vebetter_node_current_sync', {
    p_sync_run_id: input.syncRunId
  });

  if (res.error) {
    throw new Error(`failed finalize current sync: ${JSON.stringify(res.error)}`);
  }

  return typeof res.data === 'number' ? res.data : 0;
}

async function fetchSnapshotRows(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  snapshotDate: string;
}): Promise<ThorNodeRecord[]> {
  const supabase = createClient(input.supabaseUrl, input.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const pageSize = 1000;
  const rows: ThorNodeRecord[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const res = await supabase
      .from('vebetter_node_snapshot_daily')
      .select('identifier,owner_address,level,is_x')
      .eq('snapshot_date', input.snapshotDate)
      .order('identifier', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (res.error) {
      throw new Error(`failed read snapshot ${input.snapshotDate}: ${JSON.stringify(res.error)}`);
    }

    const page = (res.data ?? []) as SnapshotRow[];
    rows.push(
      ...page.map((item) => ({
        identifier: String(item.identifier),
        ownerAddress: item.owner_address.toLowerCase(),
        level: item.level,
        isX: item.is_x
      }))
    );

    if (page.length < pageSize) break;
  }

  return rows;
}

async function main(): Promise<void> {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const endpoint = process.env.VEBETTER_DAO_SUBGRAPH_URL?.trim() || VEBETTER_DAO_SUBGRAPH_URL;
  const pageSize = parsePositiveInt(process.env.PAGE_SIZE, 1000);
  const dryRun = ['1', 'true', 'yes'].includes((process.env.DRY_RUN ?? '').toLowerCase());
  const snapshotDate = resolveSnapshotDate(process.env.SNAPSHOT_DATE);
  const previousSnapshotDate = previousDateOf(snapshotDate);
  const syncRunId = randomUUID();

  const { records, syncBlockNumber, pageCount } = await fetchThorNodesAll({ endpoint, pageSize });

  const previousSnapshot = await fetchSnapshotRows({
    supabaseUrl,
    serviceRoleKey,
    snapshotDate: previousSnapshotDate
  });

  if (records.length === 0) {
    throw new Error('subgraph returned zero thorNodes; aborting to avoid wiping current table');
  }

  let deletedCount = 0;

  if (!dryRun) {
    await upsertCurrentRows({
      supabaseUrl,
      serviceRoleKey,
      records,
      syncBlockNumber,
      syncRunId
    });

    await upsertSnapshotRows({
      supabaseUrl,
      serviceRoleKey,
      snapshotDate,
      records,
      syncBlockNumber,
      syncRunId
    });

    deletedCount = await finalizeCurrentRows({
      supabaseUrl,
      serviceRoleKey,
      syncRunId
    });
  }

  const diff = computeThorNodeDiff(previousSnapshot, records);

  const summary = {
    dryRun,
    endpoint,
    snapshotDate,
    previousSnapshotDate,
    syncRunId,
    syncBlockNumber,
    pageCount,
    totalCurrentNodes: records.length,
    previousSnapshotNodes: previousSnapshot.length,
    finalizedDeletedCurrentRows: deletedCount,
    diff: {
      added: diff.added.length,
      removed: diff.removed.length,
      ownerChanged: diff.ownerChanged.length,
      levelChanged: diff.levelChanged.length
    }
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
