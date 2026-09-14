import { EVALUATE_PATH } from '../plugin/constants'
import type { EvaluateRequest, EvaluateResponse } from '../plugin/endpoint'

export type { EvaluateRequest, EvaluateResponse }

/**
 * Calls the plugin's evaluate endpoint. The endpoint answers 403 when the account lacks
 * access to the document or the variant; that surfaces here as an error the runner shows.
 */
export const evaluate = async (args: {
	apiRoute: string
	body: EvaluateRequest
	serverURL: string
	signal?: AbortSignal
}): Promise<EvaluateResponse> => {
	const response = await fetch(`${args.serverURL}${args.apiRoute}${EVALUATE_PATH}`, {
		body: JSON.stringify(args.body),
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		method: 'POST',
		signal: args.signal,
	})
	const json = (await response.json().catch(() => null)) as
		| (EvaluateResponse & { message?: string })
		| null
	if (!response.ok || !json) {
		throw new Error(json?.message ?? `Evaluate request failed (${response.status})`)
	}
	return json
}
