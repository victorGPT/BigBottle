import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn()
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
    apiGet: (...args: unknown[]) => mocks.apiGet(...args)
  };
});

describe('App staking route offline', () => {
  beforeEach(() => {
    mocks.apiGet.mockReset();
  });

  it('redirects /staking to home and removes the nav entry', async () => {
    render(
      <MemoryRouter initialEntries={['/staking']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Staking' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'RESTAKE' })).not.toBeInTheDocument();
  });
});
