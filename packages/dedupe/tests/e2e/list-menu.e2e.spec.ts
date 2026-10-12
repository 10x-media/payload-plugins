import { expect, type Page, test } from '@playwright/test'

import { cleanup, createCustomer, login, MARK, matchingPair } from './helpers'

const LIST = '/admin/collections/customers?limit=50'

/**
 * Payload puts plugin entries behind the list's dots menu and renders the open menu in a
 * portal, so its content is addressed by `data-popup-id` rather than from the trigger.
 */
const openListMenu = async (page: Page) => {
	await page.locator('#list-menu button.popup-button').click()
	const content = page.locator('[data-popup-id="list-menu"]')
	await expect(content).toBeVisible()
	return content
}

/** A disabled `PopupList.Button` renders as a div, so "disabled" is a class, not a state. */
const entry = (menu: ReturnType<Page['locator']>) => menu.locator('.popup-button-list__button')

const rowCheckbox = (page: Page, title: string) =>
	page
		.locator('.table tbody tr', { has: page.getByRole('link', { name: title }) })
		.locator('input[type="checkbox"]')

test.beforeEach(async ({ context, page }) => {
	await login(context)
	await cleanup(context.request)
	const [a, b] = matchingPair('menu')
	await createCustomer(context.request, a)
	await createCustomer(context.request, b)
	await page.goto(LIST)
	await expect(page.locator('.table tbody tr').first()).toBeVisible()
})

test.afterAll(async ({ browser }) => {
	const context = await browser.newContext()
	await login(context)
	await cleanup(context.request)
	await context.close()
})

test('with nothing selected the entry explains what it needs', async ({ page }) => {
	const menu = await openListMenu(page)
	await expect(entry(menu)).toHaveText('Select 2 to 5 documents to merge.')
	await expect(entry(menu)).toHaveClass(/popup-button-list__disabled/)
})

test('one selected row is not enough', async ({ page }) => {
	await rowCheckbox(page, `${MARK} menu Kowalska`).check()
	const menu = await openListMenu(page)
	await expect(entry(menu)).toHaveText('Select 2 to 5 documents to merge.')
	await expect(entry(menu)).toHaveClass(/popup-button-list__disabled/)
})

test('more rows than a group takes are refused', async ({ page }) => {
	const boxes = page.locator('.table tbody input[type="checkbox"]')
	test.skip((await boxes.count()) < 6, 'needs at least six rows in the list')
	for (let i = 0; i < 6; i++) await boxes.nth(i).check()

	const menu = await openListMenu(page)
	await expect(entry(menu)).toHaveText('Select 2 to 5 documents to merge.')
	await expect(entry(menu)).toHaveClass(/popup-button-list__disabled/)
})

test('two selected rows open the merge screen for exactly those documents', async ({ page }) => {
	await rowCheckbox(page, `${MARK} menu Kowalska`).check()
	await rowCheckbox(page, `${MARK} menu Kowalski`).check()

	const menu = await openListMenu(page)
	const item = entry(menu)
	await expect(item).toHaveText('Merge selected')
	await expect(item).not.toHaveClass(/popup-button-list__disabled/)
	await item.click()

	await expect(page).toHaveURL(/\/admin\/dedupe\/merge\?/)
	const url = new URL(page.url())
	expect(url.searchParams.get('collection')).toBe('customers')
	const docs = url.searchParams.get('docs')?.split(',') ?? []
	expect(new Set(docs).size).toBe(2)
	expect(docs).toContain(url.searchParams.get('survivor'))

	await expect(page.locator('.dedupe-merge__head')).toHaveCount(2)
	await expect(page.locator('.dedupe-merge__header h1')).toContainText(`${MARK} menu`)
})
