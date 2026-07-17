import type { Payload, PayloadRequest } from 'payload'
import { FORMS_SLUG } from '../collections/forms'
import { isPollClosed, pollConfigOf } from '../form/pollState'
import type { PollOption } from '../poll/definePollOptionSource'
import { resolveEffectivePollOptions } from '../poll/effectivePollOptions'
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
	/**
	 * Poll-eligible field types (registry-derived). When set, an anonymous read of an
	 * option-source poll also requires the results field's instance to be one of these types,
	 * so legacy or db-written docs pointing at a free-text field can never expose stored
	 * answers as leftover result buckets.
	 */
	eligibleTypes?: readonly string[]
}

export type ResolveResultsRequestResult = {
	status: number
	body: { results: FieldAggregation[] } | { errors: { message: string }[] }
}

const forbidden: ResolveResultsRequestResult = {
	status: 403,
	body: { errors: [{ message: 'Forbidden' }] },
}

// 503 over 403 for a failed option-source resolve: the form and its poll config are already
// publicly readable, so "temporarily unavailable" leaks nothing new, matches the submission
// path's precedent, and does not mislabel a transient server fault as an authorization denial.
const unavailable: ResolveResultsRequestResult = {
	status: 503,
	body: { errors: [{ message: 'Poll options unavailable' }] },
}

/**
 * Authorize and resolve a poll/survey results request. Authed callers may aggregate any field (or all
 * enumerable fields) and bypass the `access` seam; for a poll-enabled form they also get the results
 * field's effective options injected so sourced/resolver-backed polls render labels (best-effort, a
 * resolve failure degrades to raw values rather than blocking the trusted read). Anonymous callers are
 * allowed only when the form's poll is enabled, the poll's `resultsVisibility` permits it (`afterVote`:
 * any time; `afterClose`: only once `closesAt` has passed), and the optional host `access` seam
 * approves; and then only for the configured `poll.resultsField`, and only if that field is enumerable
 * so a misconfigured `resultsField` pointing at a free-text or PII field can never be dumped publicly. A
 * static poll is enumerable through its authored options; a poll whose options come from an
 * `optionSource` or the field type's own `resolveOptions` resolves them here (registry via
 * `config.custom`, per-request cache), gated by `eligibleTypes` and enumerable only when resolution
 * yields any, with the resolved options driving bucket order and labels. Resolution failure fails
 * closed (503) on the anonymous path. Returns only aggregate counts, never raw submissions.
 */
export const resolveFormResultsRequest = async (
	args: ResolveResultsRequestArgs
): Promise<ResolveResultsRequestResult> => {
	const { payload, formId, field, isAuthed, req, access, eligibleTypes } = args
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
	let resolvedOptions: Record<string, { value: string; label: string }[]> | undefined
	if (isAuthed) {
		fields = field ? [field] : undefined
		// Label a poll's results field for admins: resolve its effective options (a source, the
		// field type's own resolver, or authored options) and inject them so a sourced/resolved poll
		// shows labels instead of raw stored values, and so an all-fields read still surfaces a
		// resolver-backed field that carries no authored options. Best-effort: a resolver/source
		// failure degrades to raw values rather than blocking the trusted read (the anonymous path
		// below fails closed instead). Only run when the read would actually surface the results field.
		const poll = pollConfigOf(form.poll)
		const resultsField =
			typeof poll?.resultsField === 'string' && poll.resultsField.length > 0
				? poll.resultsField
				: undefined
		if (poll?.enabled === true && resultsField && (!field || field === resultsField)) {
			const options: PollOption[] = await resolveEffectivePollOptions({
				payload,
				req,
				form,
			}).catch(() => [])
			if (options.length > 0) {
				resolvedOptions = { [resultsField]: options }
			}
		}
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
		if (!instance) {
			return forbidden
		}
		const hasSource = typeof poll.optionSource === 'string' && poll.optionSource.length > 0
		const authored = fieldHasOptions(instance)
		// Options that don't come from the author's own literal `options` list (a source or a
		// field-typed resolver) require the results field to be a poll-eligible type, so a legacy or
		// db-written doc pointing `resultsField` at a free-text field can never dump raw answers as
		// leftover buckets. A static authored poll is a choice field already, so it keeps serving.
		if ((hasSource || !authored) && eligibleTypes && !eligibleTypes.includes(instance.blockType)) {
			return forbidden
		}
		let options: PollOption[]
		try {
			options = await resolveEffectivePollOptions({ payload, req, form })
		} catch {
			return unavailable
		}
		if (options.length === 0) {
			return forbidden
		}
		resolvedOptions = { [publicField]: options }
		fields = [publicField]
	}

	const results = await aggregateFormResponses({ payload, formId, fields, req, resolvedOptions })
	return { status: 200, body: { results } }
}
