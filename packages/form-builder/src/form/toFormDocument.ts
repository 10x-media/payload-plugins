import type { FormFlow } from '../flow/types'
import type { FormFieldInstance } from '../submissions/types'
import type { FormDisplaySettings, FormDocument, FormResponseSettings } from './types'

/**
 * Narrows a Payload-generated form document (from `getPayload().findByID()` or `fetch`) to
 * `FormDocument` without an unsafe `as` cast. Handles the small structural mismatches between
 * the auto-generated collection types and what `<Form>` expects:
 * - `fields` may be a typed blocks-union array or null; normalized to `FormFieldInstance[]`
 * - `flow` is stored as opaque JSON; typed as `FormFlow | undefined`
 * - `response` may be null; coerced to `undefined`
 * - `display` may be null; coerced to `undefined`
 *
 * Pure and framework-agnostic (no 'use client'): safe to call from a Server Component or any
 * other server-side code before handing the result to the client `<Form>`.
 */
export function toFormDocument(form: {
	id: number | string
	fields?: { blockType: string; name: string; [key: string]: unknown }[] | null
	flow?: unknown
	response?: {
		type?: string | null
		message?: unknown
		redirect?: { url?: string | null } | null
		submitLabel?: string | null
	} | null
	display?: {
		showTitle?: boolean | null
		title?: string | null
		intro?: unknown
	} | null
}): FormDocument {
	return {
		id: form.id,
		fields: (form.fields ?? []) as FormFieldInstance[],
		flow: form.flow as FormFlow | undefined,
		response: (form.response as FormResponseSettings | null | undefined) ?? undefined,
		display: (form.display as FormDisplaySettings | null | undefined) ?? undefined,
	}
}
