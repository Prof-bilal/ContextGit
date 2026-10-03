import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
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

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Workspace view crashed:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="backend-screen" role="alert">
        <p className="backend-kicker">ContextGit</p>
        <h1>This view hit an error</h1>
        <pre className="backend-detail">{error.message}</pre>
        <button type="button" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </main>
    );
  }
}
