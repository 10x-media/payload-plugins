import { APIError, type CollectionBeforeValidateHook, ValidationError } from 'payload'
import { FORM_SUBMISSIONS_SLUG } from '../collections/formSubmissions'
import { FORMS_SLUG } from '../collections/forms'
import type { ConsentSourceRegistry } from '../consent/registry'
import type { FieldTypeRegistry } from '../fields/registry'
import { isPollClosed, pollConfigOf } from '../form/pollState'
import { applyPollOptions } from '../poll/applyPollOptions'
import type { PollOption } from '../poll/definePollOptionSource'
import type { PollOptionSourceRegistry } from '../poll/registry'
import { resolvePollOptions } from '../poll/resolvePollOptions'
import { IDENTITY_CONTEXT_KEY } from '../spam/constants'
import { keys } from '../translations/keys'
import { asFieldTranslate, asTranslate } from '../translations/server'
import type { ValidationRuleRegistry } from '../validation/registry'
import { runSubmission } from './runSubmission'
import type { FormFieldInstance, SubmissionValue } from './types'
import { POLL_CONTEXT_KEY } from './votedCookie'

export type ValidateSubmissionArgs = {
	registry: FieldTypeRegistry
	ruleRegistry: ValidationRuleRegistry
	consentRegistry: ConsentSourceRegistry
	/** The plugin-configured uploads collection slug; absent when uploads are disabled. */
	uploadSlug?: string
	/** Registered poll option sources; a form's configured `optionSource` resolves through this at validation time. */
	pollSourceRegistry?: PollOptionSourceRegistry
}

/**
 * Server-authoritative submission validation. On create it loads the referenced form, re-runs every
 * field's required check, intrinsic validator, and declarative rules through `runSubmission`, threading
 * `req`/`payload` so server-only async rules can hit the DB, and throws a Payload `ValidationError` with
 * per-field paths on any error-severity failure. The client is never trusted.
 * Consent fields are captured into `result.consent` (array of proofs, one per visible consent field).
 */
export const validateSubmission =
	({
		registry,
		ruleRegistry,
		consentRegistry,
		uploadSlug,
		pollSourceRegistry,
	}: ValidateSubmissionArgs): CollectionBeforeValidateHook =>
	async ({ data, operation, req }) => {
		if (operation !== 'create' || !data) {
			return data
		}
		const formId = data.form
		if (formId == null) {
			return data
		}

		const form = await req.payload.findByID({
			collection: FORMS_SLUG,
			id: formId as string | number,
			depth: 0,
			locale: req.locale,
			req,
		})

		// Stash the poll config (null = form has none) so the voted-cookie afterChange hook can
		// skip a second form fetch on the same request.
		const poll = pollConfigOf(form.poll)
		req.context[POLL_CONTEXT_KEY] = poll ?? null

		// Form-level lifecycle guard, before any field work: a closed poll accepts no submissions,
		// regardless of what the client rendered.
		if (poll?.enabled === true && isPollClosed(poll)) {
			throw new APIError(asTranslate(req.i18n.t)(keys.pollClosed), 403)
		}

		let fields = ((form.fields as FormFieldInstance[] | undefined) ?? []) as FormFieldInstance[]
		const incoming = ((data.values as SubmissionValue[] | undefined) ?? []) as SubmissionValue[]
		const locale = req.locale ?? 'en'
		const t = asFieldTranslate(req.i18n.t)

		// With an option source configured, the source's resolved values are the only accepted
		// answers for the results field: options are injected into the field instance (so the
		// select's membership check and the stored option labels use them) and membership is also
		// enforced directly, so an empty resolution or a non-select results field still fails
		// closed. A resolve failure rejects the whole submission rather than skipping the check.
		if (poll?.enabled === true && typeof poll.optionSource === 'string' && poll.optionSource) {
			let resolved: PollOption[]
			try {
				resolved =
					(await resolvePollOptions({
						payload: req.payload,
						req,
						form,
						sources: pollSourceRegistry ?? new Map(),
					})) ?? []
			} catch {
				throw new APIError(asTranslate(req.i18n.t)(keys.pollOptionsUnavailable), 503)
			}
			const resultsField = typeof poll.resultsField === 'string' ? poll.resultsField : undefined
			fields = applyPollOptions(fields, resultsField, resolved)
			if (resultsField) {
				const answer = incoming.find((entry) => entry.field === resultsField)?.value
				const isAnswered = answer != null && answer !== ''
				if (isAnswered && !resolved.some((option) => option.value === answer)) {
					throw new ValidationError(
						{
							collection: FORM_SUBMISSIONS_SLUG,
							errors: [
								{ path: resultsField, message: asTranslate(req.i18n.t)(keys.validationSelect) },
							],
						},
						req.t
					)
				}
			}
		}
		const expectedOwner =
			typeof req.context?.[IDENTITY_CONTEXT_KEY] === 'string'
				? (req.context[IDENTITY_CONTEXT_KEY] as string)
				: undefined

		const result = await runSubmission({
			fields,
			values: incoming,
			registry,
			ruleRegistry,
			consentRegistry,
			locale,
			t,
			operation: 'create',
			req,
			payload: req.payload,
			formId: formId as number | string,
			uploadSlug,
			expectedOwner,
		})

		if (result.errors.length > 0) {
			throw new ValidationError({ collection: FORM_SUBMISSIONS_SLUG, errors: result.errors }, req.t)
		}

		data.values = result.values
		data.descriptors = result.descriptors
		data.consent = result.consent.length > 0 ? result.consent : undefined
		data.locale = locale
		// Unauthenticated submits are always 'complete'. A client-supplied 'partial' would
		// silently skip all post-submit actions and events. Authenticated callers (e.g. an
		// admin draft-save flow) may set status themselves.
		if (!req.user) {
			data.status = 'complete'
		}
		return data
	}
