import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
  fallback: (reset: () => void) => ReactNode;
  resetKeys?: unknown[];
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[app] error boundary caught a runtime error", { error, errorInfo });
  }

  componentDidUpdate(prevProps: AppErrorBoundaryProps) {
    const previousResetKeys = prevProps.resetKeys ?? [];
    const nextResetKeys = this.props.resetKeys ?? [];

    if (
      this.state.hasError &&
      (previousResetKeys.length !== nextResetKeys.length ||
        previousResetKeys.some((key, index) => key !== nextResetKeys[index]))
    ) {
      this.setState({ hasError: false });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return this.props.fallback(this.handleRetry);
    }

    return this.props.children;
  }
}