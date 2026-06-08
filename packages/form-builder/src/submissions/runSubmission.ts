import type { Payload, PayloadRequest } from 'payload'
import type { FieldTypeRegistry } from '../fields/registry'
import type { Translate } from '../fields/types'
import type { ValidationRuleRegistry } from '../validation/registry'
import { runValidation } from '../validation/runValidation'
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
	ruleRegistry: ValidationRuleRegistry
	locale: string
	t: Translate
	operation: 'create' | 'update'
	req?: PayloadRequest
	payload?: Payload
	formId?: number | string
}

export type RunSubmissionResult = {
	errors: SubmissionFieldError[]
	values: SubmissionValue[]
	descriptors: SubmissionDescriptor[]
}

/**
 * Pure submission core, two-pass: first coerce every answered field to its typed kind (so cross-field
 * rules see coerced siblings), then validate each field through `runValidation` (required, intrinsic
 * facet, declarative rules), snapshotting a localized descriptor per answered field. Only `error`
 * severity blocks; warnings are computed but not surfaced server-side (the Phase 4 renderer shows them).
 */
export const runSubmission = async (input: RunSubmissionInput): Promise<RunSubmissionResult> => {
	const { fields, values, registry, ruleRegistry, locale, t, operation, req, payload, formId } =
		input
	const incoming = new Map(values.map((entry) => [entry.field, entry.value]))

	const coercedAnswers: Record<string, unknown> = {}
	const coercedByName = new Map<string, unknown>()
	for (const instance of fields) {
		const definition = registry.get(instance.blockType)
		const raw = incoming.get(instance.name)
		if (!definition || isEmpty(raw)) {
			continue
		}
		const value = coerce(definition.value, raw)
		coercedAnswers[instance.name] = value
		coercedByName.set(instance.name, value)
	}

	const errors: SubmissionFieldError[] = []
	const outValues: SubmissionValue[] = []
	const descriptors: SubmissionDescriptor[] = []

	for (const instance of fields) {
		const definition = registry.get(instance.blockType)
		if (!definition) {
			continue
		}
		const raw = incoming.get(instance.name)
		const value = coercedByName.has(instance.name) ? coercedByName.get(instance.name) : raw

		const { errors: issues } = await runValidation({
			field: instance,
			fieldDefinition: definition,
			value,
			fieldType: instance.blockType,
			ruleRegistry,
			answers: coercedAnswers,
			locale,
			t,
			operation,
			event: 'submit',
			mode: 'server',
			req,
			payload,
			formId,
		})
		const blocking = issues.filter((issue) => issue.severity === 'error')
		if (blocking.length > 0) {
			for (const issue of blocking) {
				errors.push({ path: instance.name, message: issue.message })
			}
			continue
		}
		if (isEmpty(raw)) {
			continue
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
