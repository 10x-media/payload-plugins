import type { CollectionConfig, Config, Field, OptionObject } from 'payload'
import { buildWikiEditor } from '../editor/wikiEditor'
import { buildOrphanedTargetsEndpoint } from '../endpoints/orphanedTargets'
import { buildTargetsMapEndpoint } from '../endpoints/targetsMap'
import type { HiddenOption, WikiAccessOptions } from '../options'
import type { ResolvedWikiOptions } from '../plugin/resolveOptions'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { slugBeforeValidate } from './slug'

/** Hover cards clamp visually as well; this is the authoring-time guardrail. */
export const SUMMARY_MAX_LENGTH = 400

/** Spreadable `{ localized: true }` only when the host config has localization. */
const localizedIf = (localize: boolean): { localized: true } | Record<string, never> =>
	localize ? { localized: true } : {}

const entityOptions = (
	entities: Array<{ labels?: unknown; label?: unknown; slug: string }>,
	exclude: string[]
): OptionObject[] =>
	entities
		.filter((entity) => !exclude.includes(entity.slug))
		.map((entity) => {
			const labels = entity.labels as { singular?: unknown } | undefined
			const label =
				typeof labels?.singular === 'string'
					? labels.singular
					: typeof entity.label === 'string'
						? entity.label
						: entity.slug
			return { label, value: entity.slug }
		})

const ORPHAN_BANNER = { path: '@10x-media/admin-wiki/client#WikiOrphanBanner' }
const FEATURED_LIST = { path: '@10x-media/admin-wiki/client#WikiFeaturedList' }

/**
 * The list-view slot components, with the featured section placed at the
 * configured slot. The orphan banner always sits in `beforeListTable`, directly
 * above the table it explains, so the two can land in the same slot.
 */
const listSlotComponents = (
	resolved: ResolvedWikiOptions
): Record<string, Array<{ path: string }>> => {
	const slots: Record<string, Array<{ path: string }>> = {
		beforeListTable: [ORPHAN_BANNER],
	}
	if (resolved.featured !== false) {
		const { slot } = resolved.featured
		slots[slot] = slot === 'beforeListTable' ? [FEATURED_LIST, ORPHAN_BANNER] : [FEATURED_LIST]
	}
	return slots
}

export type BuildWikiPagesArgs = {
	access: Required<WikiAccessOptions>
	/** The host config as it stands when the plugin runs, for target enumeration. */
	config: Config
	hidden: HiddenOption | undefined
	resolved: ResolvedWikiOptions
}

/**
 * The guide pages collection: drafts enabled; localized title, summary, and
 * content; featured flag with ordering; and a non-localized `targets` array
 * attaching one guide to any number of surfaces (collections, globals, field
 * schema paths, block slugs).
 */
export const buildWikiPagesCollection = ({
	access,
	config,
	hidden,
	resolved,
}: BuildWikiPagesArgs): CollectionConfig => {
	const localize = Boolean(config.localization)
	const wikiSlugs = [resolved.slugs.pages, resolved.slugs.media]
	const collectionOptions = entityOptions(config.collections ?? [], wikiSlugs)
	const globalOptions = entityOptions(config.globals ?? [], [])

	const targetFields: Field[] = [
		{
			name: 'type',
			type: 'select',
			label: labelForKey(keys.targetTypeLabel),
			options: [
				{ label: labelForKey(keys.targetTypeCollection), value: 'collection' },
				{ label: labelForKey(keys.targetTypeGlobal), value: 'global' },
				{ label: labelForKey(keys.targetTypeField), value: 'field' },
				{ label: labelForKey(keys.targetTypeBlock), value: 'block' },
			],
			required: true,
			defaultValue: 'collection',
		},
		{
			name: 'collectionSlug',
			type: 'select',
			label: labelForKey(keys.targetCollectionLabel),
			options: collectionOptions,
			admin: { condition: (_data, siblingData) => siblingData?.type === 'collection' },
		},
		{
			name: 'globalSlug',
			type: 'select',
			label: labelForKey(keys.targetGlobalLabel),
			options: globalOptions,
			admin: { condition: (_data, siblingData) => siblingData?.type === 'global' },
		},
		{
			name: 'fieldPath',
			type: 'text',
			label: labelForKey(keys.targetFieldPathLabel),
			admin: {
				condition: (_data, siblingData) => siblingData?.type === 'field',
				description: labelForKey(keys.targetFieldPathDescription),
			},
		},
		{
			name: 'blockSlug',
			type: 'text',
			label: labelForKey(keys.targetBlockSlugLabel),
			admin: { condition: (_data, siblingData) => siblingData?.type === 'block' },
		},
	]

	return {
		slug: resolved.slugs.pages,
		labels: {
			singular: labelForKey(keys.collectionPagesSingular),
			plural: labelForKey(keys.collectionPagesPlural),
		},
		access,
		endpoints: [
			buildTargetsMapEndpoint({
				access,
				localeMap: resolved.localeMap,
				pagesSlug: resolved.slugs.pages,
			}),
			buildOrphanedTargetsEndpoint({ access, pagesSlug: resolved.slugs.pages }),
		],
		versions: { drafts: true },
		admin: {
			defaultColumns: ['title', 'slug', 'featured', 'updatedAt'],
			useAsTitle: 'title',
			...(hidden !== undefined ? { hidden } : {}),
			components: {
				...listSlotComponents(resolved),
				...(resolved.wikiView
					? {
							views: {
								list: {
									actions: [{ path: '@10x-media/admin-wiki/client#WikiViewLink' }],
								},
							},
						}
					: {}),
			},
		},
		fields: [
			{
				name: 'title',
				type: 'text',
				label: labelForKey(keys.fieldTitleLabel),
				required: true,
				...localizedIf(localize),
			},
			{
				name: 'slug',
				type: 'text',
				label: labelForKey(keys.fieldSlugLabel),
				unique: true,
				index: true,
				hooks: { beforeValidate: [slugBeforeValidate] },
				admin: {
					description: labelForKey(keys.fieldSlugDescription),
					position: 'sidebar',
				},
			},
			{
				name: 'summary',
				type: 'textarea',
				label: labelForKey(keys.fieldSummaryLabel),
				maxLength: SUMMARY_MAX_LENGTH,
				...localizedIf(localize),
				admin: { description: labelForKey(keys.fieldSummaryDescription) },
			},
			{
				name: 'content',
				type: 'richText',
				label: labelForKey(keys.fieldContentLabel),
				editor: buildWikiEditor({
					blocks: resolved.editorBlocks.map((option) => option.block),
					mediaSlug: resolved.slugs.media,
					pagesSlug: resolved.slugs.pages,
					video: resolved.video,
				}),
				...localizedIf(localize),
			},
			{
				name: 'featured',
				type: 'checkbox',
				label: labelForKey(keys.fieldFeaturedLabel),
				defaultValue: false,
				admin: {
					description: labelForKey(keys.fieldFeaturedDescription),
					position: 'sidebar',
				},
			},
			{
				name: 'featuredOrder',
				type: 'number',
				label: labelForKey(keys.fieldFeaturedOrderLabel),
				admin: {
					condition: (data) => Boolean(data?.featured),
					description: labelForKey(keys.fieldFeaturedOrderDescription),
					position: 'sidebar',
				},
			},
			{
				name: 'targets',
				type: 'array',
				label: labelForKey(keys.fieldTargetsLabel),
				labels: {
					singular: labelForKey(keys.targetRowSingular),
					plural: labelForKey(keys.targetRowPlural),
				},
				fields: targetFields,
				admin: { description: labelForKey(keys.fieldTargetsDescription) },
			},
		],
	}
}
