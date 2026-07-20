import type { Payload, PayloadRequest } from 'payload'
import { FORMS_SLUG } from '../collections/forms'
import type { PollOption } from './definePollOptionSource'
import { resolveEffectivePollOptions } from './effectivePollOptions'

export type ResolvePollOptionsRequestArgs = {
	payload: Payload
	formId: number | string | undefined
	/** Whether the caller is authenticated (an admin/user). */
	isAuthed: boolean
	req?: PayloadRequest
}

export type ResolvePollOptionsRequestResult = {
	status: number
	body: { options: PollOption[] } | { errors: { message: string }[] }
}

/**
 * Authorize and resolve the `GET /:id/poll-options` request backing the admin winner select:
 * authenticated callers get the poll's effective options (source-resolved or authored, exactly the
 * set outcome validation accepts), anonymous callers are always refused. Statuses mirror the
 * results endpoint: 400 missing id, 403 unauthenticated, 404 unknown form, 503 when the option
 * source fails (fail closed).
 */
export const resolvePollOptionsRequest = async (
	args: ResolvePollOptionsRequestArgs
): Promise<ResolvePollOptionsRequestResult> => {
	const { payload, formId, isAuthed, req } = args
	if (!isAuthed) {
		return { status: 403, body: { errors: [{ message: 'Forbidden' }] } }
	}
	if (formId == null) {
		return { status: 400, body: { errors: [{ message: 'Missing form id' }] } }
	}
	const form = await payload
		.findByID({ collection: FORMS_SLUG, id: formId, depth: 0, overrideAccess: true, req })
		.catch(() => null)
	if (!form) {
		return { status: 404, body: { errors: [{ message: 'Not found' }] } }
	}
	try {
		const options = await resolveEffectivePollOptions({ payload, req, form })
		return { status: 200, body: { options } }
	} catch {
		return { status: 503, body: { errors: [{ message: 'Poll options unavailable' }] } }
	}
}
