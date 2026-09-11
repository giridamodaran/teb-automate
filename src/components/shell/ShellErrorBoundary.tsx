"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ShellErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App shell failed to render", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-[#f4f7fb] p-6">
          <div className="max-w-lg rounded-xl border border-red-200 bg-white p-6 text-sm text-red-700">
            <p className="font-semibold">Ask could not render this screen.</p>
            <p className="mt-2 text-xs text-slate-600">Reload Ask to continue.</p>
            <button
              type="button"
              className="mt-4 rounded-md border border-slate-200 px-3 py-1.5 text-slate-700"
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
            >
              Reload Ask
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
