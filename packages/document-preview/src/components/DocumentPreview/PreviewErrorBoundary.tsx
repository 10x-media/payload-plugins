'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode; fallback: ReactNode }

type State = { failed: boolean }

/**
 * Contains a viewer crash (a parser throwing, a chunk failing to load after a
 * deploy) to the preview instead of the whole edit view. Keyed by file URL at
 * the call site, so a different file starts fresh.
 */
export class PreviewErrorBoundary extends Component<Props, State> {
	override state: State = { failed: false }

	static getDerivedStateFromError(): State {
		return { failed: true }
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error('[document-preview] viewer crashed', error, info.componentStack)
	}

	override render() {
		return this.state.failed ? this.props.fallback : this.props.children
	}
}
