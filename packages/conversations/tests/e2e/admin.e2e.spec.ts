import { type Browser, expect, type Locator, type Page, test } from '@playwright/test'

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

/** A message's "⋯" menu, which shows on hover. */
const openMenu = async (message: Locator) => {
	await message.hover()
	await message.getByRole('button', { name: 'Message actions' }).click()
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

	test('the cue names the channel and switches to the other one', async ({ page }) => {
		await login(page, ME)
		await openDrawer(page)
		// Each channel's cue sits above the composer; with two channels it offers the other.
		const cue = page.locator(
			'.conversations-drawer > .conversations-composer .conversations-composer__banner'
		)
		await expect(cue).toContainText('staff only')
		await cue.getByRole('button', { name: 'Switch to Shared' }).click()
		await expect(page.locator('.conversations-tabs__tab--active')).toContainText('Shared')
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
		await page.locator('.conversations-menu__item', { hasText: 'Anna Keller' }).waitFor()
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
		await openMenu(message)
		await page.locator('.popup__content').getByText('Edit', { exact: true }).click()
		const editor = page.locator('.conversations-message [contenteditable="true"]')
		// The edit form loads its state from the server first; it focuses itself once there.
		await expect(editor).toBeFocused()
		await page.keyboard.press('End')
		await page.keyboard.type(' (edited)')
		await page.keyboard.press('Enter')
		const edited = page.locator('.conversations-message', { hasText: `${text} (edited)` }).last()
		await expect(edited.locator('.conversations-message__edited')).toBeVisible()

		await openMenu(edited)
		await page.locator('.popup__content').getByText('Delete', { exact: true }).click()
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

test.describe('chat example', () => {
	test('rooms, unread badges, sending and a thread in the side pane', async ({ page }) => {
		await login(page, ME)
		await page.goto('/admin/chat')
		const rooms = page.locator('.chat-app__room')
		await expect(rooms).toHaveText([/design/, /general/, /releases/, /winter-cup/])
		await expect(rooms.filter({ hasText: 'releases' }).locator('.chat-app__badge')).toHaveText('2')
		await page.screenshot({ path: 'test-results/chat-general.png' })

		await rooms.filter({ hasText: 'releases' }).click()
		await expect(page.locator('.chat-app__title')).toContainText('releases')
		await expect(
			page.locator('.conversations-message', { hasText: 'timing integration' })
		).toBeVisible()
		await expect(rooms.filter({ hasText: 'releases' }).locator('.chat-app__badge')).toHaveCount(0)

		await rooms.filter({ hasText: 'general' }).click()
		await send(page, `hello general ${Date.now()}`)
		await page
			.locator('.conversations-message', { hasText: 'review call' })
			.locator('.conversations-message__thread')
			.click()
		const thread = page.locator('.chat-app__thread')
		await expect(thread.locator('.conversations-message', { hasText: 'small room' })).toBeVisible()
		await thread.locator('[contenteditable="true"]').click()
		await page.keyboard.type('See you there')
		await page.keyboard.press('Enter')
		await expect(
			thread.locator('.conversations-message', { hasText: 'See you there' })
		).toBeVisible()
		await page.screenshot({ path: 'test-results/chat-thread.png' })
	})
})

test.describe('reactions extension', () => {
	test('a reaction shows at once and reaches another user', async ({ browser }) => {
		const me = await asUser(browser, ME)
		const anna = await asUser(browser, ANNA)
		for (const page of [me, anna]) await page.goto('/admin/chat')
		const text = `react here ${Date.now()}`
		await send(me, text)
		const mine = me.locator('.conversations-message', { hasText: text }).last()
		await openMenu(mine)
		await me.locator('.popup__content .conversations-reaction-row').getByText('🎉').click()
		await expect(mine.locator('.conversations-reactions__pill--mine')).toContainText('1')

		const theirs = anna.locator('.conversations-message', { hasText: text }).last()
		await expect(theirs.locator('.conversations-reactions__pill')).toContainText('🎉', {
			timeout: 30_000,
		})
		await theirs.locator('.conversations-reactions__pill').click()
		await expect(theirs.locator('.conversations-reactions__pill--mine')).toContainText('2')
	})
})
