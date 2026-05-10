import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import RewardsPage from '../src/app/pages/RewardsPage';

const mocks = vi.hoisted(() => {
  return {
    apiGet: vi.fn(),
    apiPost: vi.fn()
  };
});

const quote = {
  points_total: 15,
  points_locked: 0,
  points_available: 15,
  points_per_b3tr: 10,
  conversion_rate_id: 'rate-1',
  b3tr_amount_wei: '1500000000000000000',
  b3tr_amount: '1.5'
};

const claimedQuote = {
  ...quote,
  points_locked: 0,
  points_available: 0,
  b3tr_amount_wei: '0',
  b3tr_amount: '0'
};

const submittedClaim = {
  id: 'claim-1',
  client_claim_id: '11111111-1111-1111-1111-111111111111',
  wallet_address: '0x0000000000000000000000000000000000000001',
  conversion_rate_id: 'rate-1',
  points_per_b3tr_snapshot: 10,
  points_claimed: 15,
  b3tr_amount_wei: '1500000000000000000',
  b3tr_amount: '1.5',
  status: 'submitted',
  tx_hash: '0x' + '1'.repeat(64),
  failure_reason: null,
  created_at: '2026-03-05T00:00:00.000Z',
  updated_at: '2026-03-05T00:00:00.000Z'
} as const;

const confirmedClaim = {
  ...submittedClaim,
  status: 'confirmed',
  updated_at: '2026-03-05T00:00:02.000Z'
} as const;

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
        return Promise.resolve({ quote });
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
            ...confirmedClaim,
            status: 'confirmed',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        });
      }
      throw new Error(`Unexpected apiPost path: ${String(path)}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads quote and submits a claim request with a client id', async () => {
    render(
      <MemoryRouter initialEntries={['/rewards']}>
        <RewardsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Claimable')).toBeInTheDocument();
    expect(screen.getByText('1.5')).toBeInTheDocument();
    expect(screen.getByText(/Exchange rate/)).toBeInTheDocument();

    const btn = screen.getByRole('button', { name: 'Claim' });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mocks.apiPost).toHaveBeenCalledWith(
        '/rewards/claim',
        { client_claim_id: '11111111-1111-1111-1111-111111111111' },
        'token'
      );
    });
  });

  it('shows claimed after an in-flight claim confirms', async () => {
    let quoteState = quote;
    let claimList: Array<typeof submittedClaim | typeof confirmedClaim> = [];

    mocks.apiGet.mockImplementation((path: unknown) => {
      if (path === '/rewards/quote') return Promise.resolve({ quote: quoteState });
      if (path === '/rewards/claims?limit=20') return Promise.resolve({ claims: claimList });
      if (path === '/rewards/claims/claim-1') {
        quoteState = claimedQuote;
        claimList = [confirmedClaim];
        return Promise.resolve({ claim: confirmedClaim });
      }
      throw new Error(`Unexpected apiGet path: ${String(path)}`);
    });

    mocks.apiPost.mockImplementation((path: unknown) => {
      if (path === '/rewards/claim') {
        claimList = [submittedClaim];
        return Promise.resolve({ claim: submittedClaim });
      }
      throw new Error(`Unexpected apiPost path: ${String(path)}`);
    });

    render(
      <MemoryRouter initialEntries={['/rewards']}>
        <RewardsPage />
      </MemoryRouter>
    );

    const btn = await screen.findByRole('button', { name: 'Claim' });

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Claim status')).toBeInTheDocument();
    expect(screen.getAllByText('Submitted').length).toBeGreaterThan(0);

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.apiGet).toHaveBeenCalledWith('/rewards/claims/claim-1', 'token');
    expect(screen.getByRole('button', { name: 'Claimed' })).toBeDisabled();
    expect(screen.getByText('Claimed. B3TR has been sent to your wallet.')).toBeInTheDocument();
  });
});
