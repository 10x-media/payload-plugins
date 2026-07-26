import type { Payload, PayloadRequest } from 'payload'
import type { FormContextReference } from '../context/formContext'
import type { SubmissionDescriptor, SubmissionValue } from '../submissions/types'

/** Arguments a recipient source's `resolve` receives when a submission's email actions run. */
export type RecipientResolveArgs = {
	/** The verified form-context reference, or null when the form was rendered without one. */
	context: FormContextReference | null
	values: SubmissionValue[]
	descriptors: SubmissionDescriptor[]
	form: { id: number | string; title?: string }
	submissionId: number | string
	payload: Payload
	req?: PayloadRequest
	locale: string
}

/**
 * A recipient the plugin resolves server-side at send time (plugin option `email.recipientSources`).
 * `value` is the namespaced string stored in the recipient list (e.g. `context:pageContact`), so it
 * cannot collide with an address; `label` is what the editor sees in the recipient field. `resolve`
 * returns zero or more addresses, `[]` meaning "nothing to send to from this source", which is normal.
 */
export type RecipientSource = {
	value: string
	label: string | Record<string, string>
	resolve: (args: RecipientResolveArgs) => Promise<string[]> | string[]
}

export type RecipientSourceRegistry = Record<string, RecipientSource>

/** Index sources by their stored `value` for O(1) lookup during validation and resolution. */
export const sourcesByValue = (
	registry?: RecipientSourceRegistry
): Map<string, RecipientSource> => {
	const map = new Map<string, RecipientSource>()
	for (const source of Object.values(registry ?? {})) {
		map.set(source.value, source)
	}
	return map
}
