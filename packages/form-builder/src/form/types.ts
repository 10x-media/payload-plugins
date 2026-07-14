import type { FormFlow } from '../flow/types'
import type { FormFieldInstance } from '../submissions/types'

/** Serializable per-form response settings: what the visitor gets after a successful submit. */
export type FormResponseSettings = {
	type?: 'message' | 'redirect' | null
	/** Rich text state serialized via `serializeBody`; shown instead of the plain `successMessage`. */
	message?: unknown
	/** Applies on the custom-`children` path too (part of submit handling); `message`/`submitLabel` only affect default rendering. */
	redirect?: { url?: string | null } | null
	submitLabel?: string | null
}

/** Serializable per-form display settings: what the visitor sees above the fields, before submit. */
export type FormDisplaySettings = {
	showTitle?: boolean
	title?: string
	/** Rich text state serialized via `serializeBody`; rendered above the fields when non-empty. */
	intro?: unknown
}

/**
 * Serializable shape `<Form>` expects, and what `toFormDocument` narrows a Payload-generated
 * document to. Framework-agnostic (no React, no 'use client') so it can be constructed and
 * consumed on the server, e.g. in a Server Component before handing it to the client `<Form>`.
 */
export type FormDocument = {
	id: number | string
	fields: FormFieldInstance[]
	flow?: FormFlow
	response?: FormResponseSettings
	display?: FormDisplaySettings
}
