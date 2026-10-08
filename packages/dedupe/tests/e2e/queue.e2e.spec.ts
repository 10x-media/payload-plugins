import { expect, test } from '@playwright/test'

import {
	cleanup,
	createCustomer,
	findPair,
	login,
	MARK,
	matchingPair,
	mergeButton,
	openMerge,
	openQueue,
	QUEUE_PATH,
	queueRow,
	queueTab,
} from './helpers'

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

test('a saved duplicate reaches the queue with its score and signals', async ({
	page,
	context,
}) => {
	const [a, b] = matchingPair('alpha')
	const left = await createCustomer(context.request, a)
	const right = await createCustomer(context.request, b)

	const pair = await findPair(context.request, [left.id, right.id])
	expect(pair, 'the save hook should have stored the pair').toBeDefined()
	expect(pair?.score).toBeGreaterThan(0.5)

	const kinds = Object.fromEntries(
		(pair?.signals ?? []).map((signal) => [signal.path, signal.kind])
	)
	expect(kinds).toEqual({
		name: 'similar',
		phone: 'match',
		birthDate: 'match',
	})

	await openQueue(page)
	const row = queueRow(page, `${MARK} alpha Kowalska`)
	await expect(row).toBeVisible()
	await expect(row.locator('.dedupe-queue__score')).toContainText(
		`${Math.round((pair?.score ?? 0) * 100)}%`
	)
	await expect(row.getByRole('link')).toContainText(`${MARK} alpha Kowalski`)
})

test('says why two documents match by what they share, and leaves empty fields out', async ({
	page,
	context,
}) => {
	const [a, b] = matchingPair('sparse', {
		a: { birthDate: undefined },
		b: { birthDate: undefined },
	})
	const left = await createCustomer(context.request, a)
	const right = await createCustomer(context.request, b)

	const pair = await findPair(context.request, [left.id, right.id])
	expect(pair, 'name and phone alone should still clear the threshold').toBeDefined()
	expect((pair?.signals ?? []).map((signal) => signal.path).sort()).toEqual(['name', 'phone'])

	await openQueue(page)
	const why = queueRow(page, `${MARK} sparse Kowalska`).locator('.dedupe-signals')
	await expect(why).toContainText('Same Phone')
	await expect(why).toContainText('Similar Name')
	await expect(why).not.toContainText('Email')
	await expect(why).not.toContainText('Birth Date')
})

test('marking a pair not duplicates on the merge screen moves it to its tab, and reopening brings it back', async ({
	page,
	context,
}) => {
	const [a, b] = matchingPair('bravo')
	const left = await createCustomer(context.request, a)
	const right = await createCustomer(context.request, b)

	await openQueue(page)
	const openTab = queueTab(page, 'Open')
	const before = Number((await openTab.innerText()).replace(/\D/g, ''))
	await queueRow(page, `${MARK} bravo Kowalska`).getByRole('link').click()
	await expect(page.locator('.dedupe-merge__grid')).toBeVisible()

	await page
		.locator('.dedupe-merge__footer')
		.getByRole('button', { name: 'Not duplicates' })
		.click()
	await expect(page).toHaveURL(/\/admin\/dedupe\?collection=customers$/)
	await expect(queueRow(page, `${MARK} bravo Kowalska`)).toHaveCount(0)
	await expect(openTab).toHaveText(new RegExp(`Open\\s*${before - 1}$`))
	expect((await findPair(context.request, [left.id, right.id], 'dismissed'))?.status).toBe(
		'dismissed'
	)

	await openQueue(page, 'dismissed')
	const dismissed = queueRow(page, `${MARK} bravo Kowalska`)
	await expect(dismissed).toContainText('dev@10xmedia.de')
	await dismissed.getByRole('link').click()
	await expect(page.getByText(/Marked as not duplicates by dev@10xmedia\.de/)).toBeVisible()
	// A group marked not duplicates is reopened before it can be merged, from the footer only.
	await expect(mergeButton(page)).toHaveCount(0)
	await expect(page.getByRole('button', { name: 'Reopen' })).toHaveCount(1)
	await page.locator('.dedupe-merge__footer').getByRole('button', { name: 'Reopen' }).click()
	await expect(page.getByText(/Marked as not duplicates by/)).toHaveCount(0)
	await expect(mergeButton(page)).toBeVisible()
	expect((await findPair(context.request, [left.id, right.id]))?.status).toBe('open')
})

