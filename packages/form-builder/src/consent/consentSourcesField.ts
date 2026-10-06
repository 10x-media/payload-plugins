import type { ArrayField, CollectionSlug, Field, RichTextField } from 'payload'
import { localizedIf } from '../fields/localizedIf'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

export type ConsentSourcesFieldOptions = {
	/** Field name, i.e. what the row array is stored under. Defaults to `consentSources`. */
	name?: string
	/** Field label. Defaults to the plugin's translated one. */
	label?: ArrayField['label']
	/**
	 * Collections whose documents can be picked as a source's policy page. Omitted (the default):
	 * no page picker at all, so sources are statement-only and their proofs carry no page or
	 * version reference. Always stored polymorphically, even for a single slug (see below).
	 */
	relationTo?: CollectionSlug | CollectionSlug[]
	/**
	 * Whether the visitor-facing `statement` and `name` carry `localized: true`. Default `true`;
	 * Payload strips the flag on hosts without `localization`, so it is safe either way. Mirrors
	 * the plugin's `localizeContent` option, which this host-called factory cannot see.
	 */
	localized?: boolean
	/** Overrides the project's default richText editor for the `statement`, as `richText.editor` does plugin-side. */
	editor?: RichTextField['editor']
}

/**
 * The consent sources array, for the host to place on any collection or global they own: a
 * settings global, a tenants collection, a legal-pages parent, wherever the sources belong. The
 * plugin never registers it and never guesses where it lives; a matching `consent.sources` resolver
 * reads it back (see {@link ConsentSourcesResolver}), which is also where multi-tenant scoping goes:
 * place this on the tenant-scoped document and have the resolver return only the sources of the
 * tenant it derives from `req`.
 *
 * A row is a `name` (shown when picking the source on a form, and used as the policy link text
 * beside the statement), the `statement` the visitor agrees to, and optionally the `page` that
 * statement belongs to. The stable reference a consent field stores, and the only part that must
 * outlive edits, is the row's own auto-assigned `id`: it survives a `name` edit or reordering,
 * unlike a hand-authored key would. Authors fill in no version, no URL, and no document id by
 * hand: the version is detected and recorded at submit time, and the page is a picker.
 *
 * `page` is always polymorphic, even when `relationTo` names a single collection, because a
 * monomorphic relationship stores a bare id: the proof needs the collection alongside it to stay
 * resolvable, and a host adding a second collection later would otherwise change the stored shape.
 *
 * ```ts
 * // The host's own collection or global:
 * fields: [consentSourcesField({ relationTo: ['pages', 'legal-notices'] })]
 *
 * // The plugin, reading it back:
 * formBuilder({
 *   consent: {
 *     sources: async ({ req }) => {
 *       const settings = await req.payload.findGlobal({ slug: 'settings', depth: 0, locale: req.locale, req })
 *       return (settings.consentSources ?? []).map((row) => ({ ... }))
 *     },
 *   },
 * })
 * ```
 *
 * The resolver receives the whole form document, so derive tenant scoping from a field on it rather
 * than reading the form back: reading the `forms` collection from the resolver re-enters this form's
 * afterRead hook (the plugin guards against the resulting recursion, but the read is still wasted).
 *
 * A resolver reading its settings document must not thread the save's `req` into a `locale: 'all'`
 * read from within a form's save validation: that flips `req.locale` to `all` and corrupts the
 * localized write of the document being saved. It reads already-committed data, so no `req` is needed.
 */
export const consentSourcesField = (options: ConsentSourcesFieldOptions = {}): ArrayField => {
	const localize = options.localized !== false
	// An empty `relationTo` array is treated as "no page picker", not a relationship field pointing
	// at nothing (which Payload rejects at boot).
	const relationTo =
		options.relationTo && (!Array.isArray(options.relationTo) || options.relationTo.length > 0)
			? options.relationTo
			: undefined
	const pageField: Field[] = relationTo
		? [
				{
					name: 'page',
					type: 'relationship',
					relationTo: Array.isArray(relationTo) ? relationTo : [relationTo],
					label: labelForKey(keys.consentSourcePage),
					admin: { description: labelForKey(keys.consentSourcePageDescription) },
				},
			]
		: []

	return {
		name: options.name ?? 'consentSources',
		type: 'array',
		label: options.label ?? labelForKey(keys.consentSourcesField),
		labels: {
			singular: labelForKey(keys.consentSourceSingular),
			plural: labelForKey(keys.consentSourcePlural),
		},
		admin: {
			description: labelForKey(keys.consentSourcesFieldDescription),
			components: { RowLabel: '@10x-media/form-builder/client#ConsentSourceRowLabel' },
		},
		fields: [
			{
				name: 'name',
				type: 'text',
				label: labelForKey(keys.consentSourceLabel),
				...localizedIf(localize),
			},
			{
				name: 'statement',
				type: 'richText',
				label: labelForKey(keys.consentSourceStatement),
				...(options.editor ? { editor: options.editor } : {}),
				...localizedIf(localize),
			},
			{
				name: 'noticeStatement',
				type: 'richText',
				label: labelForKey(keys.consentSourceNoticeStatement),
				admin: { description: labelForKey(keys.consentSourceNoticeStatementDescription) },
				...(options.editor ? { editor: options.editor } : {}),
				...localizedIf(localize),
			},
			...pageField,
		],
	}
}
