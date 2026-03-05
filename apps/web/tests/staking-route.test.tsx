import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn()
}));

vi.mock('../src/app/pages/AccountPage', () => ({
  default: () => <div>Account Page Mock</div>
}));

import App from '../src/app/App';

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

describe('App staking route', () => {
  beforeEach(() => {
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();

    mocks.apiGet.mockImplementation((path: unknown) => {
      if (path === '/rewards/quote') {
        return Promise.resolve({
          quote: {
            points_total: 123,
            points_locked: 12,
            points_available: 111,
            points_per_b3tr: 100,
            conversion_rate_id: 'rate-1',
            b3tr_amount_wei: '1110000000000000000',
            b3tr_amount: '1.11'
          }
        });
      }
      if (path === '/rewards/claims?limit=20') {
        return Promise.resolve({ claims: [] });
      }
      return Promise.reject(new Error(`Unexpected apiGet path: ${String(path)}`));
    });
  });

  it('renders staking page at /staking instead of falling back to home', async () => {
    render(
      <MemoryRouter initialEntries={['/staking']}>
        <App />
      </MemoryRouter>
    );

    await screen.findByText('CLAIMABLE');
    expect(screen.getByRole('link', { name: 'Staking' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
  });
});
