import { getAddress, verifyTypedData } from 'ethers';

export const LOGIN_DOMAIN = Object.freeze({
  name: 'BigBottle',
  version: '1'
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
