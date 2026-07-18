import { isNamedField } from '../fields/fieldKey'
import type { AnyFormFieldDefinition } from '../fields/types'
import type { FormFieldInstance, SubmissionDescriptor } from '../submissions/types'

export type RecallResolver = (name: string) => string

type Option = { label?: string; value?: string }

/** Derive a value->label map from a select-like field instance's `options`. */
export const optionLabelsFor = (field: FormFieldInstance): Record<string, string> | undefined => {
	const options = field.options
	if (!Array.isArray(options)) {
		return undefined
	}
	const map: Record<string, string> = {}
	for (const option of options as Option[]) {
		if (option && typeof option.value === 'string') {
			map[option.value] = option.label ?? option.value
		}
	}
	return Object.keys(map).length > 0 ? map : undefined
}

/**
 * Build a recall resolver: `{{name}}` -> the field's current value, formatted via its type's `format`
 * (so a select shows its option label, a checkbox Yes/No, a date localized). Missing field or empty
 * value -> ''. Pure and isomorphic; the renderer and server templates share it.
 */
export const buildRecallResolver = (args: {
	fields: FormFieldInstance[]
	values: Record<string, unknown>
	registry: Map<string, AnyFormFieldDefinition>
	locale: string
	t: (key: string) => string
}): RecallResolver => {
	const byName = new Map(args.fields.filter(isNamedField).map((field) => [field.name, field]))
	return (name) => {
		const field = byName.get(name)
		if (!field) {
			return ''
		}
		const value = args.values[name]
		if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
			return ''
		}
		const definition = args.registry.get(field.blockType)
		if (definition?.format) {
			return definition.format({
				value,
				config: {},
				optionLabels: optionLabelsFor(field),
				locale: args.locale,
				t: args.t,
			})
		}
		return Array.isArray(value) ? value.join(', ') : String(value)
	}
}

/**
 * Build a submission-shaped descriptor per named field: the client-side counterpart to the
 * per-field descriptors `runSubmission` snapshots server-side. Lets client-rendered templates
 * (the response message) label rows the same way server-rendered ones (email-team) do. `optionLabels`
 * is omitted: pair with values already formatted via `buildRecallResolver`, not raw stored values.
 */
export const descriptorsFor = (fields: FormFieldInstance[]): SubmissionDescriptor[] =>
	fields.filter(isNamedField).map((field) => ({
		field: field.name,
		label: field.label ?? field.name,
		fieldType: field.blockType,
	}))
