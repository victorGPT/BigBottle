import { Navigate, Route, Routes } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import AccountPage from './pages/AccountPage';
import ScanPage from './pages/ScanPage';
import ResultPage from './pages/ResultPage';
import RewardsPage from './pages/RewardsPage';
import VeWorldCallbackPage from './pages/VeWorldCallbackPage';
import RequireLogin from './components/RequireLogin';

export default function App() {
  return (
    <Routes>
      <Route path="/account" element={<AccountPage />} />
      <Route path="/veworld/callback/:event" element={<VeWorldCallbackPage />} />

      <Route path="/" element={<DashboardPage />} />
      <Route
        path="/rewards"
        element={
          <RequireLogin>
            <RewardsPage />
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
