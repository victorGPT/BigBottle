import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { DAppKitProvider } from '@vechain/dapp-kit-react';

import App from './app/App';
import AppErrorBoundary from './app/components/AppErrorBoundary';
import { AuthProvider } from './state/auth';

import './style.css';

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <DAppKitProvider node="https://testnet.vechain.org/" usePersistence logLevel="DEBUG">
      <AuthProvider>
        <BrowserRouter>
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
        </BrowserRouter>
      </AuthProvider>
    </DAppKitProvider>
  </React.StrictMode>
);
