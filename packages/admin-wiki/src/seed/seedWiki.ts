import { convertMarkdownToLexical, editorConfigFactory } from '@payloadcms/richtext-lexical'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import type { CollectionSlug, Payload } from 'payload'

import { buildWikiEditor } from '../editor/wikiEditor'
import { getWikiRegistry } from '../plugin/registry'
import { asLocale } from '../shared/resolveLocale'
import { splitLocalized } from './localized'
import { ensureSeedMedia } from './media'
import { githubAlertsTransformer } from './transformers/githubAlerts'
import { guideLinksTransformer } from './transformers/guideLinks'
import { mediaPlaceholdersTransformer } from './transformers/mediaPlaceholders'
import type {
	WikiSeedContent,
	WikiSeedContext,
	WikiSeedGuideDef,
	WikiSeedOptions,
	WikiSeedResult,
	WikiSeedTargets,
	WikiSeedTransformer,
} from './types'

/**
 * Map the seed's grouped targets onto the four stored lists. Always writes all
 * four, so a guide that drops a target on re-run has it cleared rather than
 * left behind.
 */
const targetData = (targets: WikiSeedTargets | undefined) => ({
	targetBlocks: targets?.blocks ?? [],
	targetCollections: targets?.collections ?? [],
	targetFields: targets?.fields ?? [],
	targetGlobals: targets?.globals ?? [],
})

type SanitizedEditorConfig = Awaited<ReturnType<typeof editorConfigFactory.fromEditor>>

type SeedRuntime = {
	context: WikiSeedContext
	editorConfig: SanitizedEditorConfig
	transformers: WikiSeedTransformer[]
}

const resolveContent = (
	content: WikiSeedContent,
	runtime: SeedRuntime,
	label: string
): SerializedEditorState => {
	let state: SerializedEditorState
	if ('markdown' in content) {
		state = convertMarkdownToLexical({
			editorConfig: runtime.editorConfig,
			markdown: content.markdown,
		}) as unknown as SerializedEditorState
	} else if ('lexical' in content) {
		state = structuredClone(content.lexical)
	} else {
		throw new Error(`@10x-media/admin-wiki seed: "${label}" has neither markdown nor lexical`)
	}
	for (const transformer of runtime.transformers) {
		state = transformer(state, runtime.context)
	}
	return state
}

/**
 * Declarative, idempotent wiki seeding: guides are keyed by slug (re-running
 * updates instead of duplicating), media by file path or URL is uploaded into
 * the wiki media collection, markdown converts through the wiki editor and a
 * transformer pipeline (GitHub alerts to callouts, media placeholders to
 * upload and video nodes, then any consumer transformers). Failures throw with
 * the offending guide or media key in the message; nothing is silently
 * skipped.
 */
export const seedWiki = async (
	payload: Payload,
	guides: WikiSeedGuideDef[],
	options: WikiSeedOptions = {}
): Promise<WikiSeedResult> => {
	const registry = getWikiRegistry(payload.config)
	if (!registry) {
		throw new Error('@10x-media/admin-wiki seed: the adminWiki plugin is not registered')
	}
	const { pages: pagesSlug, media: mediaSlug } = registry.slugs
	const localization = payload.config.localization
	const defaultLocale = localization ? localization.defaultLocale : undefined

	const editorConfig = await editorConfigFactory.fromEditor({
		config: payload.config,
		editor: buildWikiEditor({
			blocks: registry.editorBlocks.map((option) => option.block),
			mediaSlug,
			pagesSlug,
			video: registry.video,
		}),
	})

	const media = await ensureSeedMedia({
		defaultLocale,
		defs: options.media ?? [],
		mediaSlug,
		payload,
	})

	const runtime: SeedRuntime = {
		context: { guideIdsBySlug: {}, media },
		editorConfig,
		transformers: [
			githubAlertsTransformer,
			guideLinksTransformer,
			mediaPlaceholdersTransformer,
			...(options.transformers ?? []),
		],
	}

	const actions: Record<string, 'created' | 'updated'> = {}
	for (const def of guides) {
		try {
			const existing = await payload.find({
				collection: pagesSlug as CollectionSlug,
				depth: 0,
				draft: true,
				limit: 1,
				pagination: false,
				where: { slug: { equals: def.slug } },
			})
			if (existing.docs[0]) {
				runtime.context.guideIdsBySlug[def.slug] = existing.docs[0].id as number | string
				actions[def.slug] = 'updated'
			} else {
				const title = splitLocalized(def.title, defaultLocale, `${def.slug}.title`)
				const created = await payload.create({
					collection: pagesSlug as CollectionSlug,
					// `draft: true` is what sets `_status`; the collection always has
					// drafts enabled, so passing it here as well is redundant. The data
					// is asserted because a host that generated its types narrows draft
					// data to the fields every collection shares, and the slug this
					// writes to is only known at runtime.
					data: { slug: def.slug, title: title.base ?? def.slug } as never,
					draft: true,
				})
				runtime.context.guideIdsBySlug[def.slug] = created.id as number | string
				actions[def.slug] = 'created'
			}
		} catch (error) {
			throw new Error(`@10x-media/admin-wiki seed: guide "${def.slug}" failed`, {
				cause: error,
			})
		}
	}

	const results: WikiSeedResult['guides'] = []
	for (const def of guides) {
		try {
			const title = splitLocalized(def.title, defaultLocale, `${def.slug}.title`)
			const summary = splitLocalized(def.summary, defaultLocale, `${def.slug}.summary`)
			const content = splitLocalized(def.content, defaultLocale, `${def.slug}.content`)
			const status = def.publish === false ? 'draft' : 'published'
			const baseData = {
				_status: status,
				featured: def.featured ?? false,
				// Written even when absent, because this pass updates existing guides:
				// omitting the key would leave a previously seeded order in place and
				// make the seed definition no longer describe the result.
				featuredOrder: def.featuredOrder ?? null,
				slug: def.slug,
				...targetData(def.targets),
				...(title.base !== undefined ? { title: title.base } : {}),
				...(summary.base !== undefined ? { summary: summary.base } : {}),
				...(content.base !== undefined
					? { content: resolveContent(content.base, runtime, `${def.slug}.content`) }
					: {}),
			}
			const id = runtime.context.guideIdsBySlug[def.slug]
			if (id === undefined) {
				throw new Error('guide id missing after the ensure pass')
			}
			const action = actions[def.slug] ?? 'updated'
			await payload.update({
				collection: pagesSlug as CollectionSlug,
				data: baseData,
				draft: false,
				id,
			})
			const locales = new Set([
				...Object.keys(title.rest),
				...Object.keys(summary.rest),
				...Object.keys(content.rest),
			])
			for (const locale of locales) {
				const localeContent = content.rest[locale]
				await payload.update({
					collection: pagesSlug as CollectionSlug,
					data: {
						_status: status,
						...(title.rest[locale] !== undefined ? { title: title.rest[locale] } : {}),
						...(summary.rest[locale] !== undefined ? { summary: summary.rest[locale] } : {}),
						...(localeContent !== undefined
							? {
									content: resolveContent(localeContent, runtime, `${def.slug}.content.${locale}`),
								}
							: {}),
					},
					draft: false,
					id,
					locale: asLocale(locale),
				})
			}
			results.push({ action, id, slug: def.slug })
		} catch (error) {
			throw new Error(`@10x-media/admin-wiki seed: guide "${def.slug}" failed`, {
				cause: error,
			})
		}
	}
	return { guides: results, media }
}
