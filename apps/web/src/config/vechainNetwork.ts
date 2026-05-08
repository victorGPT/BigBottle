type VeChainNetworkType = 'main' | 'test';

type VeChainNetworkConfig = {
  type: VeChainNetworkType;
  nodeUrl: string;
};

const DEFAULT_NETWORK_TYPE: VeChainNetworkType = 'main';

const DEFAULT_NODE_URLS: Record<VeChainNetworkType, string> = {
  main: 'https://mainnet.vechain.org/',
  test: 'https://testnet.vechain.org/'
};

function normalizeNetworkType(raw: string | undefined): VeChainNetworkType {
  const value = raw?.trim().toLowerCase();
  if (!value) return DEFAULT_NETWORK_TYPE;
  if (value === 'main' || value === 'mainnet') return 'main';
  if (value === 'test' || value === 'testnet') return 'test';
  throw new Error(`Unsupported VITE_VECHAIN_NETWORK: ${raw}`);
}

export function getVeChainNetworkConfig(env: ImportMetaEnv = import.meta.env): VeChainNetworkConfig {
  const type = normalizeNetworkType(env.VITE_VECHAIN_NETWORK);
  const nodeUrl = env.VITE_VECHAIN_NODE_URL?.trim() || DEFAULT_NODE_URLS[type];

  return { type, nodeUrl };
}

export const veChainNetwork = getVeChainNetworkConfig();
