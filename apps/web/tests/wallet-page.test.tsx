import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import WalletPage from '../src/app/pages/WalletPage';

const mocks = vi.hoisted(() => {
  return {
    navigate: vi.fn(),
    setToken: vi.fn(),
    apiPost: vi.fn(),
    connect: vi.fn(),
    setSource: vi.fn(),
    requestTypedData: vi.fn()
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
      state: { status: 'anonymous', token: null, user: null },
      setToken: mocks.setToken
    })
  };
});

vi.mock('../src/util/api', () => {
  return {
    apiPost: (...args: unknown[]) => mocks.apiPost(...args)
  };
});

vi.mock('@vechain/dapp-kit-react', () => {
  return {
    useWallet: () => ({
      connect: mocks.connect,
      setSource: mocks.setSource,
      account: null,
      source: null,
      requestTypedData: mocks.requestTypedData
    })
  };
});

describe('WalletPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.navigate.mockReset();
    mocks.setToken.mockReset();
    mocks.apiPost.mockReset();
    mocks.connect.mockReset();
    mocks.setSource.mockReset();
    mocks.requestTypedData.mockReset();

    // Make WalletPage treat VeWorld as available.
    (window as any).vechain = {};
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as any).vechain;
  });

  it('waits after connect and signs typed data with explicit signer', async () => {
    const address = '0x0000000000000000000000000000000000000001';
    mocks.connect.mockResolvedValue({ account: address });
    mocks.requestTypedData.mockResolvedValue('0xsig');

    const challenge = {
      challenge_id: '11111111-1111-1111-1111-111111111111',
      typed_data: {
        domain: { name: 'BigBottle', version: '1' },
        types: {
          Login: [
            { name: 'challengeId', type: 'string' },
            { name: 'wallet', type: 'address' },
            { name: 'nonce', type: 'string' }
          ]
        },
        value: { challengeId: '11111111-1111-1111-1111-111111111111', wallet: address, nonce: 'abc' }
      }
    };

    mocks.apiPost.mockImplementation((path: unknown) => {
      if (path === '/auth/challenge') return Promise.resolve(challenge);
      if (path === '/auth/verify') {
        return Promise.resolve({
          access_token: 'token',
          user: { id: 'user', wallet_address: address, created_at: 'now' }
        });
      }
      throw new Error(`Unexpected apiPost path: ${String(path)}`);
    });

    render(<WalletPage />);

    fireEvent.click(screen.getByRole('button', { name: '立即登录' }));

    // connect() runs immediately, but the typed-data signing must not start until the post-connect delay elapses.
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.requestTypedData).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(449);
    await Promise.resolve();
    expect(mocks.requestTypedData).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    expect(mocks.apiPost).toHaveBeenCalledWith('/auth/challenge', { address }, null);
    expect(mocks.requestTypedData).toHaveBeenCalledWith(
      challenge.typed_data.domain,
      challenge.typed_data.types,
      challenge.typed_data.value,
      { signer: address }
    );

    // Allow the verify call + final state updates to settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.apiPost).toHaveBeenCalledWith(
      '/auth/verify',
      { challenge_id: challenge.challenge_id, signature: '0xsig' },
      null
    );
    expect(mocks.setToken).toHaveBeenCalledWith('token');
    expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
  });
});
