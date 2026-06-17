import type { Payload, PayloadRequest } from 'payload'
import { FORMS_SLUG } from '../collections/forms'
import type { FormFieldInstance } from '../submissions/types'
import { aggregateFormResponses, fieldHasOptions } from './aggregateResponses'
import type { FieldAggregation } from './types'

export type ResolveResultsRequestArgs = {
	payload: Payload
	formId: number | string | undefined
	/** The requested field (query param). */
	field?: string
	/** Whether the caller is authenticated (an admin/user). */
	isAuthed: boolean
	req?: PayloadRequest
}

export type ResolveResultsRequestResult = {
	status: number
	body: { results: FieldAggregation[] } | { errors: { message: string }[] }
}

const forbidden: ResolveResultsRequestResult = {
	status: 403,
	body: { errors: [{ message: 'Forbidden' }] },
}

/**
 * Authorize and resolve a poll/survey results request. Authed callers may aggregate any field (or all
 * enumerable fields). Anonymous callers are allowed only when the form opted in (`showResults`), and then
 * only for the configured `resultsField`, and only if that field is enumerable (has options) so a
 * misconfigured `resultsField` pointing at a free-text or PII field can never be dumped publicly. Returns
 * only aggregate counts, never raw submissions.
 */
export const resolveFormResultsRequest = async (
	args: ResolveResultsRequestArgs
): Promise<ResolveResultsRequestResult> => {
	const { payload, formId, field, isAuthed, req } = args
	if (formId == null) {
		return { status: 400, body: { errors: [{ message: 'Missing form id' }] } }
	}
	const form = await payload
		.findByID({ collection: FORMS_SLUG, id: formId, depth: 0, overrideAccess: true, req })
		.catch(() => null)
	if (!form) {
		return { status: 404, body: { errors: [{ message: 'Not found' }] } }
	}

	let fields: string[] | undefined
	if (isAuthed) {
		fields = field ? [field] : undefined
	} else {
		if (form.showResults !== true) {
			return forbidden
		}
		const publicField =
			typeof form.resultsField === 'string' && form.resultsField.length > 0
				? form.resultsField
				: undefined
		if (!publicField) {
			return forbidden
		}
		if (field && field !== publicField) {
			return forbidden
		}
		const instances = Array.isArray(form.fields) ? (form.fields as FormFieldInstance[]) : []
		const instance = instances.find((entry) => entry.name === publicField)
		if (!instance || !fieldHasOptions(instance)) {
			return forbidden
		}
		fields = [publicField]
	}

	const results = await aggregateFormResponses({ payload, formId, fields, req })
	return { status: 200, body: { results } }
}
