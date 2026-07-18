import type { FormFlow } from '../flow/types'
import type { FormFieldInstance } from '../submissions/types'

/** Serializable per-form response settings: what the visitor gets after a successful submit. */
export type FormResponseSettings = {
	type?: 'message' | 'redirect' | null
	/** Rich text state serialized via `serializeBody`; shown instead of the plain `successMessage`. */
	message?: unknown
	/** Applies on the custom-`children` path too (part of submit handling); `message` only affects default rendering. */
	redirect?: { url?: string | null } | null
}

/**
 * Serializable per-form button labels. `toFormDocument` reassembles these from the document's
 * top-level `submitLabel`/`prevLabel`/`nextLabel` fields (there is no longer a `buttons` group).
 * The index signature lets custom chrome read any extra label a host threads on itself.
 */
export type FormButtonSettings = {
	submitLabel?: string | null
	nextLabel?: string | null
	prevLabel?: string | null
	[key: string]: unknown
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
	/** Button labels (and any host-added button settings). Label precedence: `<Form>` prop, then this, then the translated default. */
	buttons?: FormButtonSettings
	/** The form's admin title (the collection's `useAsTitle` field). Render it, or not: the host decides. */
	title?: string
	/** Whether the form uses multi-step (flow) navigation. Drives client step rendering; flow data may still exist when false. */
	multistep: boolean
	/** Whether this form is a poll. Gates poll rendering and results; the poll config lives under `poll`. */
	pollEnabled: boolean
	poll?: FormPollSettings
}
