import type { PayloadRequest } from 'payload'

/** A document reference, kept id-based so renaming or re-slugging the page never breaks it. */
export type ConsentSourcePage = {
	relationTo: string
	id: number | string
}

/**
 * One consent source a form author can reference by `id`: the statement the visitor agrees to, and
 * optionally the policy document that statement belongs to. Produced by the host's
 * {@link ConsentSourcesResolver}, normally by mapping the rows of a placed `consentSourcesField()`.
 *
 * `id` is the array row's own auto-assigned identifier, so it survives name edits and reordering
 * and is the stable reference stored on the consent field and in every proof. `statement` is rich
 * text state (the visitor-facing sentence), already resolved for the request's locale by virtue of
 * the resolver reading its own localized field under `req.locale`. `page` drives proof: an id and
 * its collection, never a URL, so the document can be renamed, re-slugged, or re-routed without
 * stranding past proofs. `url` is the visitor-facing link the renderer shows beside the statement;
 * only the host knows how a document id maps to a public route, so the plugin never derives one.
 */
export type ConsentSourceEntry = {
	id: string
	name?: string
	statement?: unknown
	page?: ConsentSourcePage
	url?: string
}

/**
 * Host seam resolving the consent sources a form's authors can reference (plugin option
 * `consent.sources`). Without it there are no sources, so the `consent` field type is not
 * registered at all.
 *
 * The intended shape: place `consentSourcesField()` on a collection or global you own, then read it
 * back here. Multi-tenant hosts scope the read by the tenant derived from `req` (host header,
 * cookie, or auth context) and return only that tenant's sources, so one tenant's statements are
 * never selectable, resolvable, or provable under another's. Read under `req.locale` so the
 * statement the visitor agrees to is the one they were shown.
 */
export type ConsentSourcesResolver = (args: {
	req: PayloadRequest
	form: { id: number | string; title?: string }
}) => ConsentSourceEntry[] | Promise<ConsentSourceEntry[]>
