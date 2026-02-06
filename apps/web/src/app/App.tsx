import { Navigate, Route, Routes } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import WalletPage from './pages/WalletPage';
import ScanPage from './pages/ScanPage';
import ResultPage from './pages/ResultPage';
import RequireLogin from './components/RequireLogin';

export default function App() {
  return (
    <Routes>
      <Route path="/wallet" element={<WalletPage />} />

      <Route
        path="/"
        element={
          <RequireLogin>
            <DashboardPage />
          </RequireLogin>
        }
      />
      <Route
        path="/scan"
        element={
          <RequireLogin>
            <ScanPage />
          </RequireLogin>
        }
      />
      <Route
        path="/result/:id"
        element={
          <RequireLogin>
            <ResultPage />
          </RequireLogin>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

