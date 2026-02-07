import { Navigate } from 'react-router-dom';
import { useAuth } from '../../state/auth';
import Screen from './Screen';

export default function RequireLogin(props: { children: React.ReactNode }) {
  const { state } = useAuth();

  if (state.status === 'loading') {
    return (
      <Screen>
        <div className="flex min-h-dvh items-center justify-center">
          <div className="text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-emerald-300" />
            <div className="mt-3 text-xs tracking-widest text-white/70">LOADING</div>
          </div>
        </div>
      </Screen>
    );
  }

  if (state.status === 'anonymous') {
    return <Navigate to="/" replace />;
  }

  return <>{props.children}</>;
}
