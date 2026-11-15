"use client";

import { Component, type ReactNode } from "react";
import { reportClientError } from "@/lib/client-error";

// Error boundary around the Turnstile widget (and its next/script loader).
// A Turnstile failure — e.g. the script failing to inject — must show an
// inline message with a Retry button here, never take down the whole
// sign-up form or land the user on the full-page error screen.
export default class TurnstileBoundary extends Component<
  { children: ReactNode; onRetry?: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error & { digest?: string }) {
    reportClientError(error);
  }

  handleRetry = () => {
    this.setState({ failed: false });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.failed) {
      return (
        <div className="turnstile-boundary-error" role="alert">
          <p className="turnstile-status">
            The security check couldn’t load. Please try again.
          </p>
          <button
            className="button button-quiet"
            type="button"
            onClick={this.handleRetry}
          >
            Retry security check
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
