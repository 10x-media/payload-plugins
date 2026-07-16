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

/**
 * Serializable per-form poll settings the client needs for lifecycle rendering (open/voted/closed).
 * `resultsField` intentionally stays server-side: the results endpoint resolves the public field
 * itself, so the client never needs it from the document.
 */
export type FormPollSettings = {
	enabled?: boolean
	/** When anonymous callers may read aggregate results. Default 'afterVote'. */
	resultsVisibility?: 'afterVote' | 'afterClose' | null
	/** ISO date after which submissions are rejected and the poll renders as closed. */
	closesAt?: string | null
	/** Present once the host recorded a final outcome via `resolvePollOutcome`; `<Poll>` renders the final state. */
	outcome?: { winningValue?: string }
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
	/** The form's admin title (the collection's `useAsTitle` field). Render it, or not: the host decides. */
	title?: string
	poll?: FormPollSettings
}
