import type { FieldAggregation } from '../aggregation/types'

export type FetchResultsInput = {
	formId: number | string
	/** Restrict to one field. Omit to get every public/enumerable field. */
	field?: string
	/** Payload API route prefix; defaults to `/api`. */
	apiRoute?: string
	/** Injectable for testing; defaults to global `fetch`. */
	fetchImpl?: typeof fetch
}

export type FetchResultsResult =
	| { ok: true; results: FieldAggregation[] }
	| { ok: false; message?: string }

/**
 * Fetch aggregate poll/survey results from the form-builder results endpoint
 * (`GET {apiRoute}/forms/:id/results`). Returns the server-resolved aggregations; the endpoint gates public
 * access by the form's `showResults` opt-in. Pure: inject `fetchImpl` in tests.
 */
export const fetchFormResults = async (input: FetchResultsInput): Promise<FetchResultsResult> => {
	const { formId, field, apiRoute = '/api', fetchImpl = fetch } = input
	const query = field ? `?field=${encodeURIComponent(field)}` : ''
	let response: Response
	try {
		response = await fetchImpl(`${apiRoute}/forms/${formId}/results${query}`, { method: 'GET' })
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : 'Network error' }
	}
	if (!response.ok) {
		return { ok: false, message: `Request failed (${response.status})` }
	}
	const body = (await response.json().catch(() => ({}))) as { results?: FieldAggregation[] }
	return { ok: true, results: body.results ?? [] }
}