test('a group marked not duplicates leaves the tab while a document is in the trash', async ({
	page,
	context,
}) => {
	const [a, b] = matchingPair('binned')
	const left = await createCustomer(context.request, a)
	const right = await createCustomer(context.request, b)
	const dismissed = await context.request.post('/api/dedupe/dismiss', {
		data: { collection: 'customers', docs: [left.id, right.id] },
	})
	expect(dismissed.ok(), `dismiss failed: ${dismissed.status()}`).toBe(true)
	const trashed = await context.request.patch(`/api/customers/${right.id}`, {
		data: { deletedAt: new Date().toISOString() },
	})
	expect(trashed.ok(), `trash failed: ${trashed.status()}`).toBe(true)

	await openQueue(page, 'dismissed')
	const row = queueRow(page, `${MARK} binned Kowalska`)
	await expect(row).toHaveCount(0)

	const restored = await context.request.patch(`/api/customers/${right.id}?trash=true`, {
		data: { deletedAt: null },
	})
	expect(restored.ok(), `restore failed: ${restored.status()}`).toBe(true)
	await openQueue(page, 'dismissed')
	await expect(row).toBeVisible()
	await expect(row.getByRole('link')).toHaveCount(1)
})

test('each status tab counts the rows it lists, one per group', async ({ page, context }) => {
	const [a, b] = matchingPair('charlie')
	await createCustomer(context.request, a)
	await createCustomer(context.request, b)

	await openQueue(page)
	await expect(page.locator('.default-list-view-tabs__button')).toHaveCount(2)
	for (const [label, status] of [
		['Open', 'open'],
		['Not duplicates', 'dismissed'],
	] as const) {
		// One page of the largest size holds every row the dev seed and this suite make.
		await page.goto(`${QUEUE_PATH}?collection=customers&status=${status}&limit=100`)
		await expect(page.locator('.dedupe-queue__table, .dedupe-queue__message').first()).toBeVisible()
		const rows = await page.locator('.dedupe-queue__table tbody tr').count()
		await expect(queueTab(page, label)).toHaveText(new RegExp(`${label}\\s*${rows}$`))
	}
})

test('documents alike in a chain are one row, and it opens them all', async ({ page, context }) => {
	const [a, b] = matchingPair('delta')
	await createCustomer(context.request, a)
	await createCustomer(context.request, b)
	await createCustomer(context.request, {
		...b,
		name: `${MARK} delta Kowalsky`,
		email: 'delta.c@e2e.test',
	})

	await openQueue(page)
	const row = queueRow(page, `${MARK} delta Kowalska`)
	await expect(row).toHaveCount(1)
	await expect(row).toContainText(`${MARK} delta Kowalsky`)
	await row.getByRole('link').click()
	await expect(page.locator('.dedupe-merge__head')).toHaveCount(3)
})

test('a group larger than one merge says so in its row, and the merge screen counts the rest', async ({
	page,
	context,
}) => {
	const [a, b] = matchingPair('golf')
	await createCustomer(context.request, a)
	for (const [index, name] of [
		'Kowalski',
		'Kowalsky',
		'Kovalski',
		'Kovalska',
		'Kowalskaja',
		'Kowalskaya',
	].entries()) {
		await createCustomer(context.request, {
			...b,
			name: `${MARK} golf ${name}`,
			email: `golf.${index}@e2e.test`,
		})
	}

	await openQueue(page)
	const row = queueRow(page, `${MARK} golf Kowalska`)
	await expect(row.locator('.cell-size')).toHaveText('7, up to 5 per merge')
	await row.getByRole('link').click()
	await expect(page.locator('.dedupe-merge__head')).toHaveCount(5)
	await expect(page.getByText('Similar documents not on this screen: 2.')).toBeVisible()
})
test('the search bar keeps the groups with a document the list search of the collection finds', async ({
	page,
	context,
}) => {
	for (const label of ['foxtrot', 'golf']) {
		const [a, b] = matchingPair(label)
		await createCustomer(context.request, a)
		await createCustomer(context.request, b)
	}

	await openQueue(page)
	const search = page.locator('.search-bar .search-filter__input')
	// Worded and searched as the customers list does it, by its listSearchableFields.
	await expect.soft(search).toHaveAttribute('placeholder', 'Search by Name Or Email')
	await search.fill('golf@e2e')
	await expect(page).toHaveURL(/search=golf%40e2e/)
	// The whole group, also the document without that email.
	await expect(queueRow(page, `${MARK} golf Kowalska`)).toBeVisible()
	await expect(queueRow(page, `${MARK} foxtrot Kowalska`)).toHaveCount(0)
	await expect(queueTab(page, 'Open')).toHaveText(/Open\s*1$/)

	await page.reload()
	await expect(search).toHaveValue('golf@e2e')
	await expect(queueRow(page, `${MARK} foxtrot Kowalska`)).toHaveCount(0)
})

