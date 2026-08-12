import { expect, type Locator, test } from '@playwright/test'

import {
	addPathByHand,
	applyPicker,
	cancelPicker,
	chooseBlock,
	chooseEntity,
	createGuide,
	crumbsOf,
	deleteDoc,
	group,
	groups,
	login,
	openGuideTargets,
	openPopup,
	PAGES,
	pathsOfGroup,
	picker,
	pickerReady,
	pickerSelect,
	pickField,
	pickFields,
	plate,
	saveDraft,
	storedTargets,
	targetList,
} from './helpers'

/** The picked field's row, as the Targets tab renders it. */
const firstRow = (scope: Locator): Locator =>
	pathsOfGroup(scope).first().locator('.wiki-target-fields__crumbs')

/**
 * The field target picker, driven the way an author drives it: choose a kind
 * from the button, pick fields off a real rendered form, and read the result
 * back as breadcrumbs in the Targets tab.
 */
test.describe('field target picker', () => {
	let guideId = ''

	test.beforeEach(async ({ page }) => {
		await login(page)
	})

	test.afterEach(async ({ page }) => {
		if (guideId) {
			await deleteDoc(page, PAGES, guideId)
			guideId = ''
		}
	})

	test('offers one menu entry per covered kind', async ({ page }) => {
		guideId = await createGuide(page, 'Picker menu')
		await openGuideTargets(page, guideId)

		await page.locator('.wiki-target-fields__open').click()
		await expect(openPopup(page).locator('.popup-button-list__button')).toHaveText([
			'Collection',
			'Global',
			'Block',
		])
	})

	test('picks fields off a collection form and stores index-free paths', async ({ page }) => {
		guideId = await createGuide(page, 'Picker collection')
		await openGuideTargets(page, guideId)

		await pickFields(page, 'Collection')
		await pickerReady(page)

		// One field behind a named group, one behind two nested arrays. The stored
		// path names neither row, which is what makes a single target cover them all.
		await pickField(page, 'branding.tagline')
		await pickField(page, 'specs.0.values.0.value')
		await expect(picker(page).locator('.wiki-field-picker__count')).toHaveText('2 fields selected')
		await applyPicker(page)

		const posts = group(page, 'Post')
		await expect(posts.locator('.wiki-target-fields__group-kind')).toHaveText('Collection')
		await expect(posts.locator('.wiki-target-fields__group-count')).toHaveText('2')

		const rows = pathsOfGroup(posts)
		expect(await crumbsOf(rows.first())).toEqual(['Branding', 'Tagline'])
		await expect(rows.first().locator('.wiki-target-fields__crumbs')).toHaveAttribute(
			'title',
			'collection:posts.branding.tagline'
		)
		expect(await crumbsOf(rows.nth(1))).toEqual(['Specs', 'Values', 'Value'])
		await expect(rows.nth(1).locator('.wiki-target-fields__crumbs')).toHaveAttribute(
			'title',
			'collection:posts.specs.values.value'
		)
	})

	test('opens on the targets the guide already stores, and toggles one off', async ({ page }) => {
		guideId = await createGuide(page, 'Picker toggle', ['collection:posts.intro'])
		await openGuideTargets(page, guideId)
		await expect(pathsOfGroup(group(page, 'Post'))).toHaveCount(1)

		await pickFields(page, 'Collection')
		await pickerReady(page)
		await expect(plate(page, 'intro')).toHaveAttribute('aria-pressed', 'true')
		await expect(plate(page, 'intro')).toHaveText('Covered by this guide')

		await pickField(page, 'intro')
		await expect(plate(page, 'intro')).toHaveText('Cover this field')
		await applyPicker(page)

		await expect(groups(page)).toHaveCount(0)
		await expect(targetList(page).locator('.wiki-target-fields__empty')).toBeVisible()
	})

	test('switches to another collection through the drawer only control', async ({ page }) => {
		guideId = await createGuide(page, 'Picker switch')
		await openGuideTargets(page, guideId)

		await pickFields(page, 'Collection')
		await pickerReady(page)
		await chooseEntity(page, 'Product')
		await expect(plate(page, 'description')).toBeVisible({ timeout: 30_000 })

		await pickField(page, 'description')
		await applyPicker(page)

		const products = group(page, 'Product')
		expect(await crumbsOf(pathsOfGroup(products).first())).toEqual(['Description'])
		await expect(firstRow(products)).toHaveAttribute('title', 'collection:products.description')
	})

	test('roots a block field at the block, not at the collection it renders in', async ({
		page,
	}) => {
		guideId = await createGuide(page, 'Picker block')
		await openGuideTargets(page, guideId)

		// A block has no default to fall back on, so the grid opens on its own.
		await pickFields(page, 'Block')
		await chooseBlock(page, 'Hero banner')
		await pickerReady(page)

		await pickField(page, 'heading')
		await applyPicker(page)

		const block = group(page, 'Hero banner')
		await expect(block.locator('.wiki-target-fields__group-kind')).toHaveText('Block')
		await expect(firstRow(block)).toHaveAttribute('title', 'block:heroBanner.heading')
	})

	test('picks a field off a global', async ({ page }) => {
		guideId = await createGuide(page, 'Picker global')
		await openGuideTargets(page, guideId)

		await pickFields(page, 'Global')
		await pickerReady(page)
		await pickField(page, 'siteName')
		await applyPicker(page)

		const settings = group(page, 'Settings')
		await expect(settings.locator('.wiki-target-fields__group-kind')).toHaveText('Global')
		await expect(firstRow(settings)).toHaveAttribute('title', 'global:settings.siteName')
	})

	test('discards the working selection on cancel', async ({ page }) => {
		guideId = await createGuide(page, 'Picker cancel', ['collection:posts.intro'])
		await openGuideTargets(page, guideId)

		await pickFields(page, 'Collection')
		await pickerReady(page)
		await pickField(page, 'title')
		await pickField(page, 'intro')
		await cancelPicker(page)

		const posts = group(page, 'Post')
		await expect(pathsOfGroup(posts)).toHaveCount(1)
		expect(await crumbsOf(pathsOfGroup(posts).first())).toEqual(['Intro'])
	})

	test('reopens a section on its own owner from Edit', async ({ page }) => {
		guideId = await createGuide(page, 'Picker edit', ['collection:products.description'])
		await openGuideTargets(page, guideId)

		await group(page, 'Product').getByRole('button', { name: 'Edit' }).click()
		await pickerReady(page)

		await expect(pickerSelect(page)).toContainText('Product')
		await expect(plate(page, 'description')).toHaveAttribute('aria-pressed', 'true')
		await cancelPicker(page)
	})

	test('adds a path the picker cannot reach by hand, and removes it again', async ({ page }) => {
		guideId = await createGuide(page, 'Picker manual')
		await openGuideTargets(page, guideId)

		await addPathByHand(page, 'collection:gone.someField')

		const unresolved = group(page, 'Unresolved')
		await expect(unresolved.locator('.wiki-target-fields__raw')).toHaveText(
			'collection:gone.someField'
		)

		await unresolved.locator('.wiki-target-fields__remove').click()
		await expect(groups(page)).toHaveCount(0)
	})

	test('writes the picked targets into the document on save', async ({ page }) => {
		guideId = await createGuide(page, 'Picker save')
		await openGuideTargets(page, guideId)

		await pickFields(page, 'Collection')
		await pickerReady(page)
		await pickField(page, 'title')
		await applyPicker(page)
		await saveDraft(page, PAGES)

		expect(await storedTargets(page, guideId)).toEqual(['collection:posts.title'])
	})
})
