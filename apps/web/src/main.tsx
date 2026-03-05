import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { VeChainKitProvider } from '@vechain/vechain-kit';

import App from './app/App';
import AppErrorBoundary from './app/components/AppErrorBoundary';
import { AuthProvider } from './state/auth';

import './style.css';

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <VeChainKitProvider
      network={{ type: 'test', nodeUrl: 'https://testnet.vechain.org/' }}
      dappKit={{
        allowedWallets: ['veworld', 'sync2', 'wallet-connect'],
        usePersistence: true,
        logLevel: 'DEBUG'
      }}
    >
      <AuthProvider>
        <BrowserRouter>
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
        </BrowserRouter>
      </AuthProvider>
    </VeChainKitProvider>
  </React.StrictMode>
);
