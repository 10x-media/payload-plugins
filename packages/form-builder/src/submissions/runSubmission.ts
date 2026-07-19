import type { Payload, PayloadRequest } from 'payload'
import { calcExpressionOf, computeCalcFields } from '../calc/computeCalcFields'
import { evaluateCondition } from '../conditions/evaluate'
import type { ConsentProof } from '../consent/captureConsent'
import { captureConsent } from '../consent/captureConsent'
import type { ConsentSourceEntry } from '../consent/types'
import { isNamedField } from '../fields/fieldKey'
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
	SubmissionWidth,
} from './types'

const SUBMISSION_WIDTHS: ReadonlySet<string> = new Set<SubmissionWidth>([
	'full',
	'half',
	'third',
	'twoThirds',
])

/** The field instance's authored layout width, or undefined if unset/unrecognized (renders full). */
export const widthOf = (instance: FormFieldInstance): SubmissionWidth | undefined =>
	typeof instance.width === 'string' && SUBMISSION_WIDTHS.has(instance.width)
		? (instance.width as SubmissionWidth)
		: undefined

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
		// A genuine boolean from the renderer passes through; a raw client string is parsed strictly so that
		// "false"/"0"/"off"/"no"/"" are not silently truthy (this matters for the required-consent check).
		if (typeof value === 'string') {
			const normalized = value.trim().toLowerCase()
			return !(
				normalized === '' ||
				normalized === 'false' ||
				normalized === '0' ||
				normalized === 'off' ||
				normalized === 'no'
			)
		}
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
	/**
	 * The host's consent sources, resolved once by the caller (which owns the request-scoped
	 * resolver and how a failure surfaces) and read here to build each consent proof.
	 */
	consentEntries?: ConsentSourceEntry[]
	locale: string
	t: Translate
	operation: 'create' | 'update'
	req?: PayloadRequest
	payload?: Payload
	formId?: number | string
	/**
	 * The plugin-configured uploads collection slug. The block's stamped `collection` is for the
	 * client only; the server resolves the slug from plugin config and fails closed without one.
	 */
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
 * validation. A visible calc field stores its derived value and is never validated. Display-only field
 * types (value kind 'none', e.g. message) and nameless (bare) rows are skipped in both passes: never
 * validated, never stored, and a client-sent value under their name is dropped. Only `error` severity
 * blocks; warnings are computed but not surfaced server-side (the renderer surfaces them).
 */
