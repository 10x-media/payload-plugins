import type { Payload, PayloadRequest } from 'payload'
import { calcExpressionOf, computeCalcFields } from '../calc/computeCalcFields'
import { evaluateCondition } from '../conditions/evaluate'
import type { ConsentProof } from '../consent/captureConsent'
import { captureConsent } from '../consent/captureConsent'
import type { ConsentSourceRegistry } from '../consent/registry'
import type { FieldTypeRegistry } from '../fields/registry'
import type { Translate } from '../fields/types'
import { keys } from '../translations/keys'
import { captureFileRef } from '../uploads/captureFileRef'
import type { FileFieldConfig, FileRefError } from '../uploads/types'
import type { ValidationRuleRegistry } from '../validation/registry'
import { runValidation } from '../validation/runValidation'
import type {
	FormFieldInstance,
	SubmissionDescriptor,
	SubmissionFieldError,
	SubmissionValue,
} from './types'

const errorKeyFor = (code: FileRefError): string => {
	if (code === 'mimeType') {
		return keys.validationFileMimeType
	}
	if (code === 'tooLarge') {
		return keys.validationFileTooLarge
	}
	return keys.validationFileMissing
}

/** Normalize the authored `mimeTypes` (a `hasMany` text field) to a `string[]`. */
const mimeTypesOf = (raw: unknown): string[] | undefined => {
	if (!Array.isArray(raw)) {
		return undefined
	}
	const out = (raw as unknown[]).filter((entry): entry is string => typeof entry === 'string')
	return out.length > 0 ? out : undefined
}

const fileFieldConfigOf = (instance: FormFieldInstance): FileFieldConfig => ({
	relationTo: typeof instance.relationTo === 'string' ? instance.relationTo : undefined,
	mimeTypes: mimeTypesOf(instance.mimeTypes),
	maxSize: typeof instance.maxSize === 'number' ? instance.maxSize : undefined,
})

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

export type ConsentProofEntry = { field: string } & ConsentProof

export type RunSubmissionInput = {
	fields: FormFieldInstance[]
	values: SubmissionValue[]
	registry: FieldTypeRegistry
	ruleRegistry: ValidationRuleRegistry
	consentRegistry: ConsentSourceRegistry
	locale: string
	t: Translate
	operation: 'create' | 'update'
	req?: PayloadRequest
	payload?: Payload
	formId?: number | string
	/** Upload collection slug for file fields without an explicit `relationTo`. Defaults to `form-uploads`. */
	uploadSlug?: string
	/** Resolved request identity, verified against an upload's `owner` stamp when a file field is captured. */
	expectedOwner?: string
}

export type RunSubmissionResult = {
	errors: SubmissionFieldError[]
	values: SubmissionValue[]
	descriptors: SubmissionDescriptor[]
	consent: ConsentProofEntry[]
}

/**
 * Pure submission core, two-pass: first coerce every answered field to its typed kind (so cross-field
 * rules see coerced siblings), then validate each field through `runValidation` (required, intrinsic
 * facet, declarative rules), snapshotting a localized descriptor per answered field. Calc fields are
 * the trust boundary: their client-sent values are never seeded, their values are derived from their
 * expressions over the coerced answers, and those derived values are authoritative everywhere downstream
 * (conditions, validation, storage). Conditions gate the second pass against these effective answers: a
 * field whose `visibleWhen` is false is skipped entirely (never validated, never stored, so a client-sent
 * value for it is ignored), and a visible field whose `validateWhen` is false stores its value but skips
 * validation. A visible calc field stores its derived value and is never validated. Only `error` severity
 * blocks; warnings are computed but not surfaced server-side (the Phase 4 renderer shows them).
 */
export const runSubmission = async (input: RunSubmissionInput): Promise<RunSubmissionResult> => {
	const {
		fields,
		values,
		registry,
		ruleRegistry,
		consentRegistry,
		locale,
		t,
		operation,
		req,
		payload,
		formId,
		uploadSlug,
		expectedOwner,
	} = input
	const incoming = new Map(values.map((entry) => [entry.field, entry.value]))

	const coercedAnswers: Record<string, unknown> = {}
	const coercedByName = new Map<string, unknown>()
	for (const instance of fields) {
		const definition = registry.get(instance.blockType)
		const raw = incoming.get(instance.name)
		// Never seed a calc field's client value: its value is derived below, so the client cannot influence it (even for a self-referencing expression).
		if (!definition || calcExpressionOf(instance)) {
			continue
		}
		// A consent field's "not agreed" state is semantically meaningful: treat a missing value as
		// `false` so the intrinsic validate can enforce required-agreement (not optional = must be true).
		const effectiveRaw = instance.blockType === 'consent' && isEmpty(raw) ? false : raw
		if (isEmpty(effectiveRaw)) {
			continue
		}
		const value = coerce(definition.value, effectiveRaw)
		coercedAnswers[instance.name] = value
		coercedByName.set(instance.name, value)
	}

	// Calc values are authoritative everywhere downstream (conditions, validation, storage), never the client-sent value.
	const effective = computeCalcFields(fields, coercedAnswers)

	const errors: SubmissionFieldError[] = []
	const outValues: SubmissionValue[] = []
	const descriptors: SubmissionDescriptor[] = []
	const consentProofs: ConsentProofEntry[] = []
	const now = new Date().toISOString()

	for (const instance of fields) {
		const definition = registry.get(instance.blockType)
		if (!definition) {
			continue
		}
		const raw = incoming.get(instance.name)
		const value = coercedByName.has(instance.name) ? coercedByName.get(instance.name) : raw

		if (!evaluateCondition(instance.visibleWhen, effective)) {
			continue
		}

		// A calc field's value is server-derived and always valid: skip validation and the client value entirely, storing the computed result.
		if (calcExpressionOf(instance)) {
			outValues.push({ field: instance.name, value: effective[instance.name] })
			descriptors.push({
				field: instance.name,
				label: instance.label ?? instance.name,
				fieldType: instance.blockType,
			})
			continue
		}

		if (evaluateCondition(instance.validateWhen, effective)) {
			const { errors: issues } = await runValidation({
				field: instance,
				fieldDefinition: definition,
				value,
				fieldType: instance.blockType,
				ruleRegistry,
				answers: effective,
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
		}

		if (instance.blockType === 'file') {
			if (isEmpty(value)) {
				continue
			}
			if (payload) {
				const fileConfig = fileFieldConfigOf(instance)
				const slug = fileConfig.relationTo ?? uploadSlug ?? 'form-uploads'
				const captured = await captureFileRef({
					payload,
					collectionSlug: slug,
					uploadId: value as string | number,
					config: fileConfig,
					req,
					expectedOwner,
				})
				if (!captured.ok) {
					errors.push({ path: instance.name, message: t(errorKeyFor(captured.code)) })
					continue
				}
				outValues.push({ field: instance.name, value: captured.ref })
				descriptors.push({
					field: instance.name,
					label: instance.label ?? instance.name,
					fieldType: instance.blockType,
				})
				continue
			}
			outValues.push({ field: instance.name, value })
			descriptors.push({
				field: instance.name,
				label: instance.label ?? instance.name,
				fieldType: instance.blockType,
			})
			continue
		}

		if (instance.blockType === 'consent' && payload) {
			const proof = await captureConsent({
				field: instance,
				agreed: value === true,
				registry: consentRegistry,
				payload,
				req,
				locale,
				now,
			})
			consentProofs.push({ field: instance.name, ...proof })
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

	return { errors, values: outValues, descriptors, consent: consentProofs }
}
