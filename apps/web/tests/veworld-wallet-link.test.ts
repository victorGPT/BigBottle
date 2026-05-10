import nacl from 'tweetnacl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  beginVeWorldWalletLinkLogin,
  clearVeWorldWalletLinkState,
  completeVeWorldConnectedCallback,
  completeVeWorldSignedTypedDataCallback,
  createVeWorldTypedDataUrl
} from '../src/util/veworldWalletLink';

const STORAGE_KEY = 'bigbottle.veworld_wallet_link';
const originalWindowLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
const originalGlobalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    }
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function encryptForApp(payload: unknown, appPublicKey: string, walletKeyPair: nacl.BoxKeyPair) {
  const nonce = nacl.randomBytes(24);
  const encrypted = nacl.box(
    new Uint8Array(Buffer.from(JSON.stringify(payload), 'utf8')),
    nonce,
    base64ToBytes(appPublicKey),
    walletKeyPair.secretKey
  );

  return {
    data: bytesToBase64(encrypted),
    nonce: bytesToBase64(nonce),
    publicKey: bytesToBase64(walletKeyPair.publicKey)
  };
}

describe('veworldWalletLink', () => {
  beforeEach(() => {
    const storage = createMemoryStorage();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: storage
    });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage
    });
  });

  afterEach(() => {
    clearVeWorldWalletLinkState();
    if (originalWindowLocalStorage) {
      Object.defineProperty(window, 'localStorage', originalWindowLocalStorage);
    }
    if (originalGlobalLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalGlobalLocalStorage);
    }
  });

  it('builds the official VeWorld connect link and persists login state', () => {
    const url = beginVeWorldWalletLinkLogin({ networkType: 'main', returnTo: '/account' });
    const parsed = new URL(url);
    const state = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { publicKey?: string };

    expect(parsed.origin).toBe('https://www.veworld.com');
    expect(parsed.pathname).toBe('/api/v1/connect');
    expect(parsed.searchParams.get('app_name')).toBe('BigBottle');
    expect(parsed.searchParams.get('app_url')).toBe(window.location.origin);
    expect(parsed.searchParams.get('genesis_id')).toBe(
      '0x00000000851caf3cfdb6e899cf5958bfb1ac3413d346d43539627e6be7ec1b4a'
    );
    expect(parsed.searchParams.get('redirect_url')).toBe(
      `${window.location.origin}/veworld/callback/onVeWorldConnected`
    );
    expect(parsed.searchParams.get('public_key')).toBe(state.publicKey);
  });

  it('decrypts connect and typed-data callbacks across the stored VeWorld session', () => {
    beginVeWorldWalletLinkLogin({ networkType: 'test', returnTo: '/account' });
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { publicKey: string };
    const walletKeyPair = nacl.box.keyPair();

    const connected = encryptForApp(
      {
        publicKey: 'wallet-public-key',
        address: '0x0000000000000000000000000000000000000001',
        session: 'session-1'
      },
      stored.publicKey,
      walletKeyPair
    );

    const connectedResult = completeVeWorldConnectedCallback(
      `${window.location.origin}/veworld/callback/onVeWorldConnected?${new URLSearchParams({
        data: connected.data,
        nonce: connected.nonce,
        public_key: connected.publicKey
      }).toString()}`
    );

    expect(connectedResult.address).toBe('0x0000000000000000000000000000000000000001');

    const signUrl = createVeWorldTypedDataUrl({
      challenge_id: 'challenge-1',
      typed_data: {
        domain: { name: 'BigBottle', version: '1' },
        types: { Login: [{ name: 'challengeId', type: 'string' }] },
        value: { challengeId: 'challenge-1' }
      }
    });
    const parsedSignUrl = new URL(signUrl);

    expect(parsedSignUrl.pathname).toBe('/api/v1/signTypedData');
    expect(parsedSignUrl.searchParams.get('redirect_url')).toBe(
      `${window.location.origin}/veworld/callback/onVeWorldSignedTypedData`
    );
    expect(parsedSignUrl.searchParams.get('request')).toBeTruthy();

    const signed = encryptForApp({ signature: '0xsig' }, stored.publicKey, walletKeyPair);
    const signedResult = completeVeWorldSignedTypedDataCallback(
      `${window.location.origin}/veworld/callback/onVeWorldSignedTypedData?${new URLSearchParams({
        data: signed.data,
        nonce: signed.nonce,
        public_key: signed.publicKey
      }).toString()}`
    );

    expect(signedResult).toEqual({
      address: '0x0000000000000000000000000000000000000001',
      challengeId: 'challenge-1',
      signature: '0xsig'
    });
  });
});
