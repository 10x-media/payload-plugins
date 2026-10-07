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
	/**
	 * A group or list drawn by a `Field` component of its own is merged whole, as the component
	 * shows it. `true` merges it field by field or row by row instead, as one without.
	 */
	split?: boolean
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
	const { policy, split } = raw as { policy?: unknown; split?: unknown }
	if (policy !== undefined && (typeof policy !== 'string' || !POLICIES.has(policy))) {
		throw new Error(
			`dedupe: field "${field.name}" declares an unknown merge policy "${String(policy)}"`
		)
	}
	if (split !== undefined && typeof split !== 'boolean') {
		throw new Error(`dedupe: field "${field.name}" declares \`split\` other than true or false`)
	}
	return {
		...(policy === undefined ? {} : { policy: policy as MergePolicy }),
		...(split === undefined ? {} : { split }),
	}
}