test("a status tab's count stands apart from its label and shows on the active tab, as the Versions tab's does", async ({
	page,
}) => {
	await openQueue(page)
	for (const label of ['Open', 'Not duplicates']) {
		const tab = queueTab(page, label)
		const look = await tab.evaluate((button) => {
			const pill = button.querySelector('.pill-version-count') as HTMLElement
			const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
			const text = walker.nextNode() as Text
			const range = document.createRange()
			range.selectNodeContents(text)
			return {
				gap: pill.getBoundingClientRect().left - range.getBoundingClientRect().right,
				pill: getComputedStyle(pill).backgroundColor,
				tab: getComputedStyle(button).backgroundColor,
				active: button.classList.contains('default-list-view-tabs__button--active'),
			}
		})
		expect.soft(look.gap, `the gap after "${label}"`).toBeGreaterThanOrEqual(3)
		if (label === 'Open') {
			expect(look.active, 'the queue opens on Open').toBe(true)
			expect.soft(look.pill, 'the count on the active tab').not.toBe(look.tab)
		}
	}
})

test("the queue names its collection filter in the breadcrumbs, the level the merge screen's lead back to", async ({
	page,
	context,
}) => {
	const [a, b] = matchingPair('hotel')
	const left = await createCustomer(context.request, a)
	const right = await createCustomer(context.request, b)
	await openMerge(page, { docs: [left.id, right.id] })

	await page.locator('.step-nav').getByRole('link', { name: 'Customers' }).click()
	await expect(page).toHaveURL(/collection=customers/)
	await expect(page.locator('.step-nav__last')).toHaveText('Customers')
	const queue = page.locator('.step-nav').getByRole('link', { name: 'Duplicates' })
	await expect(queue).toHaveAttribute('href', QUEUE_PATH)

	await queue.click()
	await expect(page.locator('.step-nav__last')).toHaveText('Duplicates')
})

test('an empty status says so instead of showing an empty table', async ({ page }) => {
	await openQueue(page, 'dismissed')
	const table = page.locator('.dedupe-queue__table')
	const message = page.locator('.dedupe-queue__message')
	if ((await table.count()) === 0) {
		await expect(message).toHaveText('Nothing to review.')
	} else {
		await expect(table.locator('tbody tr').first()).toBeVisible()
	}
})

test('a scan reports what it compared and refreshes the list', async ({ page, context }) => {
	const [a, b] = matchingPair('delta')
	await createCustomer(context.request, a)
	await createCustomer(context.request, b)

	await openQueue(page)
	await page.getByRole('button', { name: 'Scan now' }).click()
	await expect(page.getByText(/Scan finished: \d+ open pairs from \d+ comparisons\./)).toBeVisible({
		timeout: 60_000,
	})
	await expect(queueRow(page, `${MARK} delta Kowalska`)).toBeVisible()
})

test('a row opens its pair on the merge screen', async ({ page, context }) => {
	const [a, b] = matchingPair('echo')
	const left = await createCustomer(context.request, a)
	const right = await createCustomer(context.request, b)

	await openQueue(page)
	await queueRow(page, `${MARK} echo Kowalska`).getByRole('link').click()
	await expect(page).toHaveURL(/\/admin\/dedupe\/merge\?/)
	const docs = new URL(page.url()).searchParams.get('docs')?.split(',') ?? []
	expect(docs.sort()).toEqual([left.id, right.id].sort())
})
