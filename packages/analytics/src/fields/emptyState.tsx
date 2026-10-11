import { Pill } from '@payloadcms/ui'
import type { ReactNode } from 'react'
import type { MetricKey, MetricValues } from '../core/contract'
import type { FieldReadStatus } from './readForDocument'
import '../ui/analytics.css'

/** The parts of a per-document read that decide what it shows when it has no numbers. */
export interface DocumentRead {
	status: FieldReadStatus
	metrics: MetricValues
	supportedMetrics: MetricKey[]
	/** The window the read covered; the document endpoint's answer carries it as ISO strings. */
	dateRange?: { start: Date | string } | undefined
}

const timeOf = (value: unknown): number | undefined => {
	if (!(value instanceof Date) && typeof value !== 'string') {
		return undefined
	}
	const time = new Date(value).getTime()
	return Number.isNaN(time) ? undefined : time
}

/**
 * When the document was created, from the `createdAt` Payload keeps on a collection with
 * timestamps (its default); undefined on a collection without them or an unsaved document.
 */
export const createdAtOf = (data: object): string | undefined => {
	const time = timeOf(Reflect.get(data, 'createdAt'))
	return time === undefined ? undefined : new Date(time).toISOString()
}

/** A read that answered and counted nothing in any metric it served. */
export const isEmptyDocumentRead = (read: DocumentRead): boolean =>
	read.status === 'ok' && read.supportedMetrics.every((metric) => !(read.metrics[metric] ?? 0))

/**
 * New: no path resolved (unsaved or unbound), or nothing counted and created after the window
 * opened. Without `createdAt` an empty read simply had no data; any other status is never new.
 */
export const isNewDocumentAnalytics = (
	read: DocumentRead,
	createdAt: string | undefined
): boolean => {
	if (read.status === 'no-path') {
		return true
	}
	if (!isEmptyDocumentRead(read)) {
		return false
	}
	const created = timeOf(createdAt)
	const opened = timeOf(read.dateRange?.start)
	return created !== undefined && opened !== undefined && created >= opened
}

/**
 * Muted "New" pill for a new document, else the message inline. Hook-free so the server stat and
 * client panel render it alike; `analytics-empty-state` classes are stable styling hooks.
 */
export function AnalyticsEmptyState({ isNew, children }: { isNew: boolean; children: ReactNode }) {
	if (isNew) {
		return (
			<Pill
				className="analytics-empty-state analytics-empty-state--new"
				pillStyle="light-gray"
				rounded
				size="small"
			>
				{children}
			</Pill>
		)
	}
	return <div className="analytics-empty-state">{children}</div>
}
