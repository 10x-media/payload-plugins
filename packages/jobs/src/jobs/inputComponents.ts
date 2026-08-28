import type { AdminDependencies, PayloadComponent } from 'payload'

import { collectComponentDependencies } from './componentDependencies'

/**
 * Custom editors for the job's `input`, keyed by task or workflow slug with `'*'`
 * as the fallback for every slug. An explicit `false` sends a slug back to the
 * JSON field, wildcard included. Slugs a task and a workflow share resolve to the
 * same component.
 */
export type JobInputComponents = Record<string, false | PayloadComponent>

/** Props handed to a custom `input` editor. It reads and writes the field through `useField({ path })`. */
export type JobInputComponentProps = {
	kind: 'task' | 'workflow'
	path: string
	/** What the create form would have pre-filled: the derived or example object for this slug. */
	placeholder?: Record<string, unknown>
	readOnly?: boolean
	slug: string
}

const WILDCARD = '*'

/** The editor for one slug: its own entry first, then the wildcard; `false` means none. */
export const resolveInputComponent = (
	components: JobInputComponents | undefined,
	slug: string
): PayloadComponent | undefined => {
	if (!components) {
		return undefined
	}
	const exact = components[slug]
	const chosen = exact === undefined ? components[WILDCARD] : exact
	return chosen === false || chosen === undefined ? undefined : chosen
}

/** Key of a pre-rendered editor: a task and a workflow may share a slug. */
export const renderedKey = (kind: JobInputComponentProps['kind'], slug: string): string =>
	`${kind}:${slug}`

export const collectInputDependencies = (
	components: JobInputComponents | undefined
): AdminDependencies =>
	collectComponentDependencies('@10x-media/jobs:input', Object.entries(components ?? {}))
