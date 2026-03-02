import React, { Component } from 'react';

interface ErrorBoundaryProps {
    children: React.ReactNode;
    fallbackTitle?: string;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex items-center justify-center p-8 min-h-50">
                    <div className="bg-zinc-900 border border-zinc-700/50 rounded-xl p-6 max-w-md w-full text-center space-y-3">
                        <div className="text-2xl">⚠️</div>
                        <h3 className="text-sm font-medium text-zinc-200">
                            {this.props.fallbackTitle || 'Something went wrong'}
                        </h3>
                        <p className="text-xs text-zinc-500">
                            This section crashed unexpectedly. Your notes are safe.
                        </p>
                        {this.state.error && (
                            <p className="text-[10px] text-zinc-600 font-mono bg-zinc-800/50 rounded-md px-3 py-2 text-left break-all">
                                {this.state.error.message}
                            </p>
                        )}
                        <div className="flex items-center justify-center gap-2 pt-2">
                            <button
                                onClick={this.handleRetry}
                                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors cursor-pointer"
                            >
                                Try again
                            </button>
                            <button
                                onClick={() => {
                                    const subject = encodeURIComponent('Bug Report: Crash');
                                    const body = encodeURIComponent(
                                        `Error: ${this.state.error?.message}\n\nStack: ${this.state.error?.stack}`
                                    );
                                    window.open(
                                        `https://github.com/OnyxVoidLabs/onyx/issues/new?title=${subject}&body=${body}`,
                                        '_blank'
                                    );
                                }}
                                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer"
                            >
                                Report issue
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
