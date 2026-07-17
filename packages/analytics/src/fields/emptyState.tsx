import type { CSSProperties, ReactNode } from 'react'
import type { MetricKey } from '../core/contract'
import type { FieldReadStatus } from './readForDocument'

/**
 * A per-document read that has nothing to chart yet: either no path resolved (an unsaved
 * or unbound document) or a bound page that has not accumulated a single tracked metric.
 * Both read as "new" to the editor, distinct from a configuration state (not bound, no
 * provider, unavailable) which is a message about setup, not an empty page.
 */
export const isNewDocumentAnalytics = (result: {
	status: FieldReadStatus
	metrics: Partial<Record<MetricKey, number>>
	supportedMetrics: MetricKey[]
}): boolean => {
	if (result.status === 'no-path') {
		return true
	}
	if (result.status !== 'ok') {
		return false
	}
	return result.supportedMetrics.every((metric) => !(result.metrics[metric] ?? 0))
}

const pillStyle: CSSProperties = {
	display: 'inline-flex',
	alignItems: 'center',
	padding: '0.125rem 0.5rem',
	borderRadius: '999px',
	fontSize: '0.6875rem',
	fontWeight: 600,
	letterSpacing: '0.03em',
	color: 'var(--theme-elevation-500)',
	background: 'var(--theme-elevation-100)',
}

/**
 * Empty-state marker for a per-document analytics surface. A new or dataless document
 * shows a muted "New" pill; a configuration state shows its message inline. Free of client
 * hooks so both the server stat field and the client panel render it the same way; the
 * `analytics-empty-state` classes are stable hooks for overriding the look.
 */
export function AnalyticsEmptyState({ isNew, children }: { isNew: boolean; children: ReactNode }) {
	if (isNew) {
		return (
			<span className="analytics-empty-state analytics-empty-state--new" style={pillStyle}>
				{children}
			</span>
		)
	}
	return (
		<div className="analytics-empty-state" style={{ color: 'var(--theme-elevation-400)' }}>
			{children}
		</div>
	)
}
