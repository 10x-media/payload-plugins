import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Payload } from 'payload'
import { seedWiki } from '../../src/index'
import { devTipTransformer, embedTransformer } from './seedTransformers'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Guide content never restates the guide's own title: the wiki view, the drawer
// and the hover card all print it above the content already.
// Both guides below carry three or more h2/h3 headings on purpose: that is the
// threshold at which a table of contents renders, so they demonstrate it. The
// products guides deliberately do not, which is what shows a drawer rail
// suppressing the TOC.
const publishingGuideEn = `## Write the draft

Give the post a clear **title**; it becomes the page heading.

> [!TIP]
> Draft first, publish when review is done.

## Lay out the page

{{wiki:media:diagram}}

Layout blocks are covered in {{wiki:guide:hero-banner-guide}}.

## Publish

> [!WARNING]
> Published changes go live immediately.
`

const publishingGuideDe = `## Entwurf schreiben

Gib dem Beitrag einen klaren **Titel**; er wird die Seitenüberschrift.

> [!TIP]
> Erst als Entwurf speichern, nach dem Review veröffentlichen.

## Seite aufbauen

{{wiki:media:diagram}}

Layout-Blöcke werden in {{wiki:guide:hero-banner-guide}} erklärt.

## Veröffentlichen

> [!WARNING]
> Veröffentlichte Änderungen sind sofort live.
`

const editorTourGuide = `## Formatting

Standard formatting, lists, quotes, and links work as expected.

## Callouts

> [!NOTE]
> Callouts come in info, tip, warning, and danger variants.
> A second line stays a second line, and a guide link works here too:
> see {{wiki:guide:publishing-a-post}}.

### Consumer blocks

:::tip This box is a consumer-supplied block, rendered by the dev app's own component.

## Video

{{embed:https://www.youtube.com/watch?v=dQw4w9WgXcQ}}

## Linking guides

Cross-reference other guides inline, like {{wiki:guide:publishing-a-post}}, or under
[words of your own]({{wiki:guide:hero-banner-guide}}) when the guide's title does not
read as part of the sentence.
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
 * kind (collection, entity field, block, block field, global), GitHub-alert
 * callouts, media and guide-link placeholders, consumer transformers (devTip
 * block, video embed), localized en/de content, and one deliberately orphaned
 * target for the orphan banner. Idempotent by design; a seed failure logs
 * loudly but never blocks the dev boot.
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
					targets: {
						collections: ['posts'],
						fields: ['collection:posts.title'],
					},
					title: { de: 'Beitrag veröffentlichen', en: 'Publishing a post' },
				},
				{
					content: { markdown: editorTourGuide },
					featured: true,
					featuredOrder: 2,
					slug: 'editor-features-tour',
					summary: 'Callouts, consumer blocks, video embeds, and guide links in one page.',
					targets: { collections: ['products'] },
					title: 'Editor features tour',
				},
				{
					content: { markdown: postFieldsGuide },
					slug: 'post-fields-explained',
					summary: 'What each post field does, including the @10x-media/fields ones.',
					targets: {
						fields: [
							'collection:posts.intro',
							'collection:posts.branding.accent',
							'collection:posts.branding.icon',
						],
					},
					title: { de: 'Beitragsfelder erklärt', en: 'Post fields explained' },
				},
				{
					content: {
						markdown:
							'The hero banner opens the page. Keep headings short and pick a background with enough contrast.\n\nSee [the publishing flow]({{wiki:guide:publishing-a-post}}) for what happens next.',
					},
					slug: 'hero-banner-guide',
					summary: 'How to use the hero banner block well.',
					targets: { blocks: ['heroBanner'] },
					title: 'Hero banner',
				},
				{
					content: {
						markdown:
							'Lead with the promise, not the product name. Under sixty characters keeps it on one line at every breakpoint.\n\nThe hero banner is shared by posts and products, and this guide is attached to the block, not to either collection: `block:heroBanner.heading` surfaces it at both.',
					},
					slug: 'hero-headline',
					summary: 'One guide on a shared block field, shown wherever the block is used.',
					targets: { fields: ['block:heroBanner.heading'] },
					title: 'Hero headline',
				},
				{
					content: {
						markdown:
							'Say what happens next, in two or three words. "Get started", not "Click here".\n\nThe `cta` slug is declared twice in this app on purpose: once in `config.blocks` (with a `style`) and once inline on the settings global (with a `url`). Both variants are walked under `block:cta`, so this one guide on `block:cta.label` shows in the product layout and in the global, and the boot log carries the divergence warning.',
					},
					slug: 'cta-label',
					summary: 'One target across two blocks that share a slug.',
					targets: { fields: ['block:cta.label'] },
					title: 'Call to action label',
				},
				{
					content: {
						markdown:
							'Site settings apply to every tenant page.\n\n> [!IMPORTANT]\n> The site name feeds the browser tab and emails.',
					},
					slug: 'site-settings',
					summary: 'What the global settings control.',
					targets: {
						fields: ['global:settings.siteName'],
						globals: ['settings'],
					},
					title: 'Site settings',
				},
				{
					content: {
						markdown:
							'Products need a name and a price; the description is shown on the storefront.',
					},
					slug: 'managing-products',
					summary: 'The product catalog basics.',
					targets: {
						collections: ['products'],
						fields: ['collection:products.description'],
					},
					title: { de: 'Produkte verwalten', en: 'Managing products' },
				},
				{
					content: {
						markdown: 'This guide targets a field that no longer exists, on purpose.',
					},
					slug: 'orphaned-example',
					summary: 'Demonstrates the orphaned-target banner.',
					targets: { fields: ['collection:posts.removedField'] },
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
