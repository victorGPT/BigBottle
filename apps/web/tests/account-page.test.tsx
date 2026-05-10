import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AccountPage from '../src/app/pages/AccountPage';
import i18n from '../src/i18n';

const mocks = vi.hoisted(() => {
  return {
    navigate: vi.fn(),
    setToken: vi.fn(),
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    connect: vi.fn(),
    setSource: vi.fn(),
    requestTypedData: vi.fn(),
    logout: vi.fn(),
    authState: {
      status: 'anonymous',
      token: null,
      user: null
    } as unknown
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
      state: mocks.authState,
      setToken: mocks.setToken,
      logout: mocks.logout
    })
  };
});

vi.mock('../src/util/api', () => {
  return {
    apiGet: (...args: unknown[]) => mocks.apiGet(...args),
    apiPost: (...args: unknown[]) => mocks.apiPost(...args)
  };
});

vi.mock('@vechain/vechain-kit', () => {
  return {
    useDAppKitWallet: () => ({
      connect: mocks.connect,
      setSource: mocks.setSource,
      account: null,
      source: null,
      requestTypedData: mocks.requestTypedData
    })
  };
});

describe('AccountPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.navigate.mockReset();
    mocks.setToken.mockReset();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
    mocks.connect.mockReset();
    mocks.setSource.mockReset();
    mocks.requestTypedData.mockReset();
    mocks.logout.mockReset();
    mocks.authState = { status: 'anonymous', token: null, user: null };
    mocks.apiGet.mockResolvedValue({
      user: {
        id: 'user',
        wallet_address: '0x0000000000000000000000000000000000000001',
        created_at: 'now'
      }
    });

    // Make AccountPage treat VeWorld as available.
    (window as any).vechain = {};
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as any).vechain;
    void i18n.changeLanguage('en');
  });

  it('localizes known achievement copy instead of rendering API-provided Chinese copy', async () => {
    mocks.authState = {
      status: 'logged_in',
      token: 'token',
      user: {
        id: 'user',
        wallet_address: '0x0000000000000000000000000000000000000001',
        created_at: 'now'
      }
    };

    await i18n.changeLanguage('en');
    vi.useRealTimers();

    mocks.apiGet.mockImplementation((path: unknown) => {
      if (path === '/account/summary') {
        return Promise.resolve({ summary: { points_total: 120, level: null } });
      }

      if (path === '/account/achievements') {
        return Promise.resolve({
          achievements: [
            {
              key: 'vebetter_vote_bonus',
              title: '投票用户',
              description: '参与 VeBetterDAO 任一投票中参与过投票，下期获得 BigPortal 积分加成。',
              badge: 'governance',
              tag_label: '投票用户',
              unlocked: true,
              multiplier: 1.2,
              status: 'unlocked',
              effective_round_id: 7,
              source_round_id: 6,
              node_name: null,
              node_level: null
            },
            {
              key: 'gm_nft',
              title: 'GM-NFT',
              description: '已持有最高等级 GM-NFT：火星',
              badge: 'gm_nft',
              tag_label: 'GM-NFT',
              unlocked: true,
              multiplier: 1.3,
              status: 'unlocked',
              effective_round_id: null,
              source_round_id: null,
              node_name: '火星',
              node_level: 5
            }
          ],
          summary: {
            unlocked_count: 2,
            total_count: 2,
            total_multiplier: 1.56
          }
        });
      }

      throw new Error(`Unexpected apiGet path: ${String(path)}`);
    });

    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('VeBetterDAO Voter')).toBeInTheDocument();
    expect(screen.getByText('Vote in VeBetterDAO to unlock a BigPortal points multiplier next round.')).toBeInTheDocument();
    expect(screen.getByText('Highest GM-NFT node detected: Jupiter.')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText('投票用户')).not.toBeInTheDocument();
      expect(screen.queryByText('参与 VeBetterDAO 任一投票中参与过投票，下期获得 BigPortal 积分加成。')).not.toBeInTheDocument();
      expect(screen.queryByText('已持有最高等级 GM-NFT：火星')).not.toBeInTheDocument();
    });
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

    render(<AccountPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

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
    expect(mocks.apiGet).toHaveBeenCalledWith('/me', 'token');
    expect(mocks.setToken).toHaveBeenCalledWith('token', {
      id: 'user',
      wallet_address: address,
      created_at: 'now'
    });
    expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('retries typed-data signing without chainId when VeWorld reports invalid signed data message', async () => {
    const address = '0x0000000000000000000000000000000000000001';
    mocks.connect.mockResolvedValue({ account: address });
    mocks.requestTypedData
      .mockRejectedValueOnce(new Error('Invalid signed data message'))
      .mockResolvedValueOnce('0xsig');

    const challenge = {
      challenge_id: '11111111-1111-1111-1111-111111111111',
      typed_data: {
        domain: { name: 'BigBottle', version: '1', chainId: 100010 },
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

    render(<AccountPage />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Log in' })[0]!);

    await vi.advanceTimersByTimeAsync(450);
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.requestTypedData).toHaveBeenNthCalledWith(
      1,
      challenge.typed_data.domain,
      challenge.typed_data.types,
      challenge.typed_data.value,
      { signer: address }
    );

    expect(mocks.requestTypedData).toHaveBeenNthCalledWith(
      2,
      { name: 'BigBottle', version: '1' },
      challenge.typed_data.types,
      challenge.typed_data.value,
      { signer: address }
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.apiPost).toHaveBeenCalledWith(
      '/auth/verify',
      { challenge_id: challenge.challenge_id, signature: '0xsig' },
      null
    );
  });
});
