import { describe, expect, it } from 'vitest';

import { createRepo } from './supabase.js';

function supabaseForMaybeSingle(data: unknown, error: unknown = null) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data, error })
  };
  return {
    from: (table: string) => {
      expect(table).toBe('wallet_blacklist');
      return query;
    }
  };
}

describe('wallet blacklist', () => {
  it('normalizes wallet address before lookup', async () => {
    let matchedWallet: string | null = null;
    const query = {
      select: () => query,
      eq: (_column: string, value: string) => {
        matchedWallet = value;
        return query;
      },
      maybeSingle: async () => ({ data: null, error: null })
    };
    const supabase = { from: () => query };
    const repo = createRepo(supabase as any);

    await repo.isWalletBlacklisted('  0x7E5ABB955CCACD9D2C686F6153BF3756BB327177  ');

    expect(matchedWallet).toBe('0x7e5abb955ccacd9d2c686f6153bf3756bb327177');
  });

  it('returns true only when a blacklist row exists', async () => {
    await expect(
      createRepo(supabaseForMaybeSingle({ wallet_address: '0x1' }) as any).isWalletBlacklisted('0x1')
    ).resolves.toBe(true);

    await expect(createRepo(supabaseForMaybeSingle(null) as any).isWalletBlacklisted('0x2')).resolves.toBe(false);
  });
});
