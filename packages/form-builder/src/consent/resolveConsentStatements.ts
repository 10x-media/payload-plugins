import type { Payload, PayloadRequest } from 'payload'
import { resolveConsentEntries } from './resolveConsentEntries'
import type { ConsentSourcesResolver } from './types'

/** What a consent field shows the visitor, resolved from its source at request time. */
export type ConsentStatement = {
	/** Rich text state (or whatever the host's resolver returned), for the request's locale. */
	statement?: unknown
	/** The policy link beside the statement, present only when the source carries both a `url` and a `label`. */
	link?: { label: string; url: string }
}

/** Resolved statements keyed by consent field name, as `toFormDocument`'s `consentStatements` takes them. */
export type ConsentStatements = Record<string, ConsentStatement>

export type ResolveConsentStatementsArgs = {
	payload: Payload
	req: PayloadRequest
	/** A loaded forms document; its consent fields' `source` ids drive resolution. The whole doc is forwarded to the resolver. */
	form: {
		id: number | string
		title?: string | null
		fields?: { blockType: string; name?: string; [key: string]: unknown }[] | null
	} & Record<string, unknown>
	/** Resolver override for plugin-internal callers; defaults to the one the plugin stashed on the config. */
	sources?: ConsentSourcesResolver
}

/**
 * Resolve every consent field's statement for this request, ready to hand to
 * `toFormDocument(doc, { consentStatements })`.
 *
 * The statement is a live reference, not a copy: a form stores only its source id, and the
 * sentence the visitor reads is resolved here, in their locale, from whatever the source says
 * right now. So correcting a policy sentence corrects every form referencing it, with nothing to
 * re-save, and a form rendered without this step shows no statement at all rather than a stale one.
 *
 * Call it server-side (a Server Component, a route handler) before rendering `<Form>`. Throws
 * whatever the host's resolver throws, so a page can decide between failing and rendering without
 * consent; a submit resolves the source again regardless, and the proof is built from that.
 */
export const resolveConsentStatements = async (
	args: ResolveConsentStatementsArgs
): Promise<ConsentStatements> => {
	const { payload, req, form, sources } = args
	const consentFields = (form.fields ?? []).filter(
		(field): field is { blockType: string; name: string; source?: unknown } =>
			field.blockType === 'consent' && typeof field.name === 'string' && field.name.length > 0
	)
	if (consentFields.length === 0) {
		return {}
	}
	const entries = await resolveConsentEntries({ payload, req, form, sources })
	const statements: ConsentStatements = {}
	for (const field of consentFields) {
		const entry = entries.find((candidate) => candidate.id === field.source)
		if (!entry) {
			continue
		}
		// The link needs a name of its own, so it takes the source's `name` and never falls back to
		// the `id`: the id is a machine identifier, and showing it as the words a visitor clicks is
		// worse than no link at all. A source with a url and no name simply has no link.
		const label = typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name : ''
		statements[field.name] = {
			...(entry.statement != null ? { statement: entry.statement } : {}),
			...(label && typeof entry.url === 'string' && entry.url.length > 0
				? { link: { label, url: entry.url } }
				: {}),
		}
	}
	return statements
}
