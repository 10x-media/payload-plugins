import type { ArrayField, CollectionSlug, Field, RichTextField } from 'payload'
import { localizedIf } from '../fields/localizedIf'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { validateConsentSourceKey } from './validateConsentSourceKey'

export type ConsentSourcesFieldOptions = {
	/** Field name, i.e. the key the row array is stored under. Defaults to `consentSources`. */
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
	 * Whether the visitor-facing `statement` and `label` carry `localized: true`. Default `true`;
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
 * A row is `key` (the stable reference a consent field stores, and the only part that must outlive
 * edits), a `label` naming the source (shown when picking it on a form, and used as the policy
 * link text beside the statement), the `statement` the visitor agrees to, and optionally the
 * `page` that statement belongs to. Authors fill in no version, no URL, and no document id by
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
		admin: { description: labelForKey(keys.consentSourcesFieldDescription) },
		fields: [
			{
				name: 'key',
				type: 'text',
				required: true,
				label: labelForKey(keys.consentSourceKey),
				admin: { description: labelForKey(keys.consentSourceKeyDescription) },
				validate: validateConsentSourceKey,
			},
			{
				name: 'label',
				type: 'text',
				label: labelForKey(keys.consentSourceLabel),
				admin: { description: labelForKey(keys.consentSourceLabelDescription) },
				...localizedIf(localize),
			},
			{
				name: 'statement',
				type: 'richText',
				label: labelForKey(keys.consentSourceStatement),
				admin: { description: labelForKey(keys.consentSourceStatementDescription) },
				...(options.editor ? { editor: options.editor } : {}),
				...localizedIf(localize),
			},
			...pageField,
		],
	}
}
