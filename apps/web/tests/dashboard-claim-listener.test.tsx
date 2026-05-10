import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import DashboardPage from '../src/app/pages/DashboardPage';

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
        user: {
          id: 'user-id',
          wallet_address: '0x0000000000000000000000000000000000000001',
          created_at: '2026-03-05T00:00:00.000Z'
        }
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

describe('DashboardPage claim listener', () => {
  let quoteState: typeof quote;
  let claimList: Array<typeof submittedClaim | typeof confirmedClaim>;

  beforeEach(() => {
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
    quoteState = quote;
    claimList = [];

    vi.stubGlobal('crypto', {
      randomUUID: () => '11111111-1111-1111-1111-111111111111'
    } as any);

    mocks.apiGet.mockImplementation((path: unknown) => {
      if (path === '/submissions') return Promise.resolve({ submissions: [] });
      if (path === '/rewards/quote') return Promise.resolve({ quote: quoteState });
      if (path === '/rewards/claims?limit=5') return Promise.resolve({ claims: claimList });
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
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('polls the claim status after submitting from the dashboard', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    const button = await screen.findByRole('button', { name: 'Claim' });

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.apiPost).toHaveBeenCalledWith(
      '/rewards/claim',
      { client_claim_id: '11111111-1111-1111-1111-111111111111' },
      'token'
    );
    expect(screen.getByText('Claim status')).toBeInTheDocument();

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
