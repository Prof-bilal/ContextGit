import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  feature?: string;
  fallback?: (error: Error, retry: () => void) => ReactNode;
  onError?: (error: Error) => void;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Keeps a render error inside one view from blanking the whole window (and makes
 * the failure readable instead of a white void). "Try again" re-renders the tree.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(cause: unknown): State {
    return { error: cause instanceof Error ? cause : new Error(String(cause)) };
  }

  componentDidCatch(cause: unknown, info: ErrorInfo): void {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    console.error(`${this.props.feature ?? "Workspace"} crashed:`, error, info.componentStack);
    this.props.onError?.(error);
  }

  private retry = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.retry);
    return (
      <section className={this.props.feature ? "cg-feature-error" : "backend-screen"} role="alert" data-failed-feature={this.props.feature}>
        <p className="backend-kicker">ContextGit</p>
        <h1>{this.props.feature ? `${this.props.feature} hit an error` : "This view hit an error"}</h1>
        <pre className="backend-detail">{error.message}</pre>
        <button type="button" onClick={this.retry}>
          Try again
        </button>
      </section>
    );
  }
}
