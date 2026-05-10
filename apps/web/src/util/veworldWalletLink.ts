import nacl from 'tweetnacl';

export const VEWORLD_CALLBACK_PATH = '/veworld/callback';

const STORAGE_KEY = 'bigbottle.veworld_wallet_link';
const VEWORLD_LINK_BASE = 'https://www.veworld.com/api/v1';
const APP_NAME = 'BigBottle';

const VECHAIN_GENESIS_IDS = {
  main: '0x00000000851caf3cfdb6e899cf5958bfb1ac3413d346d43539627e6be7ec1b4a',
  test: '0x000000000b2bce3c70bc649a02749e8687721b09ed2e15997f466536b20bb127'
} as const;

const VEWORLD_EVENTS = {
  connected: 'onVeWorldConnected',
  signedTypedData: 'onVeWorldSignedTypedData'
} as const;

type VeChainNetworkType = keyof typeof VECHAIN_GENESIS_IDS;
type VeWorldEvent = (typeof VEWORLD_EVENTS)[keyof typeof VEWORLD_EVENTS];

type TypedDataMessage = {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  value: Record<string, unknown>;
};

export type VeWorldChallenge = {
  challenge_id: string;
  typed_data: TypedDataMessage;
};

type StoredState = {
  secretKey: string;
  publicKey: string;
  appUrl: string;
  returnTo: string;
  networkType: VeChainNetworkType;
  createdAt: number;
  address?: string;
  session?: string;
  veWorldPublicKey?: string;
  challenge?: VeWorldChallenge;
};

type VeWorldCallbackResponse = {
  data: string;
  nonce: string;
  publicKey: string;
};

type VeWorldConnectedData = {
  address: string;
  publicKey: string;
  session: string;
};

type VeWorldSignedTypedData = {
  signature: string;
};

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.localStorage;
    if (
      typeof storage?.getItem !== 'function' ||
      typeof storage.setItem !== 'function' ||
      typeof storage.removeItem !== 'function'
    ) {
      return null;
    }
    return storage;
  } catch {
    return null;
  }
}

function getStoredState(): StoredState | null {
  const raw = getStorage()?.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredState;
  } catch {
    clearVeWorldWalletLinkState();
    return null;
  }
}

