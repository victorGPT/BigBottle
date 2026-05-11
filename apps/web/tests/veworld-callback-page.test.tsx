import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import VeWorldCallbackPage from '../src/app/pages/VeWorldCallbackPage';

const mocks = vi.hoisted(() => {
  return {
    navigate: vi.fn(),
    setToken: vi.fn(),
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    clearVeWorldWalletLinkState: vi.fn(),
    completeVeWorldConnectedCallback: vi.fn(),
    completeVeWorldSignedTypedDataCallback: vi.fn(),
    createVeWorldTypedDataUrl: vi.fn(),
    openVeWorldWalletLink: vi.fn()
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate
  };
});

vi.mock('../src/state/auth', () => {
  return {
    useAuth: () => ({
      setToken: mocks.setToken
    })
  };
});

vi.mock('../src/util/api', () => {
  return {
    apiGet: (...args: unknown[]) => mocks.apiGet(...args),
    apiPost: (...args: unknown[]) => mocks.apiPost(...args)
  };
});

vi.mock('../src/util/veworldWalletLink', () => {
  return {
    clearVeWorldWalletLinkState: (...args: unknown[]) => mocks.clearVeWorldWalletLinkState(...args),
    completeVeWorldConnectedCallback: (...args: unknown[]) => mocks.completeVeWorldConnectedCallback(...args),
    completeVeWorldSignedTypedDataCallback: (...args: unknown[]) => mocks.completeVeWorldSignedTypedDataCallback(...args),
    createVeWorldTypedDataUrl: (...args: unknown[]) => mocks.createVeWorldTypedDataUrl(...args),
    openVeWorldWalletLink: (...args: unknown[]) => mocks.openVeWorldWalletLink(...args)
  };
});

describe('VeWorldCallbackPage', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.setToken.mockReset();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
    mocks.clearVeWorldWalletLinkState.mockReset();
    mocks.completeVeWorldConnectedCallback.mockReset();
    mocks.completeVeWorldSignedTypedDataCallback.mockReset();
    mocks.createVeWorldTypedDataUrl.mockReset();
    mocks.openVeWorldWalletLink.mockReset();

    window.history.pushState({}, '', '/veworld/callback/onVeWorldSignedTypedData?data=test&nonce=test&public_key=test');
    mocks.completeVeWorldSignedTypedDataCallback.mockReturnValue({
      address: '0x0000000000000000000000000000000000000001',
      challengeId: 'challenge-1',
      signature: '0xsig'
    });
    mocks.apiPost.mockResolvedValue({
      access_token: 'token',
      user: {
        id: 'user',
        wallet_address: '0x0000000000000000000000000000000000000001',
        created_at: 'now'
      }
    });
    mocks.apiGet.mockResolvedValue({
      user: {
        id: 'user',
        wallet_address: '0x0000000000000000000000000000000000000001',
        created_at: 'now'
      }
    });
    mocks.setToken.mockResolvedValue(undefined);
  });

  it('does not verify the same signed callback twice after rerender', async () => {
    const { rerender } = render(
      <MemoryRouter>
        <VeWorldCallbackPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mocks.apiPost).toHaveBeenCalledTimes(1);
    });

    mocks.setToken = vi.fn().mockResolvedValue(undefined);
    rerender(
      <MemoryRouter>
        <VeWorldCallbackPage />
      </MemoryRouter>
    );

    await Promise.resolve();

    expect(mocks.apiPost).toHaveBeenCalledTimes(1);
    expect(mocks.apiPost).toHaveBeenCalledWith(
      '/auth/verify',
      { challenge_id: 'challenge-1', signature: '0xsig' },
      null
    );
  });
});
