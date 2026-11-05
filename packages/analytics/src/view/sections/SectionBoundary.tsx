'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface SectionBoundaryProps {
	children: ReactNode
	/** Translated fallback, rendered in place of the section that threw. */
	label: string
	/**
	 * What the section shows; a change clears the failure. Without it, a section that threw on one
	 * range or filter stays a fallback for the life of the view.
	 */
	resetKey?: string
}

interface SectionBoundaryState {
	failed: boolean
}

/**
 * Keeps one throwing section from blanking the dashboard. Class component because React has no
 * hook form of an error boundary.
 */
export class SectionBoundary extends Component<SectionBoundaryProps, SectionBoundaryState> {
	override state: SectionBoundaryState = { failed: false }

	static getDerivedStateFromError(): SectionBoundaryState {
		return { failed: true }
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error('analytics: view section failed', error, info.componentStack)
	}

	override componentDidUpdate(previous: SectionBoundaryProps): void {
		if (this.state.failed && previous.resetKey !== this.props.resetKey) {
			this.setState({ failed: false })
		}
	}

	override render(): ReactNode {
		if (this.state.failed) {
			return (
				<section className="analytics-card analytics-view__panel analytics-view__section">
					<span className="analytics-view__empty">{this.props.label}</span>
				</section>
			)
		}
		return this.props.children
	}
}
