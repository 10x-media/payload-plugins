import { type CollectionBeforeValidateHook, ValidationError } from 'payload'
import { FORM_SUBMISSIONS_SLUG } from '../collections/formSubmissions'
import { FORMS_SLUG } from '../collections/forms'
import type { ConsentSourceRegistry } from '../consent/registry'
import type { FieldTypeRegistry } from '../fields/registry'
import { IDENTITY_CONTEXT_KEY } from '../spam/constants'
import { asFieldTranslate } from '../translations/server'
import type { ValidationRuleRegistry } from '../validation/registry'
import { runSubmission } from './runSubmission'
import type { FormFieldInstance, SubmissionValue } from './types'

export type ValidateSubmissionArgs = {
	registry: FieldTypeRegistry
	ruleRegistry: ValidationRuleRegistry
	consentRegistry: ConsentSourceRegistry
	/** Upload collection slug for file fields without an explicit `relationTo`. */
	uploadSlug?: string
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

		const fields = ((form.fields as FormFieldInstance[] | undefined) ?? []) as FormFieldInstance[]
		const incoming = ((data.values as SubmissionValue[] | undefined) ?? []) as SubmissionValue[]
		const locale = req.locale ?? 'en'
		const t = asFieldTranslate(req.i18n.t)
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
		return data
	}
