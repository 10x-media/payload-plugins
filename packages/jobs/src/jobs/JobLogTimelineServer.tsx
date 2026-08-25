import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import type { ArrayFieldClient, Data, Payload } from 'payload'

import { JobLogTimeline } from './JobLogTimeline'
import type {
	JobLogEntry,
	JobLogEntryComponents,
	JobLogRenderedEntries,
	JobLogSlotProps,
} from './logSlotComponents'
import { JOB_LOG_SLOTS, logRowKey, resolveSlotComponent } from './logSlotComponents'

type Props = {
	clientField: ArrayFieldClient
	data?: Data
	entryComponents?: JobLogEntryComponents
	path: string
	payload: Payload
	taskLabels?: Record<string, string>
	value?: unknown
}

/** The attempts to render: the field's own value, with the document as a fallback. */
const readEntries = (value: unknown, data: Data | undefined): JobLogEntry[] => {
	if (Array.isArray(value)) {
		return value as JobLogEntry[]
	}
	return Array.isArray(data?.log) ? (data.log as JobLogEntry[]) : []
}

/**
 * Field component for a job's `log`. Resolves the configured custom renderers
 * against the import map and pre-renders one node per attempt and slot, then
 * hands them to the client timeline; anything unconfigured or unresolvable is
 * simply absent, and the timeline falls back to its default JSON block.
 *
 * The resolve has to happen here because the import map is server-only, which is
 * also why a custom renderer may itself be a server or a client component.
 */
export const JobLogTimelineServer = ({
	clientField,
	data,
	entryComponents,
	path,
	payload,
	taskLabels,
	value,
}: Props) => {
	const entries = readEntries(value, data)
	const renderedSlots: JobLogRenderedEntries = {}

	entries.forEach((entry, index) => {
		for (const slot of JOB_LOG_SLOTS) {
			const Component = resolveSlotComponent(entryComponents, entry.taskSlug, slot)
			if (!Component) {
				continue
			}
			const slotProps: JobLogSlotProps = {
				entry,
				index,
				jobID: data?.id,
				slot,
				value: entry[slot],
			}
			const node = RenderServerComponent({
				clientProps: slotProps,
				Component,
				importMap: payload.importMap,
			})
			if (node != null) {
				const key = logRowKey(entry, index)
				renderedSlots[key] = { ...renderedSlots[key], [slot]: node }
			}
		}
	})

	return (
		<JobLogTimeline
			field={clientField}
			path={path}
			renderedSlots={renderedSlots}
			taskLabels={taskLabels}
		/>
	)
}
