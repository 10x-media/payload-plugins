import type { StaticDescription, StaticLabel } from 'payload'

/**
 * Where the reveal eye sits relative to a concealed field's native markup:
 * - `attached`: a flex-appended segment inside the input row (Payload's API-key
 *   pattern), used by single text/email/number.
 * - `corner`: absolutely positioned in the top-right of the field wrap, used by
 *   textarea.
 * - `label-row`: absolutely positioned on the label line, used by every
 *   structural type (checkbox/select/radio/date/code/json/point) and, because
 *   they have no single-line input to attach to, every `hasMany` field.
 */
export type Placement = 'attached' | 'corner' | 'label-row'

const ATTACHED_KEYS: ReadonlySet<string> = new Set(['text', 'email', 'number'])

/**
 * Resolves the eye placement for a concealed field. `hasMany` always wins to
 * `label-row` because the react-select chip surface has no single input the
 * segment could attach to.
 */
export const placementFor = (componentKey: string, hasMany: boolean): Placement => {
	if (hasMany) {
		return 'label-row'
	}
	if (componentKey === 'textarea') {
		return 'corner'
	}
	if (ATTACHED_KEYS.has(componentKey)) {
		return 'attached'
	}
	return 'label-row'
}

/**
 * The serializable slice of a client field config the concealed facsimiles and
 * revealed bound inputs read. The patched field the dispatcher builds is a
 * superset of this; components take this narrow view so masked markup never
 * depends on server-only field internals.
 */
export interface EncryptedFieldConfig {
	admin?: {
		autoComplete?: string
		description?: StaticDescription
		placeholder?: unknown
		rows?: number
		step?: number
	}
	label?: StaticLabel
	localized?: boolean
	options?: { label: string; value: string }[]
	required?: boolean
}
