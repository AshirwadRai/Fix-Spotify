import { Component } from 'react';

/**
 * Any render throw used to leave a blank white screen with no way back — the
 * user just saw the app "crash". Show what happened and let them recover.
 */
export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('render crash', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-spotify-base px-8 text-center">
        <p className="text-lg font-bold">Something broke</p>
        <p className="text-[13px] text-spotify-text-subdued break-all">
          {String(this.state.error?.message || this.state.error)}
        </p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="tap rounded-full bg-spotify-essential-bright-accent px-5 py-2 text-[13px] font-semibold text-black"
        >
          Go back
        </button>
      </div>
    );
  }
}
