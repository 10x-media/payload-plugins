import type { ReactNode } from 'react'
import { classNames } from '../classNames'
import { shownValue } from './NoValue'
import '../analytics.css'

/** @beta */
export interface MetricCardProps {
	label: string
	/** The formatted reading, a dash where there is none. */
	value: string
	/** Read out in place of the dash a missing reading shows. */
	noValueLabel?: string
	/** What qualifies the number under it: the period-over-period delta. */
	children?: ReactNode
	/**
	 * Makes the card a toggle button in its own card chrome, pressed while it is the one charted,
	 * as the analytics view's overview is. Left out, it is a plain figure inside whatever holds it.
	 */
	onSelect?: () => void
	pressed?: boolean
	/** The surface's own hook beside `analytics-metric`. */
	className?: string
}

/**
 * One metric as every surface shows it, label over number over delta. Hook-free, so a server
 * component renders it too.
 *
 * @beta
 */
export function MetricCard({
	label,
	value,
	noValueLabel,
	children,
	onSelect,
	pressed,
	className,
}: MetricCardProps) {
	const content = (
		<>
			<span className="analytics-metric__label">{label}</span>
			<span className="analytics-metric__value">{shownValue(value, noValueLabel)}</span>
			{children}
		</>
	)
	if (onSelect) {
		return (
			<button
				aria-pressed={pressed === true}
				className={classNames(
					'analytics-card analytics-metric analytics-metric--action',
					className
				)}
				onClick={onSelect}
				type="button"
			>
				{content}
			</button>
		)
	}
	return <div className={classNames('analytics-metric', className)}>{content}</div>
}
