import { type CollectionBeforeValidateHook, ValidationError } from 'payload'
import { FORM_SUBMISSIONS_SLUG } from '../collections/formSubmissions'
import { FORMS_SLUG } from '../collections/forms'
import type { FieldTypeRegistry } from '../fields/registry'
import { asFieldTranslate } from '../translations/server'
import { runSubmission } from './runSubmission'
import type { FormFieldInstance, SubmissionValue } from './types'

/**
 * Server-authoritative submission validation. On create it loads the referenced form, re-runs every
 * field's intrinsic validator through `runSubmission`, throws a Payload `ValidationError` with
 * per-field paths when anything fails, and writes the typed values plus the localized descriptor
 * snapshot. The client is never trusted. The declarative rule registry (Phase 2) threads through here.
 */
export const validateSubmission =
	(registry: FieldTypeRegistry): CollectionBeforeValidateHook =>
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

		const result = await runSubmission({ fields, values: incoming, registry, locale, t })

		if (result.errors.length > 0) {
			throw new ValidationError({ collection: FORM_SUBMISSIONS_SLUG, errors: result.errors }, req.t)
		}

		data.values = result.values
		data.descriptors = result.descriptors
		data.locale = locale
		return data
	}
