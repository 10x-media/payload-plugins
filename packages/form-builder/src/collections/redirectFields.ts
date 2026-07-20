import type { Field } from 'payload'

/**
 * Composes the fields inside the forms `response.redirect` group. Receives the default fields (the
 * `url` text field, plus the polymorphic `reference` relationship when `redirectRelationships` is
 * set) and returns the group's final field array verbatim, so a host can prepend a custom link
 * field, swap `url` for their own picker, reorder, or filter. Mirrors `buttons.fields` and
 * `poll.outcomeFields`.
 *
 * The plugin's built-in redirect handling reads `redirect.url` (and `redirect.reference` when
 * configured); `toFormDocument` passes the whole `response` group through, so a host that replaces
 * `url` with their own link field owns resolving it to a destination in their frontend, the same as
 * the internal-reference case.
 */
export type RedirectFieldsOverride = (args: { defaultFields: Field[] }) => Field[]

/** The forms `response.redirect` group options: its fields composition seam. */
export type RedirectOption = {
	fields?: RedirectFieldsOverride
}

/** The plugin `response` option: currently the `redirect` group's composition seam. */
export type ResponseOption = {
	redirect?: RedirectOption
}
