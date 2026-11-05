import type { ReactNode } from 'react'
import { classNames } from '../classNames'
import type { RetryOffer } from '../readState'
import { RefreshButton } from './RefreshButton'
import '../analytics.css'

/**
 * A read's state in place of its numbers, with when and how to retry a fixable failure. A client
 * surface passes its own retry control as `action`.
 */
export function ReadState({
	message,
	retry,
	action,
	align = 'center',
}: {
	message: string
	retry?: RetryOffer | undefined
	action?: ReactNode
	align?: 'center' | 'start'
}) {
	return (
		<span
			className={classNames('analytics-state', align === 'start' && 'analytics-state--start')}
			role="status"
		>
			<span>{message}</span>
			{retry?.after ? <span className="analytics-state__after">{retry.after}</span> : null}
			{retry ? (action ?? <RefreshButton label={retry.label} />) : null}
		</span>
	)
}
