import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches render-time errors from anything inside it and shows a fallback
 * instead of letting the error propagate to the React root and blank the whole
 * app. React's try/catch (as in the package's TrackContent) does NOT catch
 * errors thrown *inside* a component's render — only a class error boundary
 * with getDerivedStateFromError does. Without this, one track that throws while
 * rendering (e.g. at an untested locus) white-screens everything.
 *
 * `resetKeys` lets the boundary recover: when any key changes (e.g. the region),
 * it clears the error and retries — so navigating away from a bad locus brings
 * the UI back instead of staying stuck on the fallback.
 */
type Props = {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  resetKeys?: unknown[];
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface it for debugging; the app stays alive.
    console.error("Track/render error caught by boundary:", error, info);
  }

  componentDidUpdate(prev: Props) {
    // If any reset key changed while showing an error, clear and retry.
    if (this.state.error && prev.resetKeys && this.props.resetKeys) {
      const changed = this.props.resetKeys.some((k, i) => k !== prev.resetKeys![i]);
      if (changed) this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (error) {
      const reset = () => this.setState({ error: null });
      if (this.props.fallback) return this.props.fallback(error, reset);
      return (
        <div
          style={{
            padding: 16,
            margin: "12px 0",
            border: "1px solid #e0c0c0",
            borderRadius: 6,
            background: "#fcf4f4",
            color: "#7a2a2a",
            fontSize: 14,
          }}
        >
          <strong>Something went wrong rendering this view.</strong>
          <div style={{ fontSize: 12, margin: "6px 0", color: "#996666" }}>
            {error.message}
          </div>
          <button onClick={reset}>Try again</button>{" "}
          <span style={{ fontSize: 12, color: "#996666" }}>
            or search / navigate to another locus.
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}
