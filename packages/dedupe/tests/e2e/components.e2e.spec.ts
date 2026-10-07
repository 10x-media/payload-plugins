import { type APIRequestContext, expect, test } from '@playwright/test'

import { cell, login, MERGE_PATH, pick } from './helpers'

/** The dev seed's custom-field showcases, oldest first: three look-alikes of one company. */
const showcases = async (request: APIRequestContext): Promise<string[]> => {
	const response = await request.get('/api/showcases?sort=createdAt&depth=0&limit=3')
	const { docs } = (await response.json()) as { docs: { id: string }[] }
	expect(docs, 'the dev seed has its three showcases').toHaveLength(3)
	return docs.map((doc) => doc.id)
}

test.beforeEach(async ({ context }) => {
	await login(context)
})

test('draws a field with a component of its own as the form does, picked whole', async ({
	page,
	context,
}) => {
	const [a, b] = (await showcases(context.request)) as [string, string]
	await page.goto(`${MERGE_PATH}?collection=showcases&docs=${a},${b}&survivor=${a}`)
	await expect(page.locator('.dedupe-merge__grid')).toBeVisible()

	// Stars and a swatch, as on the document's own form, rather than `4` and `#ff8800`.
	await expect.soft(cell(page, 'rating', a)).toContainText('★★★★☆')
	await expect
		.soft(cell(page, 'color', a).locator('input:not([type=radio])'))
		.toHaveValue('#ff8800')
	// A phone stays one phone: one cell for the group, none for its country or number alone.
	await expect
		.soft(cell(page, 'phone', b).locator('input:not([type=radio])').first())
		.toHaveValue('+380')
	await expect.soft(page.locator('label[for^="dedupe-phone."]')).toHaveCount(0)
	// A list drawn by its own component is one cell to pick, not rows to check.
	await expect.soft(cell(page, 'labels', b)).toContainText('Late payer')
	// The component cannot be edited from here, whatever it does with `readOnly`.
	await expect.soft(cell(page, 'rating', a).locator('[inert]')).toHaveCount(1)
	// No diff inside a component: the cell that differs from the primary says so.
	await expect.soft(cell(page, 'rating', b)).toHaveClass(/dedupe-merge__cell--differs/)
	await expect.soft(cell(page, 'rating', a)).not.toHaveClass(/dedupe-merge__cell--differs/)

	await pick(page, 'labels', b)
	await pick(page, 'phone', b)
})
