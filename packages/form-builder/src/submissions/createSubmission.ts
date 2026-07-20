import type { Payload, PayloadRequest } from 'payload'
import { FORM_SUBMISSIONS_SLUG } from '../collections/formSubmissions'
import type { ConsentProofEntry } from './runSubmission'
import type { SubmissionDescriptor, SubmissionValue } from './types'

export type CreateSubmissionArgs = {
	form: number | string
	values: SubmissionValue[]
	/** Thread the incoming request when there is one, so spam metadata (IP, user agent) and per-identity rate limiting see it. */
	req?: PayloadRequest
}

/** The stored shape of a `form-submissions` document, as written by the collection's own hooks. */
export type CreatedSubmission = {
	id: number | string
	form: number | string
	status: 'complete' | 'partial'
	locale?: string
	values?: SubmissionValue[]
	descriptors?: SubmissionDescriptor[]
	consent?: ConsentProofEntry[]
	meta?: Record<string, unknown>
	createdAt: string
	updatedAt: string
}

/**
 * Server-side counterpart to the browser `submitForm` helper: a typed wrapper over `payload.create`
 * for the `form-submissions` collection. Submitting this way runs the exact same pipeline a browser
 * or raw REST submit does, server-authoritative validation, spam metadata capture when `req` is
 * threaded through, descriptor snapshotting, consent capture, and post-submit action dispatch, since
 * all of it lives in the collection's own hooks rather than in a route handler. Use it from server
 * code (a script, a queued job, another collection's hook) instead of hand-rolling the collection
 * slug and body shape.
 */
export const createSubmission = (
	payload: Payload,
	args: CreateSubmissionArgs
): Promise<CreatedSubmission> => {
	// `form-submissions` is registered by this plugin at runtime, so a host's generated Payload types
	// need not describe it, and when they do, pin its `form` relationship to whichever single id type
	// (string or number) that host's database uses. `form` here accepts either, so create through a
	// slug-agnostic signature instead of the host's own shape (same idiom as `registerReliability`'s
	// locks-collection create in the jobs plugin).
	const create = payload.create as unknown as (options: {
		collection: string
		data: { form: number | string; values: SubmissionValue[] }
		req?: PayloadRequest
	}) => Promise<CreatedSubmission>
	return create({
		collection: FORM_SUBMISSIONS_SLUG,
		data: { form: args.form, values: args.values },
		req: args.req,
	})
}
