export const VEBETTER_DAO_SUBGRAPH_URL = 'https://graph.vet/subgraphs/name/vebetter/dao';
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export interface BuildThorNodesPageQueryInput {
  first: number;
  identifierGt?: string;
}

export interface GraphQLRequest {
  query: string;
  variables: Record<string, string | number>;
}

export interface ThorNodeRow {
  identifier: string;
  owner: { id: string } | null;
  level: number | string;
  isX: boolean;
}

export interface ThorNodeRecord {
  identifier: string;
  ownerAddress: string;
  level: number;
  isX: boolean;
}

export interface ThorNodeDiff {
  added: string[];
  removed: string[];
  ownerChanged: string[];
  levelChanged: string[];
}

export function buildThorNodesPageQuery(input: BuildThorNodesPageQueryInput): GraphQLRequest {
  if (!Number.isInteger(input.first) || input.first <= 0) {
    throw new Error('first must be a positive integer');
  }

  if (input.identifierGt) {
    return {
      query: `query ThorNodesPage($first: Int!, $identifierGt: BigInt!) {
  _meta {
    block {
      number
    }
  }
  thorNodes(
    first: $first
    orderBy: identifier
    orderDirection: asc
    where: { owner_not: "${ZERO_ADDRESS}", identifier_gt: $identifierGt }
  ) {
    identifier
    owner {
      id
    }
    level
    isX
  }
}`,
      variables: {
        first: input.first,
        identifierGt: input.identifierGt
      }
    };
  }

  return {
    query: `query ThorNodesPage($first: Int!) {
  _meta {
    block {
      number
    }
  }
  thorNodes(
    first: $first
    orderBy: identifier
    orderDirection: asc
    where: { owner_not: "${ZERO_ADDRESS}" }
  ) {
    identifier
    owner {
      id
    }
    level
    isX
  }
}`,
    variables: {
      first: input.first
    }
  };
}

export function normalizeThorNode(row: ThorNodeRow): ThorNodeRecord | null {
  const ownerAddress = row.owner?.id?.trim().toLowerCase();
  if (!ownerAddress || ownerAddress === ZERO_ADDRESS) {
    return null;
  }

  const identifier = String(row.identifier).trim();
  if (!identifier) {
    throw new Error('thor node identifier is required');
  }

  const level = typeof row.level === 'number' ? row.level : Number.parseInt(row.level, 10);
  if (!Number.isInteger(level) || level < 0) {
    throw new Error(`invalid thor node level for identifier=${identifier}`);
  }

  return {
    identifier,
    ownerAddress,
    level,
    isX: Boolean(row.isX)
  };
}

export function computeThorNodeDiff(previous: ThorNodeRecord[], current: ThorNodeRecord[]): ThorNodeDiff {
  const previousMap = new Map(previous.map((item) => [item.identifier, item]));
  const currentMap = new Map(current.map((item) => [item.identifier, item]));

  const added: string[] = [];
  const removed: string[] = [];
  const ownerChanged: string[] = [];
  const levelChanged: string[] = [];

  for (const [identifier, currentNode] of currentMap) {
    const previousNode = previousMap.get(identifier);
    if (!previousNode) {
      added.push(identifier);
      continue;
    }

    if (previousNode.ownerAddress !== currentNode.ownerAddress) {
      ownerChanged.push(identifier);
    }

    if (previousNode.level !== currentNode.level) {
      levelChanged.push(identifier);
    }
  }

  for (const identifier of previousMap.keys()) {
    if (!currentMap.has(identifier)) {
      removed.push(identifier);
    }
  }

  const sortIds = (ids: string[]) => ids.sort(compareIdentifiers);

  return {
    added: sortIds(added),
    removed: sortIds(removed),
    ownerChanged: sortIds(ownerChanged),
    levelChanged: sortIds(levelChanged)
  };
}

function compareIdentifiers(a: string, b: string): number {
  const aIsInteger = /^\d+$/.test(a);
  const bIsInteger = /^\d+$/.test(b);

  if (aIsInteger && bIsInteger) {
    const aNum = BigInt(a);
    const bNum = BigInt(b);
    if (aNum < bNum) return -1;
    if (aNum > bNum) return 1;
    return 0;
  }

  return a.localeCompare(b);
}
