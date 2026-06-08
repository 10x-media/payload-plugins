import type { FieldTypeRegistry } from '../fields/registry'
import type { Translate } from '../fields/types'
import { keys } from '../translations/keys'
import type {
	FormFieldInstance,
	SubmissionDescriptor,
	SubmissionFieldError,
	SubmissionValue,
} from './types'

const isEmpty = (value: unknown): boolean =>
	value == null || value === '' || (Array.isArray(value) && value.length === 0)

const coerce = (kind: string, value: unknown): unknown => {
	if (value == null) {
		return value
	}
	if (kind === 'number') {
		const next = typeof value === 'number' ? value : Number(value)
		return Number.isNaN(next) ? value : next
	}
	if (kind === 'boolean') {
		return Boolean(value)
	}
	if (kind === 'text') {
		return typeof value === 'string' ? value : String(value)
	}
	return value
}

const optionLabelsFor = (instance: FormFieldInstance): Record<string, string> | undefined => {
	const options = instance.options
	if (!Array.isArray(options)) {
		return undefined
	}
	const map: Record<string, string> = {}
	for (const option of options as Array<{ label?: string; value?: string }>) {
		if (typeof option?.value === 'string') {
			map[option.value] = option.label ?? option.value
		}
	}
	return Object.keys(map).length > 0 ? map : undefined
}

export type RunSubmissionInput = {
	fields: FormFieldInstance[]
	values: SubmissionValue[]
	registry: FieldTypeRegistry
	locale: string
	t: Translate
}

export type RunSubmissionResult = {
	errors: SubmissionFieldError[]
	values: SubmissionValue[]
	descriptors: SubmissionDescriptor[]
}

/**
 * Pure submission core: validate every defined field against its incoming value, snapshot a localized
 * descriptor per answered field, and normalize stored values to their typed kind. No DB or request
 * access, so it is fully unit-testable; the `beforeValidate` hook is a thin adapter over this. Phase 2
 * threads the declarative rule registry through the same loop.
 */
export const runSubmission = async (input: RunSubmissionInput): Promise<RunSubmissionResult> => {
	const { fields, values, registry, locale, t } = input
	const incoming = new Map(values.map((entry) => [entry.field, entry.value]))
	const answers = Object.fromEntries(incoming)
	const errors: SubmissionFieldError[] = []
	const outValues: SubmissionValue[] = []
	const descriptors: SubmissionDescriptor[] = []

	for (const instance of fields) {
		const definition = registry.get(instance.blockType)
		if (!definition) {
			continue
		}
		const raw = incoming.get(instance.name)

		if (instance.required && isEmpty(raw)) {
			errors.push({ path: instance.name, message: t(keys.validationRequired) })
			continue
		}
		if (isEmpty(raw)) {
			continue
		}
		const value = coerce(definition.value, raw)
		if (definition.validate) {
			const result = await definition.validate({
				value,
				config: instance,
				siblingData: answers,
				data: answers,
				locale,
				t,
			})
			if (result !== true) {
				errors.push({ path: instance.name, message: result })
				continue
			}
		}

		outValues.push({ field: instance.name, value })
		const optionLabels = optionLabelsFor(instance)
		descriptors.push({
			field: instance.name,
			label: instance.label ?? instance.name,
			fieldType: instance.blockType,
			...(optionLabels ? { optionLabels } : {}),
		})
	}

	return { errors, values: outValues, descriptors }
}