function setStoredState(state: StoredState) {
  getStorage()?.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearVeWorldWalletLinkState() {
  getStorage()?.removeItem(STORAGE_KEY);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeUtf8(value: string): Uint8Array {
  return Uint8Array.from(new TextEncoder().encode(value));
}

function appUrl(): string {
  return window.location.origin;
}

function callbackUrl(event: VeWorldEvent, origin = appUrl()): string {
  return `${origin}${VEWORLD_CALLBACK_PATH}/${event}`;
}

function generateLink(method: 'connect' | 'signTypedData', payload: Record<string, string>): string {
  const params = new URLSearchParams(payload);
  return `${VEWORLD_LINK_BASE}/${method}?${params.toString()}`;
}

function currentReturnTo(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function isMobileBrowser(): boolean {
  const ua = window.navigator.userAgent;
  const platform = window.navigator.platform;
  const isClassicMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const isIpadDesktopMode = platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
  return isClassicMobile || isIpadDesktopMode;
}

export function isVeWorldInAppBrowser(): boolean {
  const vechain = (window as unknown as { vechain?: { isInAppBrowser?: boolean } }).vechain;
  return Boolean(vechain?.isInAppBrowser);
}

export function shouldUseVeWorldWalletLink(): boolean {
  if (typeof window === 'undefined') return false;
  const hasInjectedVeWorld = Boolean((window as unknown as { vechain?: unknown }).vechain);
  return !hasInjectedVeWorld && isMobileBrowser();
}

export function beginVeWorldWalletLinkLogin(input: {
  networkType: string;
  returnTo?: string;
}): string {
  if (input.networkType !== 'main' && input.networkType !== 'test') {
    throw new Error(`unsupported_veworld_wallet_link_network:${input.networkType}`);
  }

  const keyPair = nacl.box.keyPair();
  const origin = appUrl();
  const state: StoredState = {
    secretKey: bytesToBase64(keyPair.secretKey),
    publicKey: bytesToBase64(keyPair.publicKey),
    appUrl: origin,
    returnTo: input.returnTo ?? currentReturnTo(),
    networkType: input.networkType,
    createdAt: Date.now()
  };

  setStoredState(state);

  return generateLink('connect', {
    public_key: state.publicKey,
    app_name: APP_NAME,
    app_url: origin,
    genesis_id: VECHAIN_GENESIS_IDS[input.networkType],
    redirect_url: callbackUrl(VEWORLD_EVENTS.connected, origin)
  });
}

export function openVeWorldWalletLink(url: string) {
  window.location.assign(url);
}

function parseCallback(url: string): { event: string; response: VeWorldCallbackResponse } {
  const parsed = new URL(url, appUrl());
  const event = parsed.pathname.split('/').pop() ?? '';
  const errorCode = parsed.searchParams.get('errorCode');
  if (errorCode) {
    const errorMessage = parsed.searchParams.get('errorMessage') ?? errorCode;
    throw new Error(`veworld:${errorMessage}`);
  }

  const data = parsed.searchParams.get('data');
  const nonce = parsed.searchParams.get('nonce');
  const publicKey = parsed.searchParams.get('public_key');
  if (!data || !nonce || !publicKey) throw new Error('veworld:missing_callback_payload');

  return { event, response: { data, nonce, publicKey } };
}

function decryptCallbackPayload<T>(state: StoredState, response: VeWorldCallbackResponse): T {
  const keyPair = nacl.box.keyPair.fromSecretKey(base64ToBytes(state.secretKey));
  const decrypted = nacl.box.open(
    base64ToBytes(response.data),
    base64ToBytes(response.nonce),
    base64ToBytes(response.publicKey),
    keyPair.secretKey
  );

  if (!decrypted) throw new Error('veworld:decrypt_failed');
  return JSON.parse(new TextDecoder().decode(decrypted)) as T;
}

function encryptRequestPayload(state: StoredState, payload: Record<string, unknown>): [string, string] {
  if (!state.veWorldPublicKey) throw new Error('veworld:missing_wallet_public_key');

  const keyPair = nacl.box.keyPair.fromSecretKey(base64ToBytes(state.secretKey));
  const nonce = nacl.randomBytes(24);
  const encrypted = nacl.box(
    encodeUtf8(JSON.stringify(payload)),
    nonce,
    base64ToBytes(state.veWorldPublicKey),
    keyPair.secretKey
  );

  return [bytesToBase64(nonce), bytesToBase64(encrypted)];
}

export function completeVeWorldConnectedCallback(url: string): { address: string; returnTo: string } {
  const state = getStoredState();
  if (!state) throw new Error('veworld:missing_login_state');

  const { event, response } = parseCallback(url);
  if (event !== VEWORLD_EVENTS.connected) throw new Error(`veworld:unexpected_event:${event}`);

  const payload = decryptCallbackPayload<VeWorldConnectedData>(state, response);
  const nextState: StoredState = {
    ...state,
    address: payload.address,
    session: payload.session,
    veWorldPublicKey: response.publicKey
  };
  setStoredState(nextState);

  return { address: payload.address, returnTo: state.returnTo };
}

export function createVeWorldTypedDataUrl(challenge: VeWorldChallenge): string {
  const state = getStoredState();
  if (!state?.session || !state.address) throw new Error('veworld:missing_connected_state');

  const [nonce, encryptedPayload] = encryptRequestPayload(state, {
    typedData: {
      method: 'thor_signTypedData',
      options: {},
      domain: challenge.typed_data.domain,
      origin: state.appUrl,
      types: challenge.typed_data.types,
      value: challenge.typed_data.value
    },
    session: state.session
  });

  const request = {
    type: 'external-app',
    appName: APP_NAME,
    appUrl: state.appUrl,
    description: APP_NAME,
    publicKey: state.publicKey,
    nonce,
    payload: encryptedPayload,
    genesisId: VECHAIN_GENESIS_IDS[state.networkType]
  };

  setStoredState({ ...state, challenge });

  return generateLink('signTypedData', {
    request: bytesToBase64(encodeUtf8(JSON.stringify(request))),
    redirect_url: callbackUrl(VEWORLD_EVENTS.signedTypedData, state.appUrl)
  });
}

export function completeVeWorldSignedTypedDataCallback(url: string): {
  address: string;
  challengeId: string;
  signature: string;
} {
  const state = getStoredState();
  if (!state?.challenge || !state.address) throw new Error('veworld:missing_signature_state');

  const { event, response } = parseCallback(url);
  if (event !== VEWORLD_EVENTS.signedTypedData) throw new Error(`veworld:unexpected_event:${event}`);

  const payload = decryptCallbackPayload<VeWorldSignedTypedData>(state, response);
  return {
    address: state.address,
    challengeId: state.challenge.challenge_id,
    signature: payload.signature
  };
}
