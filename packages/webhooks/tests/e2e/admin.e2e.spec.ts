import { expect, type Page, test } from '@playwright/test'

const EMAIL = 'dev@10xmedia.de'
const PASSWORD = 'password'

/**
 * Signs in over REST, which sets the auth cookie in the browser context. The login form has a
 * "Show password" button now, so a label match on the password field is ambiguous.
 */
const login = async (page: Page) => {
	const res = await page.request.post('/api/users/login', {
		data: { email: EMAIL, password: PASSWORD },
	})
	expect(res.ok()).toBe(true)
}

/**
 * Payload 4 keeps closed dialogs mounted, and this page holds several, so the open one is the
 * visible one. Its confirm button is `DialogConfirm`'s.
 */
const openDialog = (page: Page) => page.locator('dialog:visible .dialog')
const confirmDialog = (page: Page) =>
	openDialog(page).locator('[data-dialog-action="confirm"]').click()

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
	// The dev sink verifies the signature with the reference Standard Webhooks library and answers
	// 401 otherwise, so "Delivered" here also means the delivery was signed correctly.
	await expect(page.getByText('Delivered').first()).toBeVisible()
})

/**
 * A redelivery goes out under a fresh `webhook-id`, so a receiver that dedupes on the id processes
 * it again. The confirmation is what keeps a stray click from causing that.
 */
test('redeliver confirms first, then creates a second delivery', async ({ page }) => {
	await login(page)
	await page.goto('/admin/collections/webhook-deliveries')
	await page.waitForLoadState('networkidle')
	const rowsBefore = await page.locator('tbody tr').count()
	await page.locator('tbody tr').first().getByRole('link').first().click()
	await page.waitForURL('**/admin/collections/webhook-deliveries/**')
	await page.getByRole('button', { name: 'Redeliver' }).click()
	await expect(page.getByText('Send this payload again?')).toBeVisible()
	await confirmDialog(page)
	// The dev app delivers inline, so the replay has already been sent by the time it answers.
	await expect(page.getByText('Redelivered')).toBeVisible()
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
	await openDialog(page).getByRole('button', { name: 'Cancel' }).click()
	await expect(page.getByText('New signing secret')).toBeHidden()

	await page.getByRole('button', { name: 'Rotate secret' }).click()
	await confirmDialog(page)

	await expect(page.getByText('New signing secret')).toBeVisible({ timeout: 15_000 })
	const revealed = page.locator('#field-webhooksRotatedSecret')
	await expect(revealed).toHaveValue(/^whsec_/)
	// Read-only rather than disabled, so the text stays selectable when the clipboard API is
	// unavailable and the copy falls back to a manual one.
	await expect(revealed).toHaveAttribute('readonly', '')
	await expect(revealed).not.toBeDisabled()

	// Escape closes the latest modal everywhere else in the admin. Here it would throw away the
	// only copy of the secret without the acknowledgement, so it has to do nothing.
	await page.keyboard.press('Escape')
	await expect(page.getByText('New signing secret')).toBeVisible()
	await expect(revealed).toHaveValue(/^whsec_/)

	// The copy action lives inside the input, over its trailing edge.
	const copy = openDialog(page).getByRole('button', { name: 'Copy' })
	await expect(copy).toBeVisible()
	const field = await revealed.boundingBox()
	const button = await copy.boundingBox()
	if (!field || !button) {
		throw new Error('no bounding box for the revealed secret')
	}
	expect(button.x + button.width).toBeLessThanOrEqual(field.x + field.width + 1)
	expect(button.x).toBeGreaterThan(field.x)
	await copy.click()

	await openDialog(page).getByRole('button', { name: "I've saved it" }).click()
	await expect(page.getByText('New signing secret')).toBeHidden()

	// The rotation landed: the grace window is now shown on the document.
	await expect(page.locator('#field-previousSecretExpiresAt input')).not.toHaveValue('', {
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

	// With the editor gone, the hint is what says which key this subscription holds: the gap
	// marker and the last characters, never the secret, and not editable.
	const hint = page.locator('#field-secret_hint')
	await expect(hint).toHaveValue(/^·{4}\S{6}$/)
	await expect(hint).toBeDisabled()
})

test('the create form offers Generate, where the value can still be copied', async ({ page }) => {
	await login(page)
	await page.goto('/admin/collections/webhook-subscriptions/create')
	await expect(page.getByLabel('Generate new value')).toBeVisible()
	// Rotation needs a saved document, so its control is not offered here.
	await expect(page.getByRole('button', { name: 'Rotate secret' })).toBeHidden()
})
