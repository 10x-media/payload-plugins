import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Payload } from 'payload'
import { seedWiki } from '../../src/index'
import { devTipTransformer, embedTransformer } from './seedTransformers'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const publishingGuideEn = `## Publishing a post

Give the post a clear **title**; it becomes the page heading.

> [!TIP]
> Draft first, publish when review is done.

{{wiki:media:diagram}}

Layout blocks are covered in {{wiki:guide:hero-banner-guide}}.

> [!WARNING]
> Published changes go live immediately.
`

const publishingGuideDe = `## Einen Beitrag veröffentlichen

Gib dem Beitrag einen klaren **Titel**; er wird die Seitenüberschrift.

> [!TIP]
> Erst als Entwurf speichern, nach dem Review veröffentlichen.

{{wiki:media:diagram}}

Layout-Blöcke werden in {{wiki:guide:hero-banner-guide}} erklärt.

> [!WARNING]
> Veröffentlichte Änderungen sind sofort live.
`

const editorTourGuide = `## What the wiki editor can do

Standard formatting, lists, quotes, and links work as expected.

> [!NOTE]
> Callouts come in info, tip, warning, and danger variants.

:::tip This box is a consumer-supplied block, rendered by the dev app's own component.

{{embed:https://www.youtube.com/watch?v=dQw4w9WgXcQ}}

Cross-reference other guides inline, like {{wiki:guide:publishing-a-post}}.
`

const postFieldsGuide = `## Post fields

The **intro** appears above the fold; keep it under two sentences.

The **accent color** and **icon** in the branding group come from the
\`@10x-media/fields\` package; their hover help works without any changes.

> [!CAUTION]
> Changing the accent color affects every published page instantly.
`

/**
 * Seed the dev app: an admin login plus wiki guides exercising every surface
 * kind (collection, field, block, global), GitHub-alert callouts, media and
 * guide-link placeholders, consumer transformers (devTip block, video embed),
 * localized en/de content, and one deliberately orphaned target for the
 * orphan banner. Idempotent by design; a seed failure logs loudly but never
 * blocks the dev boot.
 */
export const seedDev = async (payload: Payload): Promise<void> => {
	const userCount = await payload.count({ collection: 'users' })
	if (userCount.totalDocs === 0) {
		await payload.create({
			collection: 'users',
			data: { email: DEV_EMAIL, password: DEV_PASSWORD },
		})
		payload.logger.info(`Seeded dev admin: ${DEV_EMAIL} / ${DEV_PASSWORD}`)
	}
	try {
		await seedWiki(
			payload,
			[
				{
					content: { de: { markdown: publishingGuideDe }, en: { markdown: publishingGuideEn } },
					featured: true,
					featuredOrder: 1,
					slug: 'publishing-a-post',
					summary: {
						de: 'Vom Entwurf zur Veröffentlichung, Schritt für Schritt.',
						en: 'From draft to published, step by step.',
					},
					targets: [
						{ collectionSlug: 'posts', type: 'collection' },
						{ fieldPath: 'posts.title', type: 'field' },
					],
					title: { de: 'Beitrag veröffentlichen', en: 'Publishing a post' },
				},
				{
					content: { markdown: editorTourGuide },
					featured: true,
					featuredOrder: 2,
					slug: 'editor-features-tour',
					summary: 'Callouts, consumer blocks, video embeds, and guide links in one page.',
					targets: [{ collectionSlug: 'products', type: 'collection' }],
					title: 'Editor features tour',
				},
				{
					content: { markdown: postFieldsGuide },
					slug: 'post-fields-explained',
					summary: 'What each post field does, including the @10x-media/fields ones.',
					targets: [
						{ fieldPath: 'posts.intro', type: 'field' },
						{ fieldPath: 'posts.branding.accent', type: 'field' },
						{ fieldPath: 'posts.branding.icon', type: 'field' },
					],
					title: { de: 'Beitragsfelder erklärt', en: 'Post fields explained' },
				},
				{
					content: {
						markdown:
							'The hero banner opens the page. Keep headings short and pick a background with enough contrast.\n\nSee {{wiki:guide:publishing-a-post}} for the publishing flow.',
					},
					slug: 'hero-banner-guide',
					summary: 'How to use the hero banner block well.',
					targets: [{ blockSlug: 'heroBanner', type: 'block' }],
					title: 'Hero banner',
				},
				{
					content: {
						markdown:
							'Site settings apply to every tenant page.\n\n> [!IMPORTANT]\n> The site name feeds the browser tab and emails.',
					},
					slug: 'site-settings',
					summary: 'What the global settings control.',
					targets: [
						{ globalSlug: 'settings', type: 'global' },
						{ fieldPath: 'settings.siteName', type: 'field' },
					],
					title: 'Site settings',
				},
				{
					content: {
						markdown:
							'Products need a name and a price; the description is shown on the storefront.',
					},
					slug: 'managing-products',
					summary: 'The product catalog basics.',
					targets: [
						{ collectionSlug: 'products', type: 'collection' },
						{ fieldPath: 'products.description', type: 'field' },
					],
					title: { de: 'Produkte verwalten', en: 'Managing products' },
				},
				{
					content: {
						markdown: 'This guide targets a field that no longer exists, on purpose.',
					},
					slug: 'orphaned-example',
					summary: 'Demonstrates the orphaned-target banner.',
					targets: [{ fieldPath: 'posts.removedField', type: 'field' }],
					title: 'Orphaned example',
				},
			],
			{
				media: [
					{
						alt: { de: 'Beispieldiagramm', en: 'Example diagram' },
						file: path.resolve(dirname, '../fixtures/diagram.png'),
						key: 'diagram',
					},
				],
				transformers: [devTipTransformer, embedTransformer],
			}
		)
		payload.logger.info('Seeded wiki guides')
	} catch (error) {
		payload.logger.error({ err: error }, '@10x-media/admin-wiki dev seed failed')
	}
}
