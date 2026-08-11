import type { CalcResolved } from '../calc/evaluate'
import { applyConsentStatements } from '../consent/applyConsentStatements'
import type { ConsentStatements } from '../consent/resolveConsentStatements'
import type { FormFlow } from '../flow/types'
import { applyPollOptions } from '../poll/applyPollOptions'
import type { PollOption } from '../poll/definePollOptionSource'
import type { FormFieldInstance } from '../submissions/types'
import type { FormButtonSettings, FormDocument, FormResponseSettings } from './types'

export type ToFormDocumentOptions = {
	/**
	 * Source-resolved poll options (from `resolvePollOptions`), injected as the options of the
	 * field instance named by the form's `poll.resultsField` so the client renders the host's
	 * current choices instead of hand-authored ones.
	 */
	pollOptions?: PollOption[]
	/**
	 * Source-resolved consent statements (from `resolveConsentStatements`), injected into the
	 * consent field instances they name. A form stores only a source id, so without these its
	 * consent fields render with no statement at all.
	 */
	consentStatements?: ConsentStatements
	/**
	 * Resolve an internal redirect `reference` to a same-site URL. Called only when
	 * `response.type === 'redirect'`, a `reference` is present, and no `redirect.url` is set. Keep it
	 * sync: operate on the already-loaded (populated) reference, since resolving a Doc to a URL is host
	 * routing knowledge the plugin cannot supply. The result is written to `redirect.url`, so `<Form>`
	 * navigates with no client change.
	 */
	resolveRedirect?: (reference: {
		relationTo: string
		value: number | string | object
	}) => string | null | undefined
}

/**
 * Reassemble the client button labels from the document's top-level `submitLabel`/`prevLabel`/
 * `nextLabel` fields, keeping only non-empty strings (mirroring the client's own `storedLabel`
 * fallback). Returns `undefined` when the author set no label, so the client uses its defaults.
 */
const buttonSettingsOf = (form: {
	submitLabel?: string | null
	prevLabel?: string | null
	nextLabel?: string | null
}): FormButtonSettings | undefined => {
	const label = (value: unknown): string | undefined =>
		typeof value === 'string' && value.length > 0 ? value : undefined
	const settings: FormButtonSettings = {}
	const submitLabel = label(form.submitLabel)
	const prevLabel = label(form.prevLabel)
	const nextLabel = label(form.nextLabel)
	if (submitLabel !== undefined) settings.submitLabel = submitLabel
	if (prevLabel !== undefined) settings.prevLabel = prevLabel
	if (nextLabel !== undefined) settings.nextLabel = nextLabel
	return Object.keys(settings).length > 0 ? settings : undefined
}

