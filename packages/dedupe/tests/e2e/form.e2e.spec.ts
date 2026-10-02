import { expect, test } from '@playwright/test'

import { cleanup, createCustomer, login, MARK, matchingPair, patchCustomer } from './helpers'

const CREATE_PATH = '/admin/collections/customers/create'

test.beforeEach(async ({ context }) => {
	await login(context)
	await cleanup(context.request)
})

test.afterAll(async ({ browser }) => {
	const context = await browser.newContext()
	await login(context)
	await cleanup(context.request)
	await context.close()
})

test('typing a look-alike lists the saved one and the save asks first', async ({
	page,
	context,
}) => {
	const [saved, typed] = matchingPair('form')
	await createCustomer(context.request, saved)

	await page.goto(CREATE_PATH)
	await page.locator('#field-name').fill(String(typed.name))
	await page.locator('#field-phone').fill(String(typed.phone))

	const panel = page.locator('.dedupe-duplicates')
	await expect(panel.locator('.dedupe-duplicates__item')).toContainText(`${MARK} form Kowalska`)

	await page.locator('#action-save').click()
	const modal = page.locator('.confirmation-modal')
	await expect(modal).toContainText('This may already exist')
	await expect(modal).toContainText(`${MARK} form Kowalska`)

	await modal.getByRole('button', { name: 'Create anyway' }).click()
	await expect(page).not.toHaveURL(/\/create$/)
})

test('a question closed with Escape asks again on the next save', async ({ page, context }) => {
	const [saved, typed] = matchingPair('escape')
	await createCustomer(context.request, saved)

	await page.goto(CREATE_PATH)
	await page.locator('#field-name').fill(String(typed.name))
	await page.locator('#field-phone').fill(String(typed.phone))
	await expect(page.locator('.dedupe-duplicates .dedupe-duplicates__item')).toHaveCount(1)

	const modal = page.locator('.confirmation-modal')
	await page.locator('#action-save').click()
	await expect(modal).toContainText('This may already exist')
	await page.keyboard.press('Escape')
	await expect(modal).toBeHidden()

	await page.locator('#action-save').click()
	await expect(modal).toContainText('This may already exist')
	await modal.getByRole('button', { name: 'Create anyway' }).click()
	await expect(page).not.toHaveURL(/\/create$/)
})

test('the sidebar names a look-alike in the language the admin shows', async ({
	page,
	context,
}) => {
	const [saved, typed] = matchingPair('formde')
	const created = await createCustomer(context.request, saved)
	await patchCustomer(context.request, created.id, {
		name: `${MARK} formde Kowalska DE`,
		locale: 'de',
	})

	// The admin keeps the locale it was last opened in for the user, so the next specs get it back.
	try {
		await page.goto(`${CREATE_PATH}?locale=de`)
		await page.locator('#field-name').fill(String(typed.name))
		await page.locator('#field-phone').fill(String(typed.phone))

		await expect(page.locator('.dedupe-duplicates .dedupe-duplicates__item')).toContainText(
			`${MARK} formde Kowalska DE`
		)
	} finally {
		await page.goto(`${CREATE_PATH}?locale=en`)
		await expect(page.locator('#field-name')).toBeVisible()
	}
})

test('a document that resembles nothing saves without asking', async ({ page }) => {
	await page.goto(CREATE_PATH)
	await page.locator('#field-name').fill(`${MARK} Unique Person Zyx`)
	await page.locator('#action-save').click()
	await expect(page).not.toHaveURL(/\/create$/)
	await expect(page.locator('.confirmation-modal')).toBeHidden()
})

test('a look-alike named without spaces wraps inside the sidebar on a phone', async ({
	page,
	context,
}) => {
	const unbroken = 'Kowalska'.repeat(12)
	const [a, b] = matchingPair('phone', {
		a: { name: `${MARK} ${unbroken}` },
		b: { name: `${MARK} ${unbroken}i` },
	})
	await createCustomer(context.request, a)
	const opened = await createCustomer(context.request, b)

	await page.setViewportSize({ width: 390, height: 900 })
	await page.goto(`/admin/collections/customers/${opened.id}`)
	const panel = page.locator('.dedupe-duplicates')
	const link = panel.locator('.dedupe-duplicates__head a', { hasText: unbroken }).first()
	await expect(link).toBeVisible()
	const [box, text] = [await panel.boundingBox(), await link.boundingBox()]
	expect((text?.x ?? 0) + (text?.width ?? 0)).toBeLessThanOrEqual(
		(box?.x ?? 0) + (box?.width ?? 0) + 1
	)
})

test('publishing a new document in one language asks first too', async ({ page, context }) => {
	const data = { title: `${MARK} locale twin`, summary: 'Rowing past the islands at noon' }
	const response = await context.request.post('/api/articles', {
		data: { ...data, _status: 'published' },
	})
	expect(response.ok(), `create failed: ${response.status()}`).toBe(true)
	try {
		await page.goto('/admin/collections/articles/create')
		await page.locator('#field-title').fill(data.title)
		await page.locator('#field-summary').fill(data.summary)
		await expect(page.locator('.dedupe-duplicates .dedupe-duplicates__item')).toHaveCount(1)

		await page.locator('#action-save-popup button').first().click()
		await page.locator('#publish-locale').click()
		const modal = page.locator('.confirmation-modal')
		await expect(modal).toContainText('This may already exist')
		await modal.getByRole('button', { name: 'Create anyway' }).click()
		await expect(page).not.toHaveURL(/\/create$/)
	} finally {
		const found = await context.request.get(
			`/api/articles?depth=0&limit=10&where[title][equals]=${encodeURIComponent(data.title)}`
		)
		for (const doc of ((await found.json()) as { docs: { id: string }[] }).docs) {
			await context.request.delete(`/api/articles/${doc.id}?trash=false`)
		}
	}
})

test('a draft never published lists its look-alikes without offering a merge', async ({
	page,
	context,
}) => {
	const data = { title: `${MARK} draft twin`, summary: 'Paddling on the Dnipro at dawn' }
	const create = async (path: string, body: Record<string, unknown>) => {
		const response = await context.request.post(path, { data: body })
		expect(response.ok(), `create failed: ${response.status()}`).toBe(true)
		return ((await response.json()) as { doc: { id: string } }).doc.id
	}
	const live = await create('/api/articles', { ...data, _status: 'published' })
	const twin = await create('/api/articles', { ...data, _status: 'published' })
	const draft = await create('/api/articles?draft=true', data)
	const items = page.locator('.dedupe-duplicates__item', { hasText: data.title })
	try {
		await page.goto(`/admin/collections/articles/${live}`)
		await expect(items.first()).toBeVisible()
		await expect(items.locator('[aria-label="Merge"]')).not.toHaveCount(0)

		await page.goto(`/admin/collections/articles/${draft}`)
		await expect(items.first()).toBeVisible()
		await expect(items.locator('[aria-label="Merge"]')).toHaveCount(0)
	} finally {
		for (const id of [live, twin, draft]) {
			await context.request.delete(`/api/articles/${id}?trash=false`)
		}
	}
})
