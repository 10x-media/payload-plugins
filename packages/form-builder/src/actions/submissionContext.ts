import type { Payload, PayloadRequest } from 'payload'
import type { FormContextReference } from '../context/formContext'
import type { SubmissionDescriptor, SubmissionValue } from '../submissions/types'

/**
 * The form a submission's post-submit hooks run for: the whole document as the plugin loaded it for
 * the run, at depth 0 (relationships are ids, e.g. a multi-tenant host's `form.tenant`) with its
 * localized fields in the submission's locale. Read a field off it instead of reading the form back,
 * casting for your own fields (`form.tenant as string`). Every hook of the run shares this one object,
 * so treat it as read-only.
 */
export type SubmissionForm = { id: number | string; title?: string } & Record<string, unknown>

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
	form: SubmissionForm
	submissionId: number | string
	payload: Payload
	req?: PayloadRequest
	/** The submission's own stored locale, the one the form (and so its action config) was loaded at. */
	locale: string
}
