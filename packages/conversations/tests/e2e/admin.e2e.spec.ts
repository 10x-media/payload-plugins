import { type Browser, expect, type Page, test } from '@playwright/test'

const PASSWORD = 'password'
const ME = 'dev@10xmedia.de'
const ANNA = 'anna@10xmedia.de'

const login = async (page: Page, email: string) => {
	await page.goto('/admin/login')
	await page.fill('#field-email', email)
	await page.fill('#field-password', PASSWORD)
	await page.click('button[type=submit]')
	await page.waitForURL('**/admin')
}

const personId = async (page: Page, name: string): Promise<string> => {
	const res = await page.request.get(
		`/api/persons?depth=0&limit=1&where[name][equals]=${encodeURIComponent(name)}`
	)
	const json = (await res.json()) as { docs: Array<{ id: string }> }
	const id = json.docs[0]?.id
	if (!id) throw new Error(`No person named ${name}`)
	return id
}

const openDrawer = async (page: Page, name = 'Jana Nováková') => {
	await page.goto(`/admin/collections/persons/${await personId(page, name)}`)
	await page.click('.conversations-trigger')
	await expect(
		page.locator('.conversations-composer [contenteditable="true"]').first()
	).toBeVisible()
}

const composer = (page: Page) =>
	page.locator('.conversations-composer [contenteditable="true"]').last()

const send = async (page: Page, text: string) => {
	await composer(page).click()
	await page.keyboard.type(text)
	await page.keyboard.press('Enter')
	await expect(page.locator('.conversations-message', { hasText: text }).last()).toBeVisible()
}

const asUser = async (browser: Browser, email: string) => {
	const context = await browser.newContext()
	const page = await context.newPage()
	await login(page, email)
	return page
}

test.describe('comments drawer', () => {
	test('the trigger opens the drawer and a sent message appears', async ({ page }) => {
		await login(page, ME)
		await openDrawer(page)
		await expect(page.locator('.conversations-drawer__title').first()).toHaveText('Comments')
		const text = `hello ${Date.now()}`
		await send(page, text)
		await expect(composer(page)).toHaveText('')
	})

	test('channel tabs switch feeds and show the channel cue', async ({ page }) => {
		await login(page, ME)
		await openDrawer(page)
		// Internal sets no cue, so nothing sits above its composer.
		await expect(
			page.locator(
				'.conversations-drawer > .conversations-composer .conversations-composer__banner'
			)
		).toHaveCount(0)
		await page.click('.conversations-tabs__tab >> text=Shared')
		await expect(page.locator('.conversations-composer__banner--warning')).toContainText(
			'visible to the customer'
		)
		await expect(
			page.locator('.conversations-message', { hasText: 'medical form' }).first()
		).toBeVisible()
	})

	test('long history loads earlier pages', async ({ page }) => {
		await login(page, ME)
		await openDrawer(page)
		const before = await page.locator('.conversations-message').count()
		await page.click('.conversations-feed__older >> text=Load earlier')
		await expect.poll(() => page.locator('.conversations-message').count()).toBeGreaterThan(before)
	})

	test('mentions work inside a thread stacked on the drawer', async ({ page }) => {
		await login(page, ME)
		await openDrawer(page)
		await page.locator('.conversations-message__thread').first().click()
		await expect(page.locator('.conversations-drawer__title', { hasText: 'Thread' })).toBeVisible()
		await composer(page).click()
		await page.keyboard.type('ping @Ann')
		await page.locator('.conversations-mention-menu__item', { hasText: 'Anna Keller' }).waitFor()
		await page.keyboard.press('Enter')
		const tail = ` ${Date.now()}`
		await page.keyboard.type(tail)
		await page.keyboard.press('Enter')
		const reply = page.locator('.conversations-thread .conversations-message', {
			hasText: tail.trim(),
		})
		await expect(reply.locator('.conversations-mention')).toHaveText('@Anna Keller')
	})

	test('the author edits and deletes a message', async ({ page }) => {
		await login(page, ME)
		await openDrawer(page)
		const text = `to edit ${Date.now()}`
		await send(page, text)
		const message = page.locator('.conversations-message', { hasText: text }).last()
		await message.hover()
		await message.locator('button', { hasText: 'Edit' }).click()
		const editor = page.locator('.conversations-message [contenteditable="true"]')
		// The edit form loads its state from the server first; it focuses itself once there.
		await expect(editor).toBeFocused()
		await page.keyboard.press('End')
		await page.keyboard.type(' (edited)')
		await page.keyboard.press('Enter')
		const edited = page.locator('.conversations-message', { hasText: `${text} (edited)` }).last()
		await expect(edited.locator('.conversations-message__edited')).toBeVisible()

		await edited.hover()
		await edited.locator('button', { hasText: 'Delete' }).click()
		await page.locator('.confirmation-modal').getByRole('button', { name: 'Delete' }).click()
		await expect(
			page.locator('.conversations-message', { hasText: `${text} (edited)` })
		).toHaveCount(0)
	})
})

test.describe('two users', () => {
	test('a message from one user reaches the other through polling', async ({ browser }) => {
		const me = await asUser(browser, ME)
		const anna = await asUser(browser, ANNA)
		await openDrawer(me)
		await openDrawer(anna)
		const text = `polled ${Date.now()}`
		await send(me, text)
		await expect(anna.locator('.conversations-message', { hasText: text })).toBeVisible({
			timeout: 30_000,
		})
	})

	test('the unread dot clears once the feed has been read', async ({ browser }) => {
		const me = await asUser(browser, ME)
		await openDrawer(me, 'Tomás Ruiz')
		await send(me, `for Anna ${Date.now()}`)

		const anna = await asUser(browser, ANNA)
		await anna.goto(`/admin/collections/persons/${await personId(anna, 'Tomás Ruiz')}`)
		await expect(anna.locator('.conversations-trigger__dot')).toBeVisible()
		await anna.click('.conversations-trigger')
		await expect(anna.locator('.conversations-message').first()).toBeVisible()
		await anna.keyboard.press('Escape')
		await anna.reload()
		await expect(anna.locator('.conversations-trigger')).toBeVisible()
		await expect(anna.locator('.conversations-trigger__dot')).toHaveCount(0)
	})
})
