import type { ReactNode } from 'react'
import { NO_VALUE } from '../../core/metricValues'
import '../analytics.css'

/** The dash for a missing reading, read out as `label` rather than as a minus sign. */
export function NoValue({ label }: { label: string }) {
	return (
		<>
			<span aria-hidden="true">{NO_VALUE}</span>
			<span className="analytics-sr-only">{label}</span>
		</>
	)
}

/**
 * `display` as it is, unless it is the dash for a missing reading and there is a word to read
 * out instead. Free of hooks, so a server component shows a value through it too.
 */
export const shownValue = (display: ReactNode, noValueLabel: string | undefined): ReactNode =>
	display === NO_VALUE && noValueLabel !== undefined ? <NoValue label={noValueLabel} /> : display
