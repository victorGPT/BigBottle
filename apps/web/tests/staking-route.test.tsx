import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

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

describe('App staking route', () => {
  it('renders staking page at /staking instead of falling back to home', () => {
    render(
      <MemoryRouter initialEntries={['/staking']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Staking' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });
});
