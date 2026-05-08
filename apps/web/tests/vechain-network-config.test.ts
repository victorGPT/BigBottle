import { describe, expect, it } from 'vitest';

import { getVeChainNetworkConfig } from '../src/config/vechainNetwork';

function env(values: Record<string, string | undefined>): ImportMetaEnv {
  return values as unknown as ImportMetaEnv;
}

describe('vechain network config', () => {
  it('defaults wallet connections to mainnet', () => {
    expect(getVeChainNetworkConfig(env({}))).toEqual({
      type: 'main',
      nodeUrl: 'https://mainnet.vechain.org/'
    });
  });

  it('allows explicit testnet configuration', () => {
    expect(getVeChainNetworkConfig(env({ VITE_VECHAIN_NETWORK: 'test' }))).toEqual({
      type: 'test',
      nodeUrl: 'https://testnet.vechain.org/'
    });
  });

  it('allows overriding the node url for the selected network', () => {
    expect(
      getVeChainNetworkConfig(
        env({
          VITE_VECHAIN_NETWORK: 'mainnet',
          VITE_VECHAIN_NODE_URL: 'https://example.com/'
        })
      )
    ).toEqual({
      type: 'main',
      nodeUrl: 'https://example.com/'
    });
  });

  it('fails fast on unsupported wallet networks', () => {
    expect(() => getVeChainNetworkConfig(env({ VITE_VECHAIN_NETWORK: 'devnet' }))).toThrow(
      'Unsupported VITE_VECHAIN_NETWORK: devnet'
    );
  });
});
