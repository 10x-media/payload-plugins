import { expect, type Locator, type Page, test } from '@playwright/test'

import { findJobID, login } from './helpers'

/**
 * The toggle button of one attempt row. Rows carry no class names (the timeline
 * styles inline), so they are addressed by the `#<n>` counter they render.
 */
const attempt = (page: Page, n: number): Locator =>
	page.locator('button[aria-expanded]').filter({ has: page.locator(`span:text-is("#${n}")`) })

/** The collapsible panel of one attempt row: the button's next sibling. */
const panel = (page: Page, n: number): Locator =>
	page.locator(
		`xpath=//button[@aria-expanded][.//span[normalize-space(text())="#${n}"]]/following-sibling::div`
	)

const expand = async (page: Page, n: number): Promise<Locator> => {
	await attempt(page, n).click()
	await expect(attempt(page, n)).toHaveAttribute('aria-expanded', 'true')
	return panel(page, n)
}

/**
 * The seeded `sleep` job: two `sleep` attempts, which the dev app registers
 * custom blocks for, plus one `inline` attempt that keeps the default JSON.
 */
const openSleepJob = async (page: Page): Promise<void> => {
	await login(page)
	const id = await findJobID(page, 'where[taskSlug][equals]=sleep')
	await page.goto(`/admin/collections/payload-jobs/${id}`)
	await expect(attempt(page, 1)).toBeVisible()
}

test('a registered component replaces the JSON body and keeps the label', async ({ page }) => {
	await openSleepJob(page)
	const first = await expand(page, 1)

	await expect(first.getByText('Input', { exact: true })).toBeVisible()
	await expect(first.getByText('SleepInput (server)')).toBeVisible()
	await expect(first.getByText('1.5s')).toBeVisible()
	// The custom block replaces the dump entirely; the error card below renders a
	// <pre> only once its raw toggle is on.
	await expect(first.locator('pre')).toHaveCount(0)
})

test('a wildcard component runs for every task and stays interactive', async ({ page }) => {
	await openSleepJob(page)
	const first = await expand(page, 1)

	await expect(first.getByText('Error', { exact: true })).toBeVisible()
	await expect(first.getByText('Timed out waiting for the sleep to finish')).toBeVisible()

	// AttemptError is a client component, so its raw toggle has to work in place.
	await first.getByRole('button', { name: 'Show raw error' }).click()
	await expect(first.locator('pre')).toContainText('Timed out waiting for the sleep to finish')
})

test('a slot renders only for a value the attempt carries', async ({ page }) => {
	await openSleepJob(page)
	const first = await expand(page, 1)
	const second = await expand(page, 2)

	// The failed attempt has no output at all, so the registered output block is
	// absent rather than empty.
	await expect(first.getByText('Output', { exact: true })).toHaveCount(0)
	await expect(first.getByText('Rendered by SleepOutput (server)')).toHaveCount(0)

	await expect(second.getByText('Rendered by SleepOutput (server)')).toBeVisible()
	await expect(second.getByText('Attempt #2 finished after 1500ms')).toBeVisible()
	// Succeeded: the wildcard error block must not appear.
	await expect(second.getByText('Error', { exact: true })).toHaveCount(0)
})

test('an unregistered task keeps the default JSON blocks', async ({ page }) => {
	await openSleepJob(page)
	const third = await expand(page, 3)

	// The third attempt is an `inline` step: no per-slug entry, and its wildcard
	// error slot has no value to render.
	await expect(third.locator('pre')).toHaveCount(2)
	await expect(third.locator('pre').first()).toContainText('"automationId": "demo"')
	await expect(third.locator('pre').last()).toContainText('"delivered": true')
	await expect(third.getByText('SleepInput (server)')).toHaveCount(0)
	await expect(third.getByRole('button', { name: 'Show raw error' })).toHaveCount(0)
})
