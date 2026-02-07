import React from 'react';

import Screen from './Screen';

type Props = {
  children: React.ReactNode;
};

type State = {
  error: Error | null;
};

export default class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep a console breadcrumb for debugging; render a user-friendly fallback UI.
    console.error('App crashed', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <Screen>
          <div className="flex min-h-dvh items-center justify-center px-6">
            <div className="w-full max-w-[420px] rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-semibold">Something went wrong</div>
              <div className="mt-2 break-words text-xs text-white/60">{this.state.error.message}</div>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 w-full rounded-2xl bg-white/10 py-3 text-xs font-semibold text-white transition active:scale-[0.99]"
              >
                Reload
              </button>
            </div>
          </div>
        </Screen>
      );
    }

    return this.props.children;
  }
}

