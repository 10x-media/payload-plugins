'use client'

import type { FormFlow } from '../flow/types'
import type { FormFieldInstance } from '../submissions/types'
import type { FormDocument, FormResponseSettings } from './Form'

/**
 * Narrows a Payload-generated form document (from `getPayload().findByID()` or `fetch`) to
 * `FormDocument` without an unsafe `as` cast. Handles the small structural mismatches between
 * the auto-generated collection types and what `<Form>` expects:
 * - `fields` may be a typed blocks-union array or null; normalized to `FormFieldInstance[]`
 * - `flow` is stored as opaque JSON; typed as `FormFlow | undefined`
 * - `defaultPresentation` may be null; coerced to `undefined`
 * - `response` may be null; coerced to `undefined`
 */
export function toFormDocument(form: {
	id: number | string
	fields?: { blockType: string; name: string; [key: string]: unknown }[] | null
	flow?: unknown
	defaultPresentation?: string | null
	response?: {
		type?: string | null
		message?: unknown
		redirect?: { url?: string | null } | null
		submitLabel?: string | null
	} | null
}): FormDocument {
	return {
		id: form.id,
		fields: (form.fields ?? []) as FormFieldInstance[],
		flow: form.flow as FormFlow | undefined,
		defaultPresentation: form.defaultPresentation ?? undefined,
		response: (form.response as FormResponseSettings | null | undefined) ?? undefined,
	}
}
