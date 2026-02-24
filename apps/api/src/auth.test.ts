import { describe, expect, it } from 'vitest';
import { Wallet } from 'ethers';

import { buildLoginTypedData, verifyLoginSignature } from './auth.js';

describe('verifyLoginSignature', () => {
  const privateKey = '0x59c6995e998f97a5a0044966f0945382d7f66f36a7f1d4b89ddf5b2d6e1f6f1f';
  const signer = new Wallet(privateKey);

  const challengeId = '11111111-1111-1111-1111-111111111111';
  const nonce = 'test-nonce';

  it('accepts signatures created with domain.chainId', async () => {
    const typed = buildLoginTypedData({
      walletAddress: signer.address,
      challengeId,
      nonce
    });

    const sig = await signer.signTypedData(typed.domain, typed.types, typed.value);

    expect(
      verifyLoginSignature({
        walletAddress: signer.address,
        challengeId,
        nonce,
        signature: sig
      })
    ).toBe(true);
  });

  it('accepts legacy signatures created without domain.chainId', async () => {
    const typed = buildLoginTypedData({
      walletAddress: signer.address,
      challengeId,
      nonce
    });

    const { chainId: _unused, ...legacyDomain } = typed.domain;
    const sig = await signer.signTypedData(legacyDomain, typed.types, typed.value);

    expect(
      verifyLoginSignature({
        walletAddress: signer.address,
        challengeId,
        nonce,
        signature: sig
      })
    ).toBe(true);
  });
});
