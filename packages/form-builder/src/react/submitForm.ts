import type { SubmissionValue } from '../submissions/types'

export type SubmitFormInput = {
	formId: number | string
	values: SubmissionValue[]
	/** Payload API route prefix; defaults to `/api`. */
	apiRoute?: string
	/** Injectable for testing; defaults to global `fetch`. */
	fetchImpl?: typeof fetch
}

export type SubmitFormResult =
	| { ok: true; submissionId?: string }
	| { ok: false; fieldErrors?: Record<string, string[]>; message?: string }

type ValidationErrorBody = {
	errors?: Array<{
		message?: string
		data?: { errors?: Array<{ path?: string; message?: string }> }
	}>
}

const toFieldErrors = (body: ValidationErrorBody): Record<string, string[]> => {
	const nested = body.errors?.[0]?.data?.errors ?? []
	const map: Record<string, string[]> = {}
	for (const entry of nested) {
		if (typeof entry.path === 'string' && typeof entry.message === 'string') {
			map[entry.path] = [...(map[entry.path] ?? []), entry.message]
		}
	}
	return map
}

/**
 * The default submission transport: POST `{apiRoute}/form-submissions` with `{ form, values }`. On 201
 * returns the created submission id; on a 400 Payload `ValidationError` maps `data.errors[].path` to
 * per-field messages; otherwise returns a generic message. Pure: inject `fetchImpl` in tests.
 */
export const submitForm = async (input: SubmitFormInput): Promise<SubmitFormResult> => {
	const { formId, values, apiRoute = '/api', fetchImpl = fetch } = input
	let response: Response
	try {
		response = await fetchImpl(`${apiRoute}/form-submissions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ form: formId, values }),
		})
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : 'Network error' }
	}
	if (response.ok) {
		const data = (await response.json().catch(() => ({}))) as { doc?: { id?: number | string } }
		const id = data.doc?.id
		return { ok: true, submissionId: id === undefined ? undefined : String(id) }
	}
	if (response.status === 400) {
		const body = (await response.json().catch(() => ({}))) as ValidationErrorBody
		const fieldErrors = toFieldErrors(body)
		if (Object.keys(fieldErrors).length > 0) {
			return { ok: false, fieldErrors }
		}
		return { ok: false, message: body.errors?.[0]?.message ?? 'Validation failed' }
	}
	// A non-400 failure can still carry a server-authored message worth showing verbatim, e.g. the
	// translated essential-action rejection; fall back to the generic line when there is none.
	const body = (await response.json().catch(() => ({}))) as ValidationErrorBody
	const message = body.errors?.[0]?.message
	return { ok: false, message: message ?? `Request failed (${response.status})` }
}

/** A consumer override for the transport: given the form id + values, resolve to a submit result. */
export type SubmitHandler = (input: {
	formId: number | string
	values: SubmissionValue[]
}) => Promise<SubmitFormResult>
