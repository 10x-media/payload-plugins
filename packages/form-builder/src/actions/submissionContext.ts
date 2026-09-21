import type { Payload, PayloadRequest } from 'payload'
import type { FormContextReference } from '../context/formContext'
import type { SubmissionDescriptor, SubmissionValue } from '../submissions/types'

/**
 * The submission a post-submit hook runs for, shared by the public hook contracts that receive it
 * (a recipient source's `resolve`, `email.render`). Each extends it with its own fields rather than
 * with another's, so a field added for one hook never silently joins another's API.
 */
export type SubmissionContextArgs = {
	/** The verified form-context reference, or null when the form was rendered without one. */
	context: FormContextReference | null
	values: SubmissionValue[]
	descriptors: SubmissionDescriptor[]
	form: { id: number | string; title?: string }
	submissionId: number | string
	payload: Payload
	req?: PayloadRequest
	/** The submission's own stored locale, the one the form (and so its action config) was loaded at. */
	locale: string
}
