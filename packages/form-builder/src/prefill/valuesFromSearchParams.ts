import type { FieldTypeRegistry } from '../fields/registry'
import type { FormFieldValueKind } from '../fields/types'
import type { FormFieldInstance } from '../submissions/types'

export type PrefillOptions = {
	/** Map a query-param name to a field name. Unmapped params use their own name. */
	map?: Record<string, string>
	/** If set, only these field names may be prefilled. */
	allow?: string[]
	/** These field names may never be prefilled. */
	deny?: string[]
}

const TRUTHY = new Set(['true', '1', 'on', 'yes'])

const coerce = (kind: FormFieldValueKind, raw: string, all: string[]): unknown => {
	switch (kind) {
		case 'number': {
			const n = Number(raw)
			return Number.isNaN(n) ? undefined : n
		}
		case 'boolean':
			return TRUTHY.has(raw.toLowerCase())
		case 'text[]':
			return all
		default:
			return raw
	}
}

/**
 * Map URL/query params to typed initial values for KNOWN fields only, coerced by each field's value
 * kind. Unknown, denied, or un-allowed params are ignored; invalid numbers are dropped. Prefilled
 * values are never trusted -- they still validate on submit. Pass the result to `<Form initialValues>`.
 */
// biome-ignore lint/complexity/useMaxParams: four positional args are the minimal surface (params, fields, registry, options)
export const valuesFromSearchParams = (
	params: URLSearchParams | Record<string, string>,
	fields: FormFieldInstance[],
	registry: FieldTypeRegistry,
	options: PrefillOptions = {}
): Record<string, unknown> => {
	const isSearch = params instanceof URLSearchParams
	const paramKeys = isSearch ? [...new Set(params.keys())] : Object.keys(params)
	const byName = new Map(fields.map((field) => [field.name, field]))
	const result: Record<string, unknown> = {}

	for (const param of paramKeys) {
		const fieldName = options.map?.[param] ?? param

		if (options.allow && !options.allow.includes(fieldName)) {
			continue
		}
		if (options.deny?.includes(fieldName)) {
			continue
		}

		const field = byName.get(fieldName)
		const definition = field && registry.get(field.blockType)
		// 'none'-kind (display-only) fields carry no value, so a param under their name is ignored.
		if (!field || !definition || definition.value === 'none') {
			continue
		}

		const all = isSearch ? params.getAll(param) : [params[param] as string]
		const value = coerce(definition.value, all[0] ?? '', all)
		if (value !== undefined) {
			result[fieldName] = value
		}
	}

	return result
}
