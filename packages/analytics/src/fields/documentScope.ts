import type { BindingDoc, DocumentScopeField } from '../binding/types'

const at = (target: object, key: string): unknown => Reflect.get(target, key)

const idOf = (value: unknown): string | null => {
	if (typeof value === 'string') {
		return value === '' ? null : value
	}
	if (typeof value === 'number') {
		return String(value)
	}
	if (value !== null && typeof value === 'object') {
		// A row of the multi-tenant plugin's own array field wraps the relationship one level.
		return idOf(at(value, 'id') ?? at(value, 'value') ?? at(value, 'tenant'))
	}
	return null
}

/**
 * Document's scope as its own field holds it: raw id, populated doc, or an array field's first row
 * (multi-tenant plugin form). Null (absent or empty) leaves the read on the request's own scope.
 */
export const scopeFromDocument = (data: BindingDoc, field: DocumentScopeField): string | null => {
	if (field === false) {
		return null
	}
	const value = at(data, field)
	return Array.isArray(value) ? idOf(value[0]) : idOf(value)
}
