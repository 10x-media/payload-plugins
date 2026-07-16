import type { Payload, PayloadRequest } from 'payload'
import { FORMS_SLUG } from '../collections/forms'
import { isPollClosed, pollConfigOf } from '../form/pollState'
import type { FormFieldInstance } from '../submissions/types'
import { aggregateFormResponses, fieldHasOptions } from './aggregateResponses'
import type { FieldAggregation } from './types'

export type FormResultsAccessArgs = {
	req: PayloadRequest
	/** The loaded forms document (depth 0). Untyped beyond `id`: hosts read their own fields (e.g. `form.tenant`). */
	form: { id: number | string } & Record<string, unknown>
}

/**
 * Host seam gating anonymous results reads, evaluated after the form is loaded and before anything
 * is aggregated. Multi-tenant recipe: compare `form.tenant` against the tenant derived from `req`
 * (host header, cookie, or auth context) and return `false` for a cross-tenant read. Authenticated
 * callers bypass this seam (they are admin-trusted, like the rest of the results endpoint).
 */
export type FormResultsAccess = (args: FormResultsAccessArgs) => boolean | Promise<boolean>

export type ResolveResultsRequestArgs = {
	payload: Payload
	formId: number | string | undefined
	/** The requested field (query param). */
	field?: string
	/** Whether the caller is authenticated (an admin/user). */
	isAuthed: boolean
	req?: PayloadRequest
	/** Optional host seam for anonymous reads; absent means plugin-default gating only. */
	access?: FormResultsAccess
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
 * enumerable fields) and bypass the `access` seam. Anonymous callers are allowed only when the form's
 * poll is enabled, the poll's `resultsVisibility` permits it (`afterVote`: any time; `afterClose`: only
 * once `closesAt` has passed), and the optional host `access` seam approves; and then only for the
 * configured `poll.resultsField`, and only if that field is enumerable (has options) so a misconfigured
 * `resultsField` pointing at a free-text or PII field can never be dumped publicly. Returns only
 * aggregate counts, never raw submissions.
 */
export const resolveFormResultsRequest = async (
	args: ResolveResultsRequestArgs
): Promise<ResolveResultsRequestResult> => {
	const { payload, formId, field, isAuthed, req, access } = args
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
		const poll = pollConfigOf(form.poll)
		if (poll?.enabled !== true) {
			return forbidden
		}
		if (poll.resultsVisibility === 'afterClose' && !isPollClosed(poll)) {
			return forbidden
		}
		if (access) {
			// No req means the seam cannot be evaluated; fail closed rather than skip a configured gate.
			// The concrete generated Form doc has no index signature; the seam's Record<string, unknown>
			// is the ergonomic host-facing contract, so widen the doc to it here.
			const allowed = req
				? await access({ req, form: form as unknown as FormResultsAccessArgs['form'] })
				: false
			if (!allowed) {
				return forbidden
			}
		}
		const publicField =
			typeof poll.resultsField === 'string' && poll.resultsField.length > 0
				? poll.resultsField
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
