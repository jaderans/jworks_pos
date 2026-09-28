import { Component, type ReactNode } from 'react';

/** If a screen crashes, show a way out instead of a blank page. Sales already saved are safe. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page narrow">
        <div className="card pad-lg stack">
          <h1>Something went wrong on this screen</h1>
          <p className="muted">Everything already saved is safe on this device. Reload the app to continue.</p>
          <p className="mono small muted">{this.state.error.message}</p>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => window.location.reload()}>
              Reload the app
            </button>
            <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
