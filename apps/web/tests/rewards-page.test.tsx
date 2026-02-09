import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import RewardsPage from '../src/app/pages/RewardsPage';

const mocks = vi.hoisted(() => {
  return {
    apiGet: vi.fn(),
    apiPost: vi.fn()
  };
});

vi.mock('../src/state/auth', () => {
  return {
    useAuth: () => ({
      state: {
        status: 'logged_in',
        token: 'token',
        user: { id: 'user', wallet_address: '0x0000000000000000000000000000000000000001', created_at: 'now' }
      }
    })
  };
});

vi.mock('../src/util/api', () => {
  return {
    apiGet: (...args: unknown[]) => mocks.apiGet(...args),
    apiPost: (...args: unknown[]) => mocks.apiPost(...args)
  };
});

describe('RewardsPage', () => {
  beforeEach(() => {
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();

    vi.stubGlobal('crypto', {
      randomUUID: () => '11111111-1111-1111-1111-111111111111'
    } as any);

    mocks.apiGet.mockImplementation((path: unknown) => {
      if (path === '/rewards/quote') {
        return Promise.resolve({
          quote: {
            points_total: 15,
            points_locked: 0,
            points_available: 15,
            points_per_b3tr: 10,
            conversion_rate_id: 'rate-1',
            b3tr_amount_wei: '1500000000000000000',
            b3tr_amount: '1.5'
          }
        });
      }
      if (typeof path === 'string' && path.startsWith('/rewards/claims')) {
        return Promise.resolve({ claims: [] });
      }
      throw new Error(`Unexpected apiGet path: ${String(path)}`);
    });

    mocks.apiPost.mockImplementation((path: unknown) => {
      if (path === '/rewards/claim') {
        return Promise.resolve({
          claim: {
            id: 'claim-1',
            client_claim_id: '11111111-1111-1111-1111-111111111111',
            wallet_address: '0x0000000000000000000000000000000000000001',
            conversion_rate_id: 'rate-1',
            points_per_b3tr_snapshot: 10,
            points_claimed: 15,
            b3tr_amount_wei: '1500000000000000000',
            b3tr_amount: '1.5',
            status: 'confirmed',
            tx_hash: '0x' + '1'.repeat(64),
            failure_reason: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        });
      }
      throw new Error(`Unexpected apiPost path: ${String(path)}`);
    });
  });

  it('loads quote and submits a claim request with a client id', async () => {
    render(
      <MemoryRouter initialEntries={['/rewards']}>
        <RewardsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('CLAIMABLE')).toBeInTheDocument();
    expect(screen.getByText('1.5')).toBeInTheDocument();
    expect(screen.getByText(/当前兑换率/)).toBeInTheDocument();

    const btn = screen.getByRole('button', { name: 'CLAIM' });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mocks.apiPost).toHaveBeenCalledWith(
        '/rewards/claim',
        { client_claim_id: '11111111-1111-1111-1111-111111111111' },
        'token'
      );
    });
  });
});
