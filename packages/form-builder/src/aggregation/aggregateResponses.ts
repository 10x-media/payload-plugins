import type { Payload, PayloadRequest } from 'payload'
import { FORM_SUBMISSIONS_SLUG } from '../collections/formSubmissions'
import { FORMS_SLUG } from '../collections/forms'
import { isNamedField, type NamedFormFieldInstance } from '../fields/fieldKey'
import type { FormFieldInstance } from '../submissions/types'
import { aggregateRowsForFields } from './aggregateRows'
import type { AggregationRow, FieldAggregation, FieldMeta, SubmissionStatusFilter } from './types'

export type AggregateFormResponsesArgs = {
	payload: Payload
	formId: number | string
	/** Field machine names to aggregate. Defaults to every field that declares options (enumerable). */
	fields?: string[]
	/** Submission status to count. Defaults to `complete`. */
	status?: SubmissionStatusFilter
	req?: PayloadRequest
	/** Safety cap on submissions scanned; beyond it the result is flagged `truncated`. Default 10000. */
	maxSubmissions?: number
	/** Page size for the submission scan. Default 500. */
	pageSize?: number
	/**
	 * Source-resolved options by field name (an option-source poll's results field). They replace
	 * the instance's authored options for bucket seeding, order, and labels, and mark the field
	 * enumerable for the default field selection.
	 */
	resolvedOptions?: Record<string, { value: string; label: string }[]>
}

const optionsOf = (field: FormFieldInstance): { value: string; label: string }[] | undefined => {
	if (!Array.isArray(field.options)) {
		return undefined
	}
	const options = (field.options as Array<{ label?: string; value?: string }>)
		.filter((option) => typeof option?.value === 'string')
		.map((option) => ({ value: String(option.value), label: option.label ?? String(option.value) }))
	return options.length > 0 ? options : undefined
}

/** True when a field declares non-empty options (a choice field safe to aggregate publicly). */
export const fieldHasOptions = (field: FormFieldInstance): boolean => optionsOf(field) !== undefined

const metaFor = (
	field: NamedFormFieldInstance,
	resolved?: { value: string; label: string }[]
): FieldMeta => ({
	field: field.name,
	label: field.label ?? field.name,
	fieldType: field.blockType,
	options: resolved && resolved.length > 0 ? resolved : optionsOf(field),
})

/**
 * Aggregate submission responses for a form. Loads the form for current labels + option order, then pages
 * `payload.find` over its submissions (JSON `values` cannot be GROUP BY'd portably across Mongo + Postgres,
 * so we scan + reduce in JS, cross-DB-identically). Bounded by `maxSubmissions`; beyond it the result is
 * `truncated`. Returns one `FieldAggregation` per requested field (or per enumerable field by default).
 */
export const aggregateFormResponses = async (
	args: AggregateFormResponsesArgs
): Promise<FieldAggregation[]> => {
	const {
		payload,
		formId,
		fields,
		status = 'complete',
		req,
		maxSubmissions = 10000,
		pageSize = 500,
		resolvedOptions,
	} = args
	const form = await payload
		.findByID({ collection: FORMS_SLUG, id: formId, depth: 0, overrideAccess: true, req })
		.catch(() => null)
	if (!form || !Array.isArray(form.fields)) {
		return []
	}
	const instances = form.fields as FormFieldInstance[]
	const selected = fields
		? instances.filter(
				(field): field is NamedFormFieldInstance =>
					isNamedField(field) && fields.includes(field.name)
			)
		: instances.filter(
				(field): field is NamedFormFieldInstance =>
					isNamedField(field) &&
					(optionsOf(field) !== undefined || (resolvedOptions?.[field.name]?.length ?? 0) > 0)
			)
	if (selected.length === 0) {
		return []
	}
	const metas = selected.map((field) => metaFor(field, resolvedOptions?.[field.name]))

	const statusWhere = status === 'all' ? [] : [{ status: { equals: status } }]
	const where = { and: [{ form: { equals: formId } }, ...statusWhere] }

	const rows: AggregationRow[] = []
	let page = 1
	let truncated = false
	for (;;) {
		const result = await payload.find({
			collection: FORM_SUBMISSIONS_SLUG,
			where,
			limit: pageSize,
			page,
			depth: 0,
			overrideAccess: true,
			req,
			select: { values: true, descriptors: true },
		})
		for (const doc of result.docs as AggregationRow[]) {
			// Check before pushing so `truncated` means "matching rows were left out", not "the cap was reached
			// exactly": a form with precisely `maxSubmissions` responses is complete, not a sample.
			if (rows.length >= maxSubmissions) {
				truncated = true
				break
			}
			rows.push({ values: doc.values, descriptors: doc.descriptors })
		}
		if (truncated || !result.hasNextPage) {
			break
		}
		page += 1
	}

	return aggregateRowsForFields(rows, metas, truncated)
}

export type AggregateFieldResponsesArgs = Omit<AggregateFormResponsesArgs, 'fields'> & {
	field: string
}

/** Single-field convenience over `aggregateFormResponses`. Returns the field's aggregation, or null if absent. */
export const aggregateFieldResponses = async (
	args: AggregateFieldResponsesArgs
): Promise<FieldAggregation | null> => {
	const { field, ...rest } = args
	const [result] = await aggregateFormResponses({ ...rest, fields: [field] })
	return result ?? null
}
