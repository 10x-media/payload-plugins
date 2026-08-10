import type { CollectionConfig, Config, Field } from 'payload'
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

/**
 * The orphan banner sits in `beforeListTable`, directly above the table it
 * explains. The guides band is not here: it belongs on the collections guides
 * are written about, and `registerTriggers` puts it there.
 */
const ORPHAN_BANNER = { path: '@10x-media/admin-wiki/client#WikiOrphanBanner' }

export type BuildWikiPagesArgs = {
	access: Required<WikiAccessOptions>
	/** The host config as it stands when the plugin runs, for target enumeration. */
	config: Config
	hidden: HiddenOption | undefined
	resolved: ResolvedWikiOptions
}

const TARGET_SELECT = '@10x-media/admin-wiki/client#WikiTargetSelect'

/** Slugs of one entity kind the plugin covers, sorted for a stable picker. */
const coveredSlugs = (entities: undefined | { slug: string }[], excluded: string[]): string[] => {
	const skip = new Set(excluded)
	return (entities ?? [])
		.map((entity) => entity.slug)
		.filter((slug) => !skip.has(slug))
		.sort()
}

/**
 * One `string[]` field per target kind. Values are stored raw, with no `select`
 * options, so a target survives its surface leaving the config: the orphan
 * endpoint reports it and the authoring UI still shows it, where a real `select`
 * would have dropped an unrecognized value on save.
 *
 * Collections and globals are picked from what the plugin covers, so a guide
 * cannot be attached to an entity the host excluded. Fields and blocks stay
 * free-text; their affordances fill them in.
 */
const targetFields = (config: Config, resolved: ResolvedWikiOptions): Field[] => [
	{
		name: 'targetCollections',
		type: 'text',
		hasMany: true,
		label: labelForKey(keys.targetCollectionsLabel),
		admin: {
			components: {
				Field: {
					clientProps: {
						entity: 'collection',
						slugs: coveredSlugs(config.collections, resolved.exclude.collections),
					},
					path: TARGET_SELECT,
				},
			},
			description: labelForKey(keys.targetCollectionsDescription),
		},
	},
	{
		name: 'targetGlobals',
		type: 'text',
		hasMany: true,
		label: labelForKey(keys.targetGlobalsLabel),
		admin: {
			components: {
				Field: {
					clientProps: {
						entity: 'global',
						slugs: coveredSlugs(config.globals, resolved.exclude.globals),
					},
					path: TARGET_SELECT,
				},
			},
			description: labelForKey(keys.targetGlobalsDescription),
		},
	},
	{
		name: 'targetFields',
		type: 'text',
		hasMany: true,
		label: labelForKey(keys.targetFieldsLabel),
		admin: { description: labelForKey(keys.targetFieldsDescription) },
	},
	{
		name: 'targetBlocks',
		type: 'text',
		hasMany: true,
		label: labelForKey(keys.targetBlocksLabel),
		admin: { description: labelForKey(keys.targetBlocksDescription) },
	},
]

/**
 * The guide pages collection: drafts enabled; localized title, summary, and
 * content; featured flag with ordering; and four non-localized target lists
 * attaching one guide to any number of surfaces (collections, globals, field
 * schema paths, block slugs).
 *
 * Authoring splits across unnamed tabs, which group the form without adding a
 * level to the stored document: a named tab would nest every target list under
 * its own key and break every reader of `targetCollections` and friends. The
 * sidebar fields stay outside the tabs, where Payload looks for them.
 */
export const buildWikiPagesCollection = ({
	access,
	config,
	hidden,
	resolved,
}: BuildWikiPagesArgs): CollectionConfig => {
	const localize = Boolean(config.localization)

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
				beforeListTable: [ORPHAN_BANNER],
				...(resolved.wikiView
					? {
							edit: {
								beforeDocumentControls: [
									{ path: '@10x-media/admin-wiki/client#WikiGuideViewLink' },
								],
							},
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
				type: 'tabs',
				tabs: [
					{
						label: labelForKey(keys.tabGuideLabel),
						fields: [
							{
								name: 'title',
								type: 'text',
								label: labelForKey(keys.fieldTitleLabel),
								required: true,
								...localizedIf(localize),
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
						],
					},
					{
						label: labelForKey(keys.tabTargetsLabel),
						fields: targetFields(config, resolved),
					},
				],
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
		],
	}
}