export const runSubmission = async (input: RunSubmissionInput): Promise<RunSubmissionResult> => {
	const {
		fields,
		values,
		registry,
		ruleRegistry,
		consentEntries,
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
		// Never seed a calc field's client value: its value is derived below, so the client cannot influence it (even for a self-referencing expression).
		// A display-only ('none' kind) field carries no value at all, so a client-sent value under its name is dropped here.
		// A nameless (bare) row has no key to read a value under.
		if (
			!definition ||
			definition.value === 'none' ||
			calcExpressionOf(instance) ||
			!isNamedField(instance)
		) {
			continue
		}
		const raw = incoming.get(instance.name)
		// A consent field's "not agreed" state is semantically meaningful: treat a missing value as
		// `false` so the intrinsic validate can enforce required-agreement (not optional = must be true).
		// A repeater with no rows is coerced to [] so validate() can check minRows. The empty-guard
		// below must not skip repeaters: isEmpty([]) is true, but [] still needs to reach validate()
		// so a minRows > 0 constraint correctly rejects a zero-row submission.
		const effectiveRaw =
			instance.blockType === 'consent' && isEmpty(raw)
				? false
				: instance.blockType === 'repeater' && isEmpty(raw)
					? []
					: raw
		if (isEmpty(effectiveRaw) && instance.blockType !== 'repeater') {
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
		// A 'none'-kind (display-only) field is never validated and never stored: no value, no descriptor.
		// A nameless (bare) row has no key to store under, so it is skipped the same way.
		if (!definition || definition.value === 'none' || !isNamedField(instance)) {
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
				...(widthOf(instance) ? { width: widthOf(instance) } : {}),
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

		// Gate on the field-type definition's value kind, not the blockType literal, so a custom
		// type registered with value:'file' gets the same server-side capture and enforcement as
		// the built-in file field (a blockType check would leave it storing the raw client id).
		if (definition.value === 'file') {
			if (isEmpty(value)) {
				continue
			}
			if (payload) {
				if (!uploadSlug) {
					errors.push({ path: instance.name, message: t(errorKeyFor('missing')) })
					continue
				}
				const fileConfig = fileFieldConfigOf(instance)
				const captured = await captureFileRef({
					payload,
					collectionSlug: uploadSlug,
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
					...(widthOf(instance) ? { width: widthOf(instance) } : {}),
				})
				continue
			}
			outValues.push({ field: instance.name, value })
			descriptors.push({
				field: instance.name,
				label: instance.label ?? instance.name,
				fieldType: instance.blockType,
				...(widthOf(instance) ? { width: widthOf(instance) } : {}),
			})
			continue
		}

		if (instance.blockType === 'consent' && payload) {
			const proof = await captureConsent({
				field: instance,
				agreed: value === true,
				entries: consentEntries ?? [],
				payload,
				req,
				now,
			})
			consentProofs.push({ field: instance.name, ...proof })
			continue
		}

		if (instance.blockType === 'repeater') {
			const rows = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
			// Nameless sub-rows are dropped like top-level ones (bare blocks are excluded from the
			// repeater's subFields config, so any encountered here is stray data).
			const subFields = (
				Array.isArray(instance.subFields) ? (instance.subFields as FormFieldInstance[]) : []
			).filter(isNamedField)

			// Per-row sub-field processing. Validation is gated by the sub-field's visibleWhen and
			// validateWhen against the row's own values; errors carry the path
			// fieldName[rowIndex].subFieldName so the client maps them to the right input. File
			// sub-fields additionally cross the server trust boundary: they are captured
			// unconditionally (a crafted request could carry an id for a conditionally-hidden field),
			// so a stored row never holds a raw, unenforced upload id.
			for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
				const row = rows[rowIndex] ?? {}
				for (const subField of subFields) {
					const subDef = registry.get(subField.blockType)
					if (!subDef) continue
					// Display-only ('none' kind) sub-fields mirror the top-level skip: never validated,
					// never captured, and stripped from the stored row below so a client-injected value
					// under their name cannot ride along.
					if (subDef.value === 'none') continue
					const subPath = `${instance.name}[${rowIndex}].${subField.name}`
					if (
						evaluateCondition(subField.visibleWhen, row) &&
						evaluateCondition(subField.validateWhen, row)
					) {
						const { errors: subErrors } = await runValidation({
							field: subField,
							fieldDefinition: subDef,
							value: row[subField.name],
							fieldType: subField.blockType,
							ruleRegistry,
							answers: row,
							locale,
							t,
							operation,
							event: 'submit',
							mode: 'server',
							req,
							payload,
							formId,
						})
						for (const issue of subErrors.filter((e) => e.severity === 'error')) {
							errors.push({ path: subPath, message: issue.message })
						}
					}

					// Mirror the top-level file capture: the client submits only an upload id, so
					// re-derive filename/mimeType/filesize from the stored doc and enforce
					// owner/mime/size against the sub-field's config, failing closed on a missing
					// uploads slug or any capture rejection. The captured FileRef replaces the raw
					// id in the row. Without a payload (pure unit context) the value stays verbatim,
					// exactly like the top-level path.
					if (subDef.value === 'file' && payload) {
						const subValue = row[subField.name]
						if (isEmpty(subValue)) {
							continue
						}
						if (!uploadSlug) {
							errors.push({ path: subPath, message: t(errorKeyFor('missing')) })
							continue
						}
						const captured = await captureFileRef({
							payload,
							collectionSlug: uploadSlug,
							uploadId: subValue as string | number,
							config: fileFieldConfigOf(subField),
							req,
							expectedOwner,
						})
						if (!captured.ok) {
							errors.push({ path: subPath, message: t(errorKeyFor(captured.code)) })
							continue
						}
						row[subField.name] = captured.ref
					}
				}
			}

			if (errors.length > 0) {
				continue
			}

			const subFieldDescriptors: SubmissionDescriptor[] = subFields.map((sf) => ({
				field: sf.name,
				label: sf.label ?? sf.name,
				fieldType: sf.blockType,
				...((sf.options as unknown) ? { optionLabels: optionLabelsFor(sf) ?? undefined } : {}),
			}))

			// Strip display-only sub-fields from the stored rows: like top-level 'none' fields they
			// carry no answer, so a client-injected value under their name must never persist.
			const displayOnly = new Set(
				subFields.filter((sf) => registry.get(sf.blockType)?.value === 'none').map((sf) => sf.name)
			)
			const storedRows =
				displayOnly.size === 0
					? rows
					: rows.map((row) =>
							Object.fromEntries(Object.entries(row).filter(([key]) => !displayOnly.has(key)))
						)

			outValues.push({ field: instance.name, value: storedRows })
			descriptors.push({
				field: instance.name,
				label: instance.label ?? instance.name,
				fieldType: instance.blockType,
				...(widthOf(instance) ? { width: widthOf(instance) } : {}),
				...(subFieldDescriptors.length > 0 ? { subFieldDescriptors } : {}),
			})
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
			...(widthOf(instance) ? { width: widthOf(instance) } : {}),
			...(optionLabels ? { optionLabels } : {}),
		})
	}

	return { errors, values: outValues, descriptors, consent: consentProofs }
}
