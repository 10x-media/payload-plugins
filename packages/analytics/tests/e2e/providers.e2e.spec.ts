import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { login } from './helpers'

/**
 * e2e.sh boots this pass with `ANALYTICS_PROVIDER_TYPES=posthog,plausible,umami`, which narrows the
 * Provider select below every type and leaves the seeded `native` document's type unserved.
 */
const OFFERED = ['Plausible', 'PostHog', 'Umami']
const COLLECTION = '/admin/collections/analytics-providers'
/** The disabled `native` document the dev seed stores past validation in this mode. */
const RETIRED = 'Retired provider'

const providerSelect = (page: Page) => page.locator('#field-provider')

/** A PostHog document's Region, which a blank Host makes required. */
const pickRegion = async (page: Page, region: 'US' | 'EU'): Promise<void> => {
	await page.locator('#field-posthog__region .rs__control').click()
	await page.locator('.rs__option', { hasText: new RegExp(`^${region}$`) }).click()
}

const offeredNames = async (page: Page): Promise<string[]> => {
	await providerSelect(page).locator('.rs__control').click()
	const names = await page.locator('.rs__option').allTextContents()
	await page.keyboard.press('Escape')
	return names.sort()
}

const providerId = async (request: APIRequestContext, name: string): Promise<string> => {
	const res = await request.get(
		`/api/analytics-providers?depth=0&where[name][equals]=${encodeURIComponent(name)}`
	)
	expect(res.ok()).toBeTruthy()
	const { docs } = (await res.json()) as { docs: Array<{ id: string | number }> }
	expect(docs[0], `provider "${name}"`).toBeDefined()
	return String(docs[0]?.id)
}

test('@narrowed-providers the create and edit views open on a narrowed select and save', async ({
	page,
}) => {
	await login(page.request)
	const name = `Narrowed ${Date.now()}`

	await page.goto(`${COLLECTION}/create`)
	await expect(page.locator('#field-name')).toBeEditable()
	expect(await offeredNames(page)).toEqual(OFFERED)
	await page.locator('#field-name').fill(name)
	await pickRegion(page, 'EU')
	await page.getByRole('button', { name: 'Save' }).click()
	await expect(page).toHaveURL(new RegExp(`${COLLECTION}/(?!create$)[^/]+$`))

	await page.goto(`${COLLECTION}/${await providerId(page.request, name)}`)
	await expect(page.locator('#field-name')).toHaveValue(name)
	await expect(providerSelect(page)).toContainText('PostHog')
	expect(await offeredNames(page)).toEqual(OFFERED)
})

test('@narrowed-providers a stored type no longer served opens, shows its type and is refused on save', async ({
	page,
}) => {
	await login(page.request)
	const id = await providerId(page.request, RETIRED)
	await page.goto(`${COLLECTION}/${id}`)
	await expect(page.locator('#field-name')).toHaveValue(RETIRED)
	await expect(providerSelect(page)).toContainText('Payload')

	await page.locator('#field-name').fill(`${RETIRED} edited`)
	await page.getByRole('button', { name: 'Save' }).click()
	await expect(page.locator('body')).toContainText('The following field is invalid: Provider')
	const stored = await page.request.get(`/api/analytics-providers/${id}?depth=0`)
	expect(await stored.json()).toMatchObject({ name: RETIRED, provider: 'native' })
})

/** A new PostHog document's form, named, on its type and in a region unless told none. */
const posthogDraft = async (
	page: Page,
	name: string,
	region: 'EU' | null = 'EU'
): Promise<void> => {
	await page.goto(`${COLLECTION}/create`)
	await expect(page.locator('#field-name')).toBeEditable()
	await page.locator('#field-name').fill(name)
	await providerSelect(page).locator('.rs__control').click()
	await page.locator('.rs__option', { hasText: 'PostHog' }).click()
	await expect(page.locator('#field-posthog__host')).toBeVisible()
	if (region) {
		await pickRegion(page, region)
	}
}

/** A save the form refused, the toast naming the field it refused on. */
const refused = async (page: Page, field: string): Promise<void> => {
	await page.getByRole('button', { name: 'Save' }).click()
	await expect(page.locator('[data-sonner-toast]', { hasText: `PostHog → ${field}` })).toBeVisible()
	await expect(page).toHaveURL(/\/create$/)
}

test('a PostHog Host on the other cloud region than its Region is refused, spaces around a matching one are not', async ({
	page,
}) => {
	await login(page.request)
	await posthogDraft(page, `PostHog region ${Date.now()}`)

	await page.locator('#field-posthog__host').fill('https://us.posthog.com')
	await refused(page, 'Host')

	await page.locator('#field-posthog__host').fill('  https://eu.posthog.com  ')
	await page.getByRole('button', { name: 'Save' }).click()
	await expect(page).toHaveURL(new RegExp(`${COLLECTION}/(?!create$)[^/]+$`))
})

test('a PostHog document with a blank Host, spaces and all, is refused until it has a Region', async ({
	page,
}) => {
	await login(page.request)
	await posthogDraft(page, `PostHog no region ${Date.now()}`, null)
	await page.locator('#field-posthog__host').fill('   ')
	await refused(page, 'Region')

	await pickRegion(page, 'EU')
	await page.getByRole('button', { name: 'Save' }).click()
	await expect(page).toHaveURL(new RegExp(`${COLLECTION}/(?!create$)[^/]+$`))
})

for (const [field, label, value] of [
	['apiKey', 'API key', '  phc_e2e_token'],
	['projectToken', 'Project token', 'phx_e2e_key  '],
] as const) {
	test(`a PostHog ${label} holding the other kind of key is refused, spaces around it and all`, async ({
		page,
	}) => {
		await login(page.request)
		await posthogDraft(page, `PostHog ${field} ${Date.now()}`)
		await page.locator(`#field-posthog__${field}`).fill(value)
		await refused(page, label)
	})
}