/**
 * Narrows a Payload-generated form document (from `getPayload().findByID()` or `fetch`) to
 * `FormDocument` without an unsafe `as` cast. Handles the small structural mismatches between
 * the auto-generated collection types and what `<Form>` expects:
 * - `fields` may be a typed blocks-union array or null; normalized to `FormFieldInstance[]`
 *   (nameless bare rows, e.g. message blocks, pass through with their row `id` intact)
 * - `flow` is stored as opaque JSON; typed as `FormFlow | undefined`
 * - `response` may be null; coerced to `undefined`, otherwise passed through wholesale, which
 *   includes `response.redirect.reference` (present only when the plugin's `redirectRelationships`
 *   option is set): `value` may be a bare id (`depth: 0`) or a populated document, and the host
 *   resolves it to a URL either by writing `redirect.url` or by passing `options.resolveRedirect`
 * - the button labels (`submitLabel`/`prevLabel`/`nextLabel`) live at the document root now (there
 *   is no `buttons` group); the non-empty ones are reassembled into `FormDocument.buttons`
 * - `title` may be null; coerced to `undefined`
 * - `multistep`/`pollEnabled` are the two top-level form-type flags, coerced to strict booleans
 * - `poll` may be null; coerced to `undefined` (`resultsField`, `optionSource`, and
 *   `sourceConfig` are dropped: server-side only; `outcome` passes through `winningValues` only)
 *
 * Unknown keys survive on `response` but not on `poll`, which is deliberate rather than incidental.
 * `response` is a visitor-facing group a host is meant to extend (`overrides.forms.fields`) and read
 * back off `FormDocument` in custom chrome, so it is cast wholesale. `poll` is plugin-owned config
 * that is split between
 * client-safe lifecycle state and server-only members, so it is rebuilt from an allowlist: a
 * passthrough would ship whatever a host put in `sourceConfig` (domain config, ids, credentials)
 * to every anonymous visitor. Adding a client-visible poll member means naming it here.
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
			redirect?: {
				url?: string | null
				reference?: { relationTo?: string | null; value?: number | string | object | null } | null
			} | null
		} | null
		submitLabel?: string | null
		prevLabel?: string | null
		nextLabel?: string | null
		title?: string | null
		multistep?: boolean | null
		pollEnabled?: boolean | null
		poll?: {
			resultsField?: string | null
			resultsVisibility?: string | null
			closesAt?: string | null
			allowChange?: boolean | null
			outcome?: { winningValues?: (string | null)[] | null } | null
		} | null
		/**
		 * Consent statements resolved onto the doc by the plugin's forms `afterRead` hook (when
		 * `consent.sources` is set), so consent renders on any fetch path (modal/client, not just RSC).
		 * An explicit `options.consentStatements` takes precedence when both are present.
		 */
		consentStatements?: ConsentStatements
		/**
		 * Calc source values resolved onto the doc by the plugin's forms `afterRead` hook (when calc
		 * sources are registered and used); passed through so the client's live preview computes with
		 * real values. `functions` can never ride a document, hence the Pick.
		 */
		calcResolved?: Pick<CalcResolved, 'sources' | 'weights'>
	},
	options?: ToFormDocumentOptions
): FormDocument {
	const rawWinningValues = form.poll?.outcome?.winningValues
	const winningValues = Array.isArray(rawWinningValues)
		? rawWinningValues.filter(
				(value): value is string => typeof value === 'string' && value.length > 0
			)
		: []
	const poll = form.poll
		? {
				resultsVisibility: (form.poll.resultsVisibility ?? undefined) as
					| 'afterVote'
					| 'afterClose'
					| undefined,
				closesAt: form.poll.closesAt ?? undefined,
				...(form.poll.allowChange === true ? { allowChange: true } : {}),
				...(winningValues.length > 0 ? { outcome: { winningValues } } : {}),
			}
		: undefined
	let fields = (form.fields ?? []) as FormFieldInstance[]
	if (options?.pollOptions) {
		fields = applyPollOptions(fields, form.poll?.resultsField, options.pollOptions)
	}
	const consentStatements = options?.consentStatements ?? form.consentStatements
	if (consentStatements) {
		fields = applyConsentStatements(fields, consentStatements)
	}
	let response = (form.response as FormResponseSettings | null | undefined) ?? undefined
	// A host that passes `resolveRedirect` gets internal references turned into `redirect.url` (all
	// `<Form>` navigates by), but only when the author set no explicit url. Non-mutating: clone the group.
	if (
		options?.resolveRedirect &&
		response?.type === 'redirect' &&
		response.redirect?.reference &&
		!response.redirect.url
	) {
		const url = options.resolveRedirect(response.redirect.reference)
		if (url) {
			response = { ...response, redirect: { ...response.redirect, url } }
		}
	}
	return {
		id: form.id,
		fields,
		flow: form.flow as FormFlow | undefined,
		response,
		buttons: buttonSettingsOf(form),
		title: form.title ?? undefined,
		multistep: form.multistep === true,
		pollEnabled: form.pollEnabled === true,
		poll,
		calcResolved: form.calcResolved,
	}
}
