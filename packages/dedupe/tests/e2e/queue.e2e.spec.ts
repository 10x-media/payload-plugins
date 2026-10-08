import { expect, test } from '@playwright/test'

import {
	cleanup,
	createCustomer,
	findPair,
	login,
	MARK,
	matchingPair,
	mergeButton,
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

test('a group marked not duplicates with a document in the trash is listed without a link', async ({
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
	await expect(row).toBeVisible()
	await expect(row.getByRole('link')).toHaveCount(0)
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
