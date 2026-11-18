import {
  Component,
  type ComponentType,
  type ReactNode,
} from 'react';

export interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

function DefaultFallback({ error, resetError }: ErrorFallbackProps) {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-6">
      <div className="surface w-full max-w-lg rounded-xl p-8 text-center">
        <h1 className="text-[18px] font-bold">Щось пішло не так</h1>
        <p className="mt-2 text-[12px] text-dim">У цій частині застосунку сталася помилка. Решта застосунку працює.</p>
        {import.meta.env.DEV ? (
          <pre className="mt-4 overflow-x-auto rounded bg-[hsl(var(--secondary))] p-3 text-left text-[11px]">{error.message || String(error)}</pre>
        ) : null}
        <button type="button" onClick={resetError} className="action-primary mx-auto mt-5">Спробувати ще раз</button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.resetError();
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const Fallback = this.props.FallbackComponent ?? DefaultFallback;
    return <Fallback error={error} resetError={this.resetError} />;
  }
}
