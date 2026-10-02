import type { MergePolicy } from './types'

/**
 * Namespace this plugin claims inside the shared `admin.custom` object for a per-field merge
 * policy. It lives there rather than in the field's own `custom` because Payload strips
 * `custom` from the client config while `admin.custom` reaches both sides; the plugin's
 * `fields` seam still has the last word.
 */
export const DEDUPE_FIELD_KEY = 'dedupe'

export type DedupeFieldConfig = {
	/** How the field combines when two documents merge. Overrides the type default. */
	policy?: MergePolicy
}

/**
 * Build the `admin.custom` fragment for a field.
 *
 * ```ts
 * { name: 'notes', type: 'textarea', admin: { custom: dedupeCustom({ policy: 'union' }) } }
 * ```
 *
 * Spread it when the field already carries other custom data:
 * `custom: { ...existing, ...dedupeCustom({ policy: 'manual' }) }`.
 */
export const dedupeCustom = (config: DedupeFieldConfig): Record<string, DedupeFieldConfig> => ({
	[DEDUPE_FIELD_KEY]: config,
})

const POLICIES: ReadonlySet<string> = new Set(['manual', 'nonEmpty', 'skip', 'survivor', 'union'])

/** The policy declared on a field; an unknown one stops the app at boot, as the rest of the config does. */
export const readFieldConfig = (field: {
	name: string
	admin?: { custom?: Record<string, unknown> }
}): DedupeFieldConfig | undefined => {
	const raw = field.admin?.custom?.[DEDUPE_FIELD_KEY]
	if (!raw || typeof raw !== 'object') return undefined
	const policy = (raw as { policy?: unknown }).policy
	if (policy === undefined) return {}
	if (typeof policy !== 'string' || !POLICIES.has(policy)) {
		throw new Error(
			`dedupe: field "${field.name}" declares an unknown merge policy "${String(policy)}"`
		)
	}
	return { policy: policy as MergePolicy }
}
