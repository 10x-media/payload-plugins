import { APIError, type CollectionBeforeValidateHook, ValidationError } from 'payload'
import { calcExpressionOf } from '../calc/computeCalcFields'
import type { CalcResolved } from '../calc/evaluate'
import type { CalcFunction, CalcSource } from '../calc/registry'
import { resolveCalcContext } from '../calc/resolveCalcContext'
import { FORM_SUBMISSIONS_SLUG } from '../collections/formSubmissions'
import { FORMS_SLUG } from '../collections/forms'
import type { ConsentSnapshotMode } from '../consent/captureConsent'
import { resolveConsentEntries } from '../consent/resolveConsentEntries'
import type { ConsentSourceEntry, ConsentSourcesResolver } from '../consent/types'
import type { FieldTypeRegistry } from '../fields/registry'
import { isPollClosed, pollConfigOf } from '../form/pollState'
import { applyPollOptions } from '../poll/applyPollOptions'
import type { PollOption } from '../poll/definePollOptionSource'
import { resolveEffectivePollOptions } from '../poll/effectivePollOptions'
import type { PollOptionSourceRegistry } from '../poll/registry'
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
	/** Registered calc sources (plugin option `calc.sources`); re-resolved fresh per submission. */
	calcSources?: Record<string, CalcSource>
	/** Registered calc functions (plugin option `calc.functions`); threaded into calc evaluation. */
	calcFunctions?: Record<string, CalcFunction>
	/** The host's consent sources resolver (plugin option `consent.sources`); absent when no sources are configured. */
	consentSources?: ConsentSourcesResolver
	/** What each consent proof snapshots of the agreed wording (plugin option `consent.snapshot`). */
	consentSnapshot?: ConsentSnapshotMode
	/** The plugin-configured uploads collection slug; absent when uploads are disabled. */
	uploadSlug?: string
	/** Registered poll option sources; a form's configured `optionSource` resolves through this at validation time. */
	pollSourceRegistry?: PollOptionSourceRegistry
	/** Plugin `spam.uploadOwnership: 'strict'`: reject an owned upload when the submitter is unidentifiable. */
	strictUploadOwnership?: boolean
}

/**
 * Server-authoritative submission validation. On create it loads the referenced form, re-runs every
 * field's required check, intrinsic validator, and declarative rules through `runSubmission`, threading
 * `req`/`payload` so server-only async rules can hit the DB, and throws a Payload `ValidationError` with
 * per-field paths on any failure. The client is never trusted.
 * Consent fields are captured into `result.consent` (array of proofs, one per visible consent field),
 * built from the host's sources re-resolved here rather than from anything the form or client carries.
 */
export const validateSubmission =
	({
		registry,
		ruleRegistry,
		calcSources,
		calcFunctions,
		consentSources,
		consentSnapshot,
		uploadSlug,
		pollSourceRegistry,
		strictUploadOwnership,
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

		// Stash whether the form is poll-enabled (its top-level `pollEnabled` flag) so the voted-cookie
		// afterChange hook can skip a second form fetch on the same request.
		const poll = pollConfigOf(form.poll)
		const pollEnabled = form.pollEnabled === true
		req.context[POLL_CONTEXT_KEY] = pollEnabled

		// Form-level lifecycle guard, before any field work: a closed poll accepts no submissions,
		// regardless of what the client rendered.
		if (pollEnabled && isPollClosed(poll)) {
			throw new APIError(asTranslate(req.i18n.t)(keys.pollClosed), 403)
		}

		let fields = ((form.fields as FormFieldInstance[] | undefined) ?? []) as FormFieldInstance[]
		const incoming = ((data.values as SubmissionValue[] | undefined) ?? []) as SubmissionValue[]
		const locale = req.locale ?? 'en'
		const t = asFieldTranslate(req.i18n.t)

		// With a resolved choice set for the results field (a poll `optionSource`, or the field type's
		// own `resolveOptions`) the resolved values are the only accepted answers: options are injected
		// into the field instance (so the select's membership check and the stored option labels use
		// them) and membership is also enforced directly, so an empty resolution or a non-select results
		// field still fails closed. A resolve failure rejects the whole submission rather than skipping
		// the check. Static authored polls are unaffected: their field validates against its own options
		// through the normal field pipeline.
		const resultsField =
			pollEnabled && typeof poll?.resultsField === 'string' && poll.resultsField.length > 0
				? poll.resultsField
				: undefined
		const resultsInstance = resultsField
			? fields.find((instance) => instance.name === resultsField)
			: undefined
		const usesResolver =
			(typeof poll?.optionSource === 'string' && poll.optionSource.length > 0) ||
			Boolean(resultsInstance && registry.get(resultsInstance.blockType)?.resolveOptions)
		if (resultsField && usesResolver) {
			let resolved: PollOption[]
			try {
				resolved = await resolveEffectivePollOptions({
					payload: req.payload,
					req,
					form,
					sources: pollSourceRegistry ?? new Map(),
					fieldTypes: registry,
				})
			} catch {
				throw new APIError(asTranslate(req.i18n.t)(keys.pollOptionsUnavailable), 503)
			}
			fields = applyPollOptions(fields, resultsField, resolved)
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
		const expectedOwner =
			typeof req.context?.[IDENTITY_CONTEXT_KEY] === 'string'
				? (req.context[IDENTITY_CONTEXT_KEY] as string)
				: undefined

		// Every consent proof is built from the source as it reads right now, not from anything the
		// form or the client carries, so a resolver failure rejects the submission rather than
		// recording an agreement to a statement the server cannot vouch for.
		let consentEntries: ConsentSourceEntry[] = []
		if (consentSources && fields.some((field) => field.blockType === 'consent')) {
			try {
				consentEntries = await resolveConsentEntries({
					payload: req.payload,
					req,
					form,
					sources: consentSources,
				})
			} catch {
				throw new APIError(asTranslate(req.i18n.t)(keys.consentSourcesUnavailable), 503)
			}
		}

		// Calc extension values re-resolve fresh here, never trusting the render-time embedding, and a
		// resolver failure THROWS: a calc total is money math, so an outage must reject the submission
		// rather than silently evaluating to 0 (the render path fails open instead; see `calcAfterRead`).
		let calcResolved: CalcResolved | undefined
		if (fields.some((instance) => calcExpressionOf(instance) !== undefined)) {
			const resolved = await resolveCalcContext({
				fields,
				sources: calcSources ?? {},
				form: form as { id: number | string } & Record<string, unknown>,
				payload: req.payload,
				req,
			})
			const functions =
				calcFunctions && Object.keys(calcFunctions).length > 0
					? Object.fromEntries(
							Object.entries(calcFunctions).map(([name, definition]) => [name, definition.apply])
						)
					: undefined
			calcResolved = { ...resolved, ...(functions ? { functions } : {}) }
		}

		const result = await runSubmission({
			fields,
			values: incoming,
			calcResolved,
			registry,
			ruleRegistry,
			consentEntries,
			consentSnapshot,
			locale,
			t,
			operation: 'create',
			req,
			payload: req.payload,
			formId: formId as number | string,
			uploadSlug,
			expectedOwner,
			strictUploadOwnership,
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
