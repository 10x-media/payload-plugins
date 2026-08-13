import {
	APIError,
	addDataAndFileToRequest,
	addLocalesToRequestFromData,
	type Endpoint,
	type PayloadRequest,
} from 'payload'
import { pollConfigOf } from '../form/pollState'
import { formIdOf } from './formIdOf'
import { VOTE_CHANGE_CONTEXT_KEY, votedSubmissionIdFromCookie } from './votedCookie'

const FORM_SUBMISSIONS_SLUG = 'form-submissions'
const FORMS_SLUG = 'forms'

const isComplete = (doc: { status?: unknown }): boolean =>
	doc.status == null || doc.status === 'complete'

/**
 * The submission a cookie-identified re-vote should update, or null when the request must fall
 * through to a plain create. Guards run cheapest-first: no valid signed cookie for the posted form
 * means no form fetch at all, so the delegation overhead on ordinary submissions is one header
 * parse. A token is honored only when the form is an `allowChange` poll and it names a still
 * existing, complete submission of that same form; anything else (pruned row, cross-form replay,
 * legacy `1` marker, tampering) makes the caller a new voter rather than an error.
 */
export const resolveVoteChangeTarget = async (args: {
	req: PayloadRequest
	formId: number | string | undefined | null
}): Promise<{ submissionId: number | string } | null> => {
	const { req, formId } = args
	if (formId == null) {
		return null
	}
	const submissionId = votedSubmissionIdFromCookie(
		req.headers?.get('cookie'),
		formId,
		req.payload.secret
	)
	if (submissionId == null) {
		return null
	}
	const form = await req.payload
		.findByID({ collection: FORMS_SLUG, id: formId, depth: 0, overrideAccess: true, req })
		.catch(() => null)
	if (form?.pollEnabled !== true || pollConfigOf(form.poll)?.allowChange !== true) {
		return null
	}
	const submission = await req.payload
		.findByID({
			collection: FORM_SUBMISSIONS_SLUG,
			id: submissionId,
			depth: 0,
			overrideAccess: true,
			req,
		})
		.catch(() => null)
	if (submission == null) {
		return null
	}
	const stored = submission as { form?: unknown; status?: unknown }
	if (String(formIdOf(stored.form) ?? '') !== String(formId) || !isComplete(stored)) {
		return null
	}
	return { submissionId: submission.id as number | string }
}

/**
 * Custom root `POST /form-submissions` endpoint. Payload matches a collection's custom endpoints
 * ahead of its built-in REST routes, so this handler sees every REST create first: when the posted
 * form is an `allowChange` poll and the voted cookie identifies the caller's submission, it turns
 * the request into an in-place update (create-grade hooks opt in via the context flag); otherwise
 * it delegates to the stock create handler found in the same sanitized endpoint list, keeping the
 * default path semantics Payload's, not a reimplementation. The update runs `overrideAccess`
 * because the collection is deliberately update-closed to every API caller; the signed cookie is
 * the credential here, verified above rather than by collection access.
 */
export const buildVoteSubmitEndpoint = (): Endpoint => {
	const handler = async (req: PayloadRequest): Promise<Response> => {
		await addDataAndFileToRequest(req)
		addLocalesToRequestFromData(req)
		const data = (req.data ?? {}) as {
			form?: number | string
			values?: unknown
		}
		const target = await resolveVoteChangeTarget({ req, formId: data.form })
		if (!target) {
			const endpoints = req.payload.collections[FORM_SUBMISSIONS_SLUG]?.config.endpoints
			const registered: Endpoint[] = Array.isArray(endpoints) ? endpoints : []
			const stockCreate = registered.find(
				(endpoint) =>
					endpoint.method === 'post' && endpoint.path === '/' && endpoint.handler !== handler
			)
			if (!stockCreate) {
				throw new APIError('form-builder: stock create endpoint not found', 500)
			}
			return stockCreate.handler(req)
		}
		req.context[VOTE_CHANGE_CONTEXT_KEY] = target.submissionId
		// Slug-agnostic cast (the `createSubmission` idiom): a host's generated types pin the
		// runtime-registered collection's `form` id flavor and `values` JSON shape, which this
		// framework-level write cannot know. Bound, because `update` is a prototype method.
		const update = req.payload.update.bind(req.payload) as unknown as (options: {
			collection: string
			id: number | string
			data: { form?: number | string; values?: unknown }
			depth?: number
			overrideAccess?: boolean
			req?: PayloadRequest
		}) => Promise<unknown>
		const doc = await update({
			collection: FORM_SUBMISSIONS_SLUG,
			id: target.submissionId,
			data: { form: data.form, values: data.values },
			depth: 0,
			overrideAccess: true,
			req,
		})
		return Response.json({ doc, message: req.t('general:updatedSuccessfully') }, { status: 200 })
	}
	return { path: '/', method: 'post', handler, custom: { formBuilder: 'vote-submit' } }
}
