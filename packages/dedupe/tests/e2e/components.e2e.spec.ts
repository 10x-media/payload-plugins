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

test("rows are labelled as the document's form labels them: by the collection's own label, or Payload's", async ({
	page,
	context,
}) => {
	const [a, b] = (await showcases(context.request)) as [string, string]
	await page.goto(`${MERGE_PATH}?collection=showcases&docs=${a},${b}&survivor=${a}`)
	await expect(page.locator('.dedupe-merge__grid')).toBeVisible()
	await page.locator('#dedupe-only-differences').click()
	/** One document's rows of a list field, found by the checks of its rows. */
	const rows = (key: string, doc: string) =>
		page.locator('.dedupe-merge__rows', { has: page.locator(`[id^="dedupe-${key}-${doc}-"]`) })
	// The array's RowLabel and the blocks' Label of the dev showcases.
	await expect.soft(rows('contacts', a)).toContainText('Olena Koval (owner)')
	await expect.soft(rows('sections', a)).toContainText('§ About us')

	// Blocks without a label of their own: number, type and the block's name, `Untitled` unnamed.
	const response = await context.request.get('/api/specimens?depth=0&limit=50')
	const { docs } = (await response.json()) as { docs: { id: string; layout?: unknown[] }[] }
	const [c, d] = docs.filter((doc) => (doc.layout ?? []).length > 0) as [
		{ id: string },
		{ id: string },
	]
	await page.goto(`${MERGE_PATH}?collection=specimens&docs=${c.id},${d.id}&survivor=${c.id}`)
	await expect(page.locator('.dedupe-merge__grid')).toBeVisible()
	await page.locator('#dedupe-only-differences').click()
	const header = rows('layout', c.id).locator('.blocks-field__block-header').first()
	await expect.soft(header.locator('.blocks-field__block-number')).toHaveText('01')
	await expect.soft(header.locator('.blocks-field__block-pill')).toBeVisible()
	const name = header.locator('.section-title__input')
	await expect.soft(name).toBeVisible()
	await expect.soft(name).toHaveAttribute('placeholder', 'Untitled')

	// The name cannot be edited here: a click on it opens the row, as one anywhere on its header.
	const row = rows('layout', c.id).locator('.collapsible').first()
	await expect(row).toHaveClass(/collapsible--collapsed/)
	await expect.soft(name).not.toBeEditable()
	await name.click({ force: true })
	await expect.soft(row).not.toHaveClass(/collapsible--collapsed/)
})

test("a row's check keeps its whole focus glow, in array and blocks rows alike", async ({
	page,
	context,
}) => {
	const [a, b] = (await showcases(context.request)) as [string, string]
	await page.goto(`${MERGE_PATH}?collection=showcases&docs=${a},${b}&survivor=${a}`)
	await expect(page.locator('.dedupe-merge__grid')).toBeVisible()
	for (const key of ['contacts', 'sections']) {
		const check = page.locator(`[id="dedupe-${key}-${a}-0"]`)
		await check.scrollIntoViewIfNeeded()
		// Payload draws the glow as `0 0 3px 3px`: 6px beyond the check on every side.
		const cut = await check.evaluate((input) => {
			const glow = 6
			const box = (input.closest('.checkbox-input__input') ?? input).getBoundingClientRect()
			const cutters: string[] = []
			for (let node = input.parentElement; node; node = node.parentElement) {
				if (node.classList.contains('dedupe-merge__rows')) break
				const style = getComputedStyle(node)
				if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
				const rect = node.getBoundingClientRect()
				const left = rect.left + node.clientLeft
				const top = rect.top + node.clientTop
				if (
					box.left - glow < left ||
					box.top - glow < top ||
					box.right + glow > left + node.clientWidth ||
					box.bottom + glow > top + node.clientHeight
				) {
					cutters.push(String(node.className).split(' ')[0] ?? node.tagName)
				}
			}
			return cutters
		})
		expect.soft(cut, `${key}: what clips the glow`).toEqual([])
	}
})
