import type { FormFlow } from '../flow/types'
import { applyPollOptions } from '../poll/applyPollOptions'
import type { PollOption } from '../poll/definePollOptionSource'
import type { FormFieldInstance } from '../submissions/types'
import type { FormDocument, FormResponseSettings } from './types'

export type ToFormDocumentOptions = {
	/**
	 * Source-resolved poll options (from `resolvePollOptions`), injected as the options of the
	 * field instance named by the form's `poll.resultsField` so the client renders the host's
	 * current choices instead of hand-authored ones.
	 */
	pollOptions?: PollOption[]
}

/**
 * Narrows a Payload-generated form document (from `getPayload().findByID()` or `fetch`) to
 * `FormDocument` without an unsafe `as` cast. Handles the small structural mismatches between
 * the auto-generated collection types and what `<Form>` expects:
 * - `fields` may be a typed blocks-union array or null; normalized to `FormFieldInstance[]`
 *   (nameless bare rows, e.g. message blocks, pass through with their row `id` intact)
 * - `flow` is stored as opaque JSON; typed as `FormFlow | undefined`
 * - `response` may be null; coerced to `undefined`
 * - `title` may be null; coerced to `undefined`
 * - `poll` may be null; coerced to `undefined` (`resultsField`, `optionSource`, and
 *   `sourceConfig` are dropped: server-side only; `outcome` passes through `winningValue` only)
 *
 * Pure and framework-agnostic (no 'use client'): safe to call from a Server Component or any
 * other server-side code before handing the result to the client `<Form>`.
 */
export function toFormDocument(
	form: {
		id: number | string
		fields?: { blockType: string; name?: string; [key: string]: unknown }[] | null
		flow?: unknown
		response?: {
			type?: string | null
			message?: unknown
			redirect?: { url?: string | null } | null
			submitLabel?: string | null
		} | null
		title?: string | null
		poll?: {
			enabled?: boolean | null
			resultsField?: string | null
			resultsVisibility?: string | null
			closesAt?: string | null
			outcome?: { winningValue?: string | null } | null
		} | null
	},
	options?: ToFormDocumentOptions
): FormDocument {
	const winningValue = form.poll?.outcome?.winningValue
	const poll = form.poll
		? {
				enabled: form.poll.enabled ?? undefined,
				resultsVisibility: (form.poll.resultsVisibility ?? undefined) as
					| 'afterVote'
					| 'afterClose'
					| undefined,
				closesAt: form.poll.closesAt ?? undefined,
				...(typeof winningValue === 'string' && winningValue.length > 0
					? { outcome: { winningValue } }
					: {}),
			}
		: undefined
	let fields = (form.fields ?? []) as FormFieldInstance[]
	if (options?.pollOptions) {
		fields = applyPollOptions(fields, form.poll?.resultsField, options.pollOptions)
	}
	return {
		id: form.id,
		fields,
		flow: form.flow as FormFlow | undefined,
		response: (form.response as FormResponseSettings | null | undefined) ?? undefined,
		title: form.title ?? undefined,
		poll,
	}
}
