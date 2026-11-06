import { expect, type Page, test } from '@playwright/test'

import { ADMIN_ROUTE, cleanup, createCustomer, login, MARK, matchingPair } from './helpers'

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

/** The dev stand's guided create form, its first step filled in and left for the check. */
const reachCheck = async (
	page: Page,
	values: { name: string; phone: string; birthDate?: string }
): Promise<void> => {
	await page.goto(`${ADMIN_ROUTE}/collections/customers/create?variant=guided`)
	await page.locator('#field-name').fill(values.name)
	await page.locator('#field-phone').fill(values.phone)
	if (values.birthDate) await page.locator('#field-birthDate input').fill(values.birthDate)
	await page.getByRole('button', { name: 'Next', exact: true }).click()
}

const existing = matchingPair('guided')[0]

test('a guided create form blocks the save on a look-alike born the same day', async ({
	page,
	context,
}) => {
	await createCustomer(context.request, existing)
	await reachCheck(page, {
		name: `${MARK} guided Kowalski`,
		phone: existing.phone as string,
		birthDate: '05/15/1990',
	})
	await expect(page.getByRole('link', { name: existing.name })).toBeVisible()
	await expect(page.getByText('This customer already exists.')).toBeVisible()
	await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
})

test('a guided create form warns of a weaker look-alike and lets the save through', async ({
	page,
	context,
}) => {
	await createCustomer(context.request, existing)
	await reachCheck(page, { name: `${MARK} guided Kowalski`, phone: existing.phone as string })
	await expect(page.getByRole('link', { name: existing.name })).toBeVisible()
	await expect(page.getByText('Similar customers exist. Check them before saving.')).toBeVisible()
	await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
})
