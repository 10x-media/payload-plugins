import { expect, test } from '@playwright/test'

const EMAIL = 'dev@10xmedia.de'
const PASSWORD = 'password'

const login = async (page: import('@playwright/test').Page) => {
	await page.goto('/admin/login')
	await page.fill('#field-email', EMAIL)
	await page.fill('#field-password', PASSWORD)
	await page.click('button[type="submit"]')
	await page.waitForURL('**/admin')
}

test('admin panel loads with webhooks plugin enabled', async ({ page }) => {
	const response = await page.goto('/admin')
	expect(response?.status()).toBeLessThan(500)
	await expect(page.locator('body')).toBeVisible()
})

test('creating a post produces a successful delivery', async ({ page }) => {
	await login(page)
	await page.goto('/admin/collections/posts/create')
	await page.fill('#field-title', 'E2E Post')
	const saveResponse = page.waitForResponse(
		(r) => r.url().includes('/api/posts') && r.request().method() === 'POST'
	)
	await page.click('#action-save')
	await saveResponse
	await page.waitForURL('**/admin/collections/posts/**')

	await page.goto('/admin/collections/webhook-deliveries')
	await page.waitForLoadState('networkidle')
	await expect(page.getByText('posts.created').first()).toBeVisible({ timeout: 15_000 })
	await expect(page.getByText('Delivered').first()).toBeVisible()
})

test('redeliver creates a second delivery', async ({ page }) => {
	await login(page)
	await page.goto('/admin/collections/webhook-deliveries')
	await page.waitForLoadState('networkidle')
	const rowsBefore = await page.locator('tbody tr').count()
	await page.locator('tbody tr').first().getByRole('link').first().click()
	await page.waitForURL('**/admin/collections/webhook-deliveries/**')
	await page.getByRole('button', { name: 'Redeliver' }).click()
	await expect(page.getByText('Redelivery queued')).toBeVisible()
	await page.goto('/admin/collections/webhook-deliveries')
	await page.waitForLoadState('networkidle')
	await expect(page.locator('tbody tr')).toHaveCount(rowsBefore + 1)
})

/**
 * The rotate action is the only user-facing surface of secret rotation, and the one moment the
 * new secret exists in readable form anywhere. Both dialogs are asserted: the confirmation,
 * because rotation starts the clock on the secret every receiver is using today and a stray click
 * must not begin it, and the reveal, because a secret shown in something a stray click dismisses
 * is a secret the operator loses.
 */
test('rotating a secret confirms first, then reveals the new secret in a dialog', async ({
	page,
}) => {
	await login(page)
	await page.goto('/admin/collections/webhook-subscriptions')
	await page.waitForLoadState('networkidle')
	await page.locator('tbody tr').first().getByRole('link').first().click()
	await page.waitForURL('**/admin/collections/webhook-subscriptions/**')

	await page.getByRole('button', { name: 'Rotate secret' }).click()
	await expect(page.getByText('Rotate signing secret')).toBeVisible()

	// Cancelling must leave the secret alone.
	await page.getByRole('button', { name: 'Cancel' }).click()
	await expect(page.getByText('New signing secret')).toBeHidden()

	await page.getByRole('button', { name: 'Rotate secret' }).click()
	await page.locator('#confirm-action').click()

	await expect(page.getByText('New signing secret')).toBeVisible({ timeout: 15_000 })
	const revealed = page.locator('#field-webhooksRotatedSecret')
	await expect(revealed).toHaveValue(/^whsec_/)
	// Read-only rather than disabled, so the text stays selectable when the clipboard API is
	// unavailable and the copy falls back to a manual one.
	await expect(revealed).toHaveAttribute('readonly', '')
	await expect(revealed).not.toBeDisabled()

	// The copy action lives inside the input, over its trailing edge.
	const copy = page.getByRole('button', { name: 'Copy' })
	await expect(copy).toBeVisible()
	const field = await revealed.boundingBox()
	const button = await copy.boundingBox()
	if (!field || !button) {
		throw new Error('no bounding box for the revealed secret')
	}
	expect(button.x + button.width).toBeLessThanOrEqual(field.x + field.width + 1)
	expect(button.x).toBeGreaterThan(field.x)
	await copy.click()

	await page.getByRole('button', { name: "I've saved it" }).click()
	await expect(page.getByText('New signing secret')).toBeHidden()

	// The rotation landed: the grace window is now shown on the document.
	await expect(page.locator('#field-previousSecretExpiresAt')).not.toHaveValue('', {
		timeout: 15_000,
	})
})

test('the signing secret is never rendered in the document form', async ({ page }) => {
	await login(page)
	await page.goto('/admin/collections/webhook-subscriptions')
	await page.waitForLoadState('networkidle')
	await page.locator('tbody tr').first().getByRole('link').first().click()
	await page.waitForURL('**/admin/collections/webhook-subscriptions/**')

	// Write-only storage strips the value from every read, so nothing on the page can show it.
	await expect(page.locator('body')).not.toContainText('whsec_')
})

/**
 * The encrypted field's own Replace and Generate actions do not consult Payload's `readOnly`, so
 * on an existing document they would be live controls over a write that field access drops. The
 * field is create-only for that reason, leaving exactly one way to change a stored secret.
 */
test('an existing subscription offers rotation as the only way to change its secret', async ({
	page,
}) => {
	await login(page)
	await page.goto('/admin/collections/webhook-subscriptions')
	await page.waitForLoadState('networkidle')
	await page.locator('tbody tr').first().getByRole('link').first().click()
	await page.waitForURL('**/admin/collections/webhook-subscriptions/**')

	await expect(page.getByRole('button', { name: 'Rotate secret' })).toBeVisible()
	await expect(page.getByLabel('Replace value')).toBeHidden()
	await expect(page.getByLabel('Generate new value')).toBeHidden()
})

test('the create form offers Generate, where the value can still be copied', async ({ page }) => {
	await login(page)
	await page.goto('/admin/collections/webhook-subscriptions/create')
	await expect(page.getByLabel('Generate new value')).toBeVisible()
	// Rotation needs a saved document, so its control is not offered here.
	await expect(page.getByRole('button', { name: 'Rotate secret' })).toBeHidden()
})
