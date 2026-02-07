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
  const typedData = buildLoginTypedData({
    walletAddress: wallet,
    challengeId: params.challengeId,
    nonce: params.nonce
  });
  const recovered = verifyTypedData(
    typedData.domain,
    typedData.types,
    typedData.value,
    params.signature
  );
  return getAddress(recovered) === wallet;
}
