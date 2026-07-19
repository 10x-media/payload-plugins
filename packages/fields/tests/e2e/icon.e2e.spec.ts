import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

const FIXTURES = {
	collection: 'icons',
	multiDocTitle: 'Globex (single-library + degradation)',
	multi: 'iconMulti',
	restricted: 'iconTenantRestricted',
	restrictedSeedLibrary: 'lucide',
	allowedLibrary: 'tabler',
	searchTerm: 'house',
}

const login = async (page: Page): Promise<void> => {
	const res = await page.request.post('/api/users/login', {
		data: { email: 'dev@10xmedia.de', password: 'password' },
	})
	expect(res.ok()).toBeTruthy()
}

const openDoc = async (page: Page, title: string, field: string): Promise<string> => {
	const res = await page.request.get(
		`/api/${FIXTURES.collection}?where[title][equals]=${encodeURIComponent(title)}&limit=1`
	)
	const { docs } = (await res.json()) as { docs: { id: string }[] }
	const doc = docs[0]
	if (!doc) throw new Error(`no ${FIXTURES.collection} doc titled ${title}`)
	await page.goto(`/admin/collections/${FIXTURES.collection}/${doc.id}`)
	await expect(page.locator(`#field-${field}`)).toBeVisible()
	return doc.id
}

const fetchFieldValue = async (
	page: Page,
	id: string,
	field: string
): Promise<string | undefined> => {
	const res = await page.request.get(`/api/${FIXTURES.collection}/${id}?depth=0`)
	const doc = (await res.json()) as Record<string, string | undefined>
	return doc[field]
}

const openDrawer = (page: Page, field: string): Promise<void> =>
	page.locator(`#field-${field} .tenx-icon-field__open`).click()

const drawer = '.tenx-icon-drawer'
const searchInput = `${drawer} .tenx-icon-drawer__search-input`
const options = `${drawer} .tenx-icon-drawer__cell-button[role="option"]`

const saveDoc = async (page: Page): Promise<void> => {
	const saved = page.waitForResponse(
		(r) => r.url().includes(`/api/${FIXTURES.collection}`) && r.request().method() === 'PATCH'
	)
	await page.locator('#action-save').click()
	expect((await saved).ok()).toBeTruthy()
}

test.describe('icon field', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
	})

	test('searches, filters by category, selects with the keyboard, and persists', async ({
		page,
	}) => {
		const id = await openDoc(page, FIXTURES.multiDocTitle, FIXTURES.multi)
		await openDrawer(page, FIXTURES.multi)

		await expect(page.locator(drawer)).toBeVisible()
		await expect(page.locator(`${drawer} .tenx-icon-drawer__rail`)).toBeVisible()
		await expect(page.locator(`${drawer} .tenx-icon-drawer__grid`)).toBeVisible()
		await expect(page.locator(`${drawer} .tenx-icon-drawer__switcher`)).toBeVisible()

		const total = await page.locator(options).count()
		await page.locator(searchInput).fill(FIXTURES.searchTerm)
		await expect(page.locator(`${drawer} .tenx-icon-drawer__footer`)).not.toHaveText('0 icons')
		await expect(page.locator(options).first()).toBeVisible()
		const filtered = await page.locator(options).count()
		expect(filtered).toBeGreaterThan(0)
		expect(filtered).toBeLessThan(total)

		await page.locator(searchInput).fill('')
		await page.locator(`${drawer} .tenx-icon-drawer__rail-item`).nth(2).click()
		await expect(page.locator(options).first()).toBeVisible()

		await page.locator(`${drawer} .tenx-icon-drawer__rail-item`).first().click()
		await page.locator(searchInput).fill(FIXTURES.searchTerm)
		const firstOption = page.locator(options).first()
		await firstOption.focus()
		await page.keyboard.press('ArrowRight')
		await page.keyboard.press('Enter')
		await expect(page.locator(drawer)).toBeHidden()

		const label = await page.locator(`#field-${FIXTURES.multi} .tenx-icon-field__value`).innerText()
		expect(label.length).toBeGreaterThan(0)

		await saveDoc(page)
		expect(await fetchFieldValue(page, id, FIXTURES.multi)).toMatch(/^lucide:[a-z0-9-]+$/)
		await page.reload()
		await expect(page.locator(`#field-${FIXTURES.multi} .tenx-icon-field__value`)).toHaveText(label)
	})

	test('restricts selectable libraries to the tenant, flags an unavailable value, and replaces it', async ({
		page,
	}) => {
		const id = await openDoc(page, FIXTURES.multiDocTitle, FIXTURES.restricted)

		const marker = page.locator(`#field-${FIXTURES.restricted} .tenx-icon-field__marker`)
		await expect(marker).toBeVisible()
		await expect(marker).toHaveAttribute('title', 'Unavailable')

		await openDrawer(page, FIXTURES.restricted)
		await expect(page.locator(drawer)).toBeVisible()
		await expect(page.locator(`${drawer} .tenx-icon-drawer__switcher`)).toBeHidden()
		await expect(page.locator(`${drawer} .tenx-icon-drawer__banner`)).toBeVisible()

		await page.locator(searchInput).fill(FIXTURES.searchTerm)
		await page.locator(options).first().click()
		await expect(page.locator(drawer)).toBeHidden()
		await expect(marker).toBeHidden()

		await saveDoc(page)
		expect(await fetchFieldValue(page, id, FIXTURES.restricted)).toMatch(
			new RegExp(`^${FIXTURES.allowedLibrary}:`)
		)
	})

	test('open drawer has no serious or critical axe violations', async ({ page }) => {
		await openDoc(page, FIXTURES.multiDocTitle, FIXTURES.multi)
		await openDrawer(page, FIXTURES.multi)
		await expect(page.locator(drawer)).toBeVisible()
		const results = await new AxeBuilder({ page }).include(drawer).analyze()
		const blocking = results.violations.filter(
			(v) => v.impact === 'serious' || v.impact === 'critical'
		)
		expect(blocking).toEqual([])
	})
})
