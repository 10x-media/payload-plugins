import { type ReactNode, useId } from 'react'
import { Card } from '../ui/components/Card'
import { shownValue } from '../ui/components/NoValue'
import '../ui/analytics.css'

/** @beta */
export interface WidgetCardProps {
	/** The widget kind's own hook, beside the shared `analytics-widget`. */
	className?: string
	title: string
	/** The window the card reads, on the title's line. Left out where there is nothing to read. */
	caption?: string
	/** The value row, the body and the note, in that order. */
	children?: ReactNode
	/** The footer link. No `href` renders no footer, which is how "the view is off" arrives. */
	link?: { href?: string; label: string }
}

/**
 * Dashboard card: title and window, content, and a footer link the title describes.
 * Its only hook is `useId`, which server components may call, so any widget can compose it.
 *
 * @beta
 */
export function WidgetCard({ className, title, caption, children, link }: WidgetCardProps) {
	const titleId = useId()
	return (
		<Card className={className ? `analytics-widget ${className}` : 'analytics-widget'}>
			<div className="analytics-widget__header">
				{/* The header keeps one line and cuts what does not fit, so hovering shows it whole. */}
				<h2 className="analytics-widget__title" id={titleId} title={title}>
					{title}
				</h2>
				{caption ? (
					<span className="analytics-widget__caption" title={caption}>
						{caption}
					</span>
				) : null}
			</div>
			{children}
			{link?.href === undefined ? null : (
				<div className="analytics-widget__footer">
					<a aria-describedby={titleId} className="analytics-widget__link" href={link.href}>
						{link.label}
					</a>
				</div>
			)}
		</Card>
	)
}

/**
 * The big number with its qualifiers (delta, caption) beside it. `before` is what a language
 * words ahead of the number; `noValueLabel` is read out in place of a missing reading's dash.
 *
 * @beta
 */
export function WidgetValue({
	value,
	noValueLabel,
	before,
	children,
}: {
	value: string
	noValueLabel?: string
	before?: ReactNode
	children?: ReactNode
}) {
	return (
		<div className="analytics-widget__value-row">
			{before}
			<span className="analytics-widget__value">{shownValue(value, noValueLabel)}</span>
			{children}
		</div>
	)
}

/**
 * The chart, list or table, given the height the card has left.
 *
 * @beta
 */
export function WidgetBody({ children }: { children: ReactNode }) {
	return <div className="analytics-widget__body">{children}</div>
}

/**
 * A message in place of the body, centered where the body would have been.
 *
 * @beta
 */
export function WidgetEmpty({ children }: { children: ReactNode }) {
	return <div className="analytics-widget__empty">{children}</div>
}

/**
 * The read's caveats, one line under the body; nothing at all when there are none.
 *
 * @beta
 */
export function WidgetNote({ children }: { children: string }) {
	return children === '' ? null : <span className="analytics-widget__note">{children}</span>
}
