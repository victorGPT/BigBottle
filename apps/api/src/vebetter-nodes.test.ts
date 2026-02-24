import { describe, expect, it } from 'vitest';

import {
  ZERO_ADDRESS,
  buildThorNodesPageQuery,
  computeThorNodeDiff,
  normalizeThorNode
} from './vebetter-nodes.js';

describe('buildThorNodesPageQuery', () => {
  it('builds ordered pagination query with zero-owner exclusion', () => {
    const { query, variables } = buildThorNodesPageQuery({ first: 500 });

    expect(query).toContain('orderBy: identifier');
    expect(query).toContain('orderDirection: asc');
    expect(query).toContain(`owner_not: "${ZERO_ADDRESS}"`);
    expect(variables).toEqual({ first: 500 });
  });

  it('includes identifier cursor when provided', () => {
    const { query, variables } = buildThorNodesPageQuery({ first: 500, identifierGt: '1234' });

    expect(query).toContain('identifier_gt: $identifierGt');
    expect(variables).toEqual({ first: 500, identifierGt: '1234' });
  });
});

describe('normalizeThorNode', () => {
  it('normalizes owner casing and numeric fields', () => {
    const row = {
      identifier: '42',
      owner: { id: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD' },
      level: 7,
      isX: true
    };

    expect(normalizeThorNode(row)).toEqual({
      identifier: '42',
      ownerAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      level: 7,
      isX: true
    });
  });

  it('drops zero-owner rows', () => {
    const row = {
      identifier: '9',
      owner: { id: ZERO_ADDRESS },
      level: 5,
      isX: false
    };

    expect(normalizeThorNode(row)).toBeNull();
  });
});

describe('computeThorNodeDiff', () => {
  it('detects added/removed/ownerChanged/levelChanged', () => {
    const previous = [
      { identifier: '1', ownerAddress: '0xaaaa', level: 4, isX: true },
      { identifier: '2', ownerAddress: '0xbbbb', level: 3, isX: true },
      { identifier: '3', ownerAddress: '0xcccc', level: 2, isX: false }
    ];

    const current = [
      { identifier: '1', ownerAddress: '0xdddd', level: 4, isX: true },
      { identifier: '2', ownerAddress: '0xbbbb', level: 5, isX: true },
      { identifier: '4', ownerAddress: '0xeeee', level: 1, isX: false }
    ];

    const diff = computeThorNodeDiff(previous, current);

    expect(diff.added).toEqual(['4']);
    expect(diff.removed).toEqual(['3']);
    expect(diff.ownerChanged).toEqual(['1']);
    expect(diff.levelChanged).toEqual(['2']);
  });
});
