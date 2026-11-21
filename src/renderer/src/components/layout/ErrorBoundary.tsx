import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '../ui/Button'

interface State {
  error: Error | null
}

/** Keeps one broken page from blanking the whole app; offers a way out. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void window.hub.app.log('error', `Render error: ${error.message}`, `${error.stack ?? ''}\n${info.componentStack ?? ''}`)
  }

  componentDidUpdate(prev: { resetKey?: string }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto max-w-2xl px-8 py-20">
        <div className="font-display text-[13px] font-bold uppercase tracking-[0.3em] text-tekken-500">Something went wrong</div>
        <h1 className="mt-2 font-display text-[36px] font-bold uppercase italic text-fg">This page crashed</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-zinc-400">
          The rest of ExpandedHub keeps working, and downloads continue in the background. The error was written to the app log
          (Settings → Advanced).
        </p>
        <pre className="selectable mt-5 max-h-48 overflow-auto rounded-lg bg-ink-850 p-4 text-[12px] text-zinc-400">{this.state.error.message}</pre>
        <div className="mt-6 flex gap-2">
          <Button variant="primary" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload app
          </Button>
        </div>
      </div>
    )
  }
}
