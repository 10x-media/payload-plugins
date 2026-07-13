import type { Config } from 'payload'

export type JobLabelMaps = {
	taskLabels: Record<string, string>
	workflowLabels: Record<string, string>
}

const toMap = (entries: { label?: unknown; slug: string }[]): Record<string, string> =>
	Object.fromEntries(
		entries.flatMap((entry) =>
			typeof entry.label === 'string' && entry.label ? [[entry.slug, entry.label]] : []
		)
	)

/** Slug-to-label maps for tasks and workflows, for human-friendly admin display. */
export const collectJobLabels = (config: Config): JobLabelMaps => ({
	taskLabels: toMap(config.jobs?.tasks ?? []),
	workflowLabels: toMap(config.jobs?.workflows ?? []),
})
