import { expect, test } from '@playwright/test'

import { createDoc, deleteDoc, fieldWrap, login, openPopup, PAGES } from './helpers'

/**
 * Where the seeded guides render once they target something, from the field
 * description up to the standalone wiki view. The guides come from the dev
 * app's own seed, so the assertions are about placement rather than about
 * content this spec wrote.
 */
test.describe('wiki surfaces', () => {
	let postId = ''

	test.beforeEach(async ({ page }) => {
		await login(page)
	})

	test.afterEach(async ({ page }) => {
		if (postId) {
			await deleteDoc(page, 'posts', postId)
			postId = ''
		}
	})

	test('shows a guide under the field it targets, and opens it in a drawer', async ({ page }) => {
		postId = await createDoc(page, 'posts', { title: 'Field help' })
		await page.goto(`/admin/collections/posts/${postId}`)

		const trigger = fieldWrap(page, 'title').locator('.wiki-field-help__trigger')
		await expect(trigger).toHaveText('Publishing a post')

		await trigger.click()
		const card = openPopup(page)
		await expect(card.locator('.wiki-field-help__item-summary')).toHaveText(
			'From draft to published, step by step.'
		)

		await card.locator('.wiki-field-help__item-open').click()
		await expect(page.locator('.wiki-guide-article')).toContainText('Write the draft')
	})

	test('lists the collection guides in the document sidebar', async ({ page }) => {
		postId = await createDoc(page, 'posts', { title: 'Sidebar' })
		await page.goto(`/admin/collections/posts/${postId}`)

		const panel = page.locator('.wiki-doc-guides')
		await expect(panel.locator('.wiki-doc-guides__label')).toHaveText('Guides')
		await expect(panel.locator('.wiki-guide-card__title')).toContainText('Publishing a post')
	})

	test('bands the list view with the collection guides', async ({ page }) => {
		await page.goto('/admin/collections/posts')

		// The dev app moves the band to `afterListTable`, which is a configured
		// slot rather than the default one.
		const band = page.locator('.wiki-list-guides--afterListTable')
		await expect(band.locator('.wiki-guide-card__title').first()).toContainText('Publishing a post')
	})

	test('follows a shared block into the document that renders it', async ({ page }) => {
		postId = await createDoc(page, 'posts', {
			layout: [{ blockType: 'heroBanner', heading: 'Hello' }],
			title: 'Block help',
		})
		await page.goto(`/admin/collections/posts/${postId}`)

		// One guide on `block:heroBanner`, one on `block:heroBanner.heading`: both
		// are attached to the block, and neither names posts.
		await expect(page.locator('.wiki-block-help .wiki-field-help__trigger')).toHaveText(
			'Hero banner'
		)
		await expect(
			fieldWrap(page, 'layout.0.heading').locator('.wiki-field-help__trigger')
		).toHaveText('Hero headline')
	})

	test('reports a target that no longer resolves', async ({ page }) => {
		await page.goto(`/admin/collections/${PAGES}`)

		const banner = page.locator('.wiki-orphan-banner')
		await expect(banner).toContainText('Orphaned guide targets')
		await expect(banner.locator('.wiki-orphan-banner__key')).toContainText(
			'field:collection:posts.removedField'
		)
	})

	test('reads guides from the standalone wiki view', async ({ page }) => {
		await page.goto('/admin/wiki')

		await expect(page.locator('.wiki-index__card-title').first()).toContainText('Publishing a post')

		await page.locator('.wiki-index__card').first().click()
		await expect(page.locator('.wiki-guide-article')).toContainText('Write the draft')
	})

	test('renders an inline block in the sentence and the consumer link converter', async ({
		page,
	}) => {
		await page.goto('/admin/wiki')
		await page.locator('.wiki-index__card-title', { hasText: 'Editor features tour' }).click()

		const article = page.locator('.wiki-guide-article')
		// The chip is seeded mid-paragraph, so a renderer returning block-level JSX
		// would break the sentence apart rather than sit inside it.
		const chip = article.locator('.dev-status-chip').first()
		await expect(chip).toBeVisible()
		await expect(chip.locator('xpath=ancestor::p')).toHaveCount(1)

		// options.editor.converters replaces the plugin's own link converter.
		await expect(article.locator('a[data-dev-converter="link"]').first()).toBeVisible()

		// The same function wraps the plugin's callout converter, so both survive:
		// the wrapper is the project's, the callout inside it is the plugin's.
		const wrapped = article.locator('[data-dev-converter="wikiCallout"]').first()
		await expect(wrapped.locator('.wiki-callout')).toBeVisible()

		// A block renderer resolved from the import map, the other half of the seam.
		await expect(article.locator('[data-dev-renderer="devTip"]').first()).toBeVisible()
	})

	test('surfaces a custom target on the dev app custom view', async ({ page }) => {
		// Nothing in the config describes this view, so its guide is attached to a
		// declared custom key rather than to anything the walker found.
		await page.goto('/admin/dashboard')

		const trigger = page.locator('.wiki-field-help__trigger').first()
		await expect(trigger).toHaveText('Reading the dashboard')

		await trigger.click()
		await openPopup(page).locator('.wiki-field-help__item-open').click()
		await expect(page.locator('.wiki-guide-article')).toContainText('custom admin view')
	})

	test('chips a custom target under its declared label on the wiki index', async ({ page }) => {
		await page.goto('/admin/wiki')

		const row = page.locator('.wiki-index__row', { hasText: 'Reading the dashboard' }).first()
		await expect(row.locator('.wiki-target-chips__chip--custom')).toHaveText('Dashboard')
	})

	test('renders the dev app components in all three wiki index slots', async ({ page }) => {
		await page.goto('/admin/wiki')

		// The dev app wires a client component into the header actions and into
		// the slot below the list, and a server component above it: the server one
		// counts drafts, which only the server props can reach.
		await expect(
			page.locator('.wiki-view__header-actions a', { hasText: 'Dev link' })
		).toBeVisible()
		await expect(page.locator('.wiki-index__slot--before-table')).toContainText('in draft')
		await expect(page.locator('.wiki-index__slot--after-table')).toContainText('guides listed')
	})

	test('offers a write affordance on an unguided field once edit mode is on', async ({ page }) => {
		postId = await createDoc(page, 'posts', { title: 'Edit mode' })

		await page.goto(`/admin/collections/${PAGES}`)
		await page.locator('.wiki-edit-mode__pill').click()

		await page.goto(`/admin/collections/posts/${postId}`)
		// `tagline` is the one branding field no seeded guide targets. The
		// affordance is revealed by hovering its own field, and nothing else.
		const tagline = fieldWrap(page, 'branding.tagline')
		await tagline.hover()
		await expect(tagline.locator('.wiki-write-guide')).toBeVisible()
		await expect(fieldWrap(page, 'title').locator('.wiki-write-guide')).toHaveCount(0)
	})
})
