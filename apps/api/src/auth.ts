import { getAddress, verifyTypedData } from 'ethers';

const DEFAULT_CHAIN_ID = 100010;
const LOGIN_CHAIN_ID = Number.parseInt(process.env.VECHAIN_CHAIN_ID ?? '', 10) || DEFAULT_CHAIN_ID;

export const LOGIN_DOMAIN = Object.freeze({
  name: 'BigBottle',
  version: '1',
  chainId: LOGIN_CHAIN_ID
});

export const LOGIN_TYPES = Object.freeze({
  Login: [
    { name: 'challengeId', type: 'string' },
    { name: 'wallet', type: 'address' },
    { name: 'nonce', type: 'string' }
  ]
});

export function buildLoginTypedData(params: {
  walletAddress: string;
  challengeId: string;
  nonce: string;
}) {
  const wallet = getAddress(params.walletAddress);
  return {
    domain: LOGIN_DOMAIN,
    types: LOGIN_TYPES,
    value: {
      challengeId: params.challengeId,
      wallet,
      nonce: params.nonce
    }
  } as const;
}

export function verifyLoginSignature(params: {
  walletAddress: string;
  challengeId: string;
  nonce: string;
  signature: string;
}): boolean {
  const wallet = getAddress(params.walletAddress);

  const typedDataWithChainId = buildLoginTypedData({
    walletAddress: wallet,
    challengeId: params.challengeId,
    nonce: params.nonce
  });

  try {
    const recovered = verifyTypedData(
      typedDataWithChainId.domain,
      typedDataWithChainId.types,
      typedDataWithChainId.value,
      params.signature
    );
    if (getAddress(recovered) === wallet) return true;
  } catch {
    // Fall through to legacy domain verification without chainId.
  }

  const { chainId: _unused, ...legacyDomain } = typedDataWithChainId.domain;

  try {
    const recovered = verifyTypedData(
      legacyDomain,
      typedDataWithChainId.types,
      typedDataWithChainId.value,
      params.signature
    );
    return getAddress(recovered) === wallet;
  } catch {
    return false;
  }
}
