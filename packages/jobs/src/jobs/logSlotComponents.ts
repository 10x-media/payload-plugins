import type { AdminDependencies, PayloadComponent } from 'payload'
import type { ReactNode } from 'react'
import { collectComponentDependencies } from '../plugin/componentDependencies'

/** Blocks inside an expanded log-attempt row that accept a custom renderer. */
export type JobLogSlot = 'error' | 'input' | 'output'

/** Render order of the blocks inside an expanded log-attempt row. */
export const JOB_LOG_SLOTS: JobLogSlot[] = ['input', 'output', 'error']

/** One attempt in a job's `log` array. */
export type JobLogEntry = {
	completedAt?: string
	error?: unknown
	executedAt?: string
	id?: string
	input?: unknown
	output?: unknown
	state?: 'failed' | 'succeeded'
	taskID?: string
	taskSlug?: string
}

/**
 * Stable row key, shared by the server pre-render and the client rows so the two
 * agree on which attempt a rendered block belongs to.
 */
export const logRowKey = (entry: JobLogEntry, index: number): string => entry.id ?? String(index)

/** Server-rendered custom blocks for one attempt, keyed by slot. */
export type JobLogRenderedSlots = Partial<Record<JobLogSlot, ReactNode>>

/** Custom blocks for every attempt, keyed by `logRowKey`. */
export type JobLogRenderedEntries = Record<string, JobLogRenderedSlots>

/** Props handed to a custom renderer for one block of one attempt. */
export type JobLogSlotProps = {
	entry: JobLogEntry
	index: number
	jobID?: number | string
	slot: JobLogSlot
	value: unknown
}

/** Custom renderers for one task's log-attempt blocks; `false` keeps the JSON block. */
export type JobLogSlotComponents = Partial<Record<JobLogSlot, PayloadComponent>>

/**
 * Custom renderers keyed by task slug, with `'*'` as the fallback for every task.
 * A per-slug entry wins slot by slot, so a task may customize `output` alone and
 * still inherit a wildcard `error`. An explicit `false` opts a slot back out to
 * the default JSON block, wildcard included.
 */
export type JobLogEntryComponents = Record<string, JobLogSlotComponents>

/** The wildcard key: renderers that apply to every task slug. */
const WILDCARD = '*'

/**
 * The renderer for one attempt's block: the task's own entry first, then the
 * wildcard, with `false` collapsing to "no renderer" so the JSON block is used.
 */
export const resolveSlotComponent = (
	components: JobLogEntryComponents | undefined,
	taskSlug: string | undefined,
	slot: JobLogSlot
): PayloadComponent | undefined => {
	if (!components) {
		return undefined
	}
	const exact = taskSlug ? components[taskSlug]?.[slot] : undefined
	const chosen = exact === undefined ? components[WILDCARD]?.[slot] : exact
	return chosen === false ? undefined : chosen
}

/**
 * Import-map entries for every configured renderer. The paths live in plugin
 * options rather than in a component slot the import-map generator walks, so
 * without this registration `generate:importmap` would never see them.
 */
export const collectLogDependencies = (
	components: JobLogEntryComponents | undefined
): AdminDependencies =>
	collectComponentDependencies(
		'@10x-media/jobs:log',
		Object.entries(components ?? {}).flatMap(([taskSlug, slots]) =>
			JOB_LOG_SLOTS.map((slot): [string, false | PayloadComponent | undefined] => [
				`${taskSlug}:${slot}`,
				slots[slot],
			])
		)
	)
