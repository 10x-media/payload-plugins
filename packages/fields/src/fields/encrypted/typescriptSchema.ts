import type { JSONSchema4 } from 'json-schema'
import type { EncryptedSourceField } from './types'

const optionValues = (source: EncryptedSourceField): string[] =>
	'options' in source
		? source.options.map((option) => (typeof option === 'string' ? option : option.value))
		: []

const baseSchema = (source: EncryptedSourceField): JSONSchema4 => {
	switch (source.type) {
		case 'checkbox':
			return { type: 'boolean' }
		case 'number':
			return { type: 'number' }
		case 'json':
		case 'richText':
			return { additionalProperties: true, type: 'object' }
		case 'point':
			return { items: { type: 'number' }, maxItems: 2, minItems: 2, type: 'array' }
		case 'radio':
		case 'select':
			return { enum: optionValues(source), type: 'string' }
		default:
			return { type: 'string' }
	}
}

/**
 * The stored field is text, but generated TypeScript must keep the source
 * type's shape (number stays number, checkbox stays boolean, ...).
 */
export const typescriptSchemaFor = (
	source: EncryptedSourceField
): Array<(args: { jsonSchema: JSONSchema4 }) => JSONSchema4> => {
	const single = baseSchema(source)
	const schema: JSONSchema4 =
		'hasMany' in source && source.hasMany === true ? { items: single, type: 'array' } : single
	return [() => schema]
}
