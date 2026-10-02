import { expect, type Page, test } from '@playwright/test'

import {
	ADMIN_ROUTE,
	type Customer,
	type CustomerInput,
	cell,
	cleanup,
	createCustomer,
	fieldLabel,
	findPair,
	login,
	MARK,
	MERGE_PATH,
	mergeButton,
	openMerge,
	patchCustomer,
	pick,
	QUEUE_PATH,
	readCustomer,
} from './helpers'

/**
 * Three records of the same person that differ in every way the plugin has to handle: a
 * field only some filled, a straight conflict, two kinds of list, and the one field the dev
 * config forces to `manual`. Created in order, so the last is the newest.
 */
const groupOf = (label: string): [CustomerInput, CustomerInput, CustomerInput] => [
	{
		name: `${MARK} ${label} Kowalska`,
		phone: '+380 50 111 22 33',
		birthDate: '1990-05-15T00:00:00.000Z',
		tags: ['vip'],
		vip: true,
		addresses: [{ city: 'Kyiv', street: 'Khreshchatyk 1' }],
		profile: { score: 7 },
		note: 'from A',
	},
	{
		name: `${MARK} ${label} Kowalski`,
		email: `${label}.b@e2e.test`,
		phone: '+380 50 111 22 33',
		birthDate: '1990-05-15T00:00:00.000Z',
		tags: ['newsletter', 'vip'],
		addresses: [{ city: 'Lviv', street: 'Rynok 1' }],
		profile: { score: 9 },
		note: 'from B',
	},
	{
		name: `${MARK} ${label} Kowalsky`,
		email: `${label}.c@e2e.test`,
		phone: '+380 50 111 22 33',
		birthDate: '1990-05-15T00:00:00.000Z',
		tags: ['events'],
		profile: { score: 7 },
		note: 'from C',
	},
]

const seedGroup = async (
	request: Parameters<typeof createCustomer>[0],
	label: string,
	size: 2 | 3 = 3
): Promise<Customer[]> => {
	const docs: Customer[] = []
	for (const input of groupOf(label).slice(0, size)) {
		docs.push(await createCustomer(request, input))
	}
	return docs
}

const ids = (docs: Customer[]) => docs.map((doc) => doc.id)

/** The "More options" button of the column whose document is named `name`. */
const columnMenu = (page: Page, name: string) =>
	page
		.locator('.dedupe-merge__head', { hasText: name })
		.getByRole('button', { name: 'More options' })

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

test('the matrix has one column per document, the primary first, each named and dated', async ({
	page,
	context,
}) => {
	const [a, b, c] = await seedGroup(context.request, 'columns')
	await openMerge(page, { docs: ids([a, b, c] as Customer[]) })

	await expect(page.locator('.dedupe-merge__header h1')).toHaveText(
		`Merge into ${MARK} columns Kowalska`
	)
	const heads = page.locator('.dedupe-merge__head')
	await expect(heads).toHaveCount(3)
	await expect(heads.nth(0)).toHaveClass(/dedupe-merge__head--survivor/)
	await expect(heads.nth(1)).not.toHaveClass(/dedupe-merge__head--survivor/)
	for (const [index, doc] of [a, b, c].entries()) {
		await expect(heads.nth(index).locator('.dedupe-merge__head-name')).toHaveText(String(doc?.name))
		await expect(heads.nth(index).locator('.dedupe-merge__head-meta')).toContainText('Updated')
	}
	// Both dates on one line, the exact time on hover.
	const meta = heads.nth(0).locator('.dedupe-merge__head-meta')
	expect(
		await meta.evaluate(
			(node) =>
				node.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(node).lineHeight)
		)
	).toBeLessThan(1.5)
	await expect(meta.locator('[title]').first()).toHaveAttribute('title', /\d{2}:\d{2}:\d{2}$/)
	await expect(mergeButton(page)).toHaveText('Merge 3 documents')
})

test('identical fields are hidden until the reviewer turns off only differences', async ({
	page,
	context,
}) => {
	const group = await seedGroup(context.request, 'hidden')
	await openMerge(page, { docs: ids(group) })

	for (const label of ['Name', 'Email', 'Note', 'Score']) {
		await expect(fieldLabel(page, label).first(), `${label} differs`).toBeVisible()
	}
	await expect(fieldLabel(page, 'Phone'), 'the same on every document').toHaveCount(0)

	await page.locator('#dedupe-only-differences').click()
	await expect(fieldLabel(page, 'Phone')).toBeVisible()
})

test('a field the primary left empty is filled from the newest document, with no status label', async ({
	page,
	context,
}) => {
	const [a, b, c] = (await seedGroup(context.request, 'filled')) as [Customer, Customer, Customer]
	await openMerge(page, { docs: ids([a, b, c]) })

	await expect(cell(page, 'email', a.id)).toContainText('empty')
	await expect(cell(page, 'email', c.id), 'the newest of the two that have one').toHaveClass(
		/dedupe-merge__cell--picked/
	)
	await expect(fieldLabel(page, 'Email').locator('.pill')).toHaveCount(0)
})

test('a conflict keeps the primary value and marks only what differs', async ({
	page,
	context,
}) => {
	const [a, b, c] = (await seedGroup(context.request, 'conflict')) as [Customer, Customer, Customer]
	await openMerge(page, { docs: ids([a, b, c]) })

	await expect(cell(page, 'note', a.id)).toHaveClass(/dedupe-merge__cell--picked/)
	await expect(fieldLabel(page, 'Note').locator('.pill')).toHaveCount(0)
	await expect(cell(page, 'note', b.id)).toContainText('from B')
	// With "Highlight differences" on, another document's cell marks what differs from the primary.
	await expect(cell(page, 'note', b.id).locator('[data-match-type]').first()).toBeVisible()
	await expect(page.locator('.dedupe-merge__stats')).not.toContainText(/conflicts|filled in/)
})

test('a list keeps the primary items and takes the ones checked in other documents', async ({
	page,
	context,
}) => {
	const [a, b, c] = (await seedGroup(context.request, 'lists')) as [Customer, Customer, Customer]
	await patchCustomer(context.request, b.id, {
		addresses: [
			{ city: 'Lviv', street: 'Rynok 1' },
			{ city: 'Odesa', street: 'Derybasivska 1' },
			{ city: 'Kharkiv', street: 'Sumska 1' },
		],
	})
	await openMerge(page, { docs: ids([a, b, c]) })
	const check = (key: string, doc: Customer, index: number) =>
		page.locator(`[id="dedupe-${key}-${doc.id}-${index}"]`)
	const item = (key: string, doc: Customer, index: number) =>
		page.locator(`.dedupe-merge__item:has([id="dedupe-${key}-${doc.id}-${index}"])`)

	await expect(check('tags', a, 0)).toBeChecked()
	await expect(check('tags', b, 0)).not.toBeChecked()
	// vip is in both: taken once, from whichever document has it checked, the other one locked.
	await expect(check('tags', b, 1)).toBeChecked()
	await expect(check('tags', b, 1)).toBeDisabled()
	await expect(item('tags', b, 1)).toHaveAttribute('title', `Taken from ${a.name}`)
	await check('tags', a, 0).click()
	await expect(check('tags', b, 1)).toBeEnabled()
	await expect(check('tags', b, 1)).not.toBeChecked()
	await check('tags', b, 1).click()
	await expect(check('tags', a, 0)).toBeChecked()
	await expect(check('tags', a, 0)).toBeDisabled()
	await expect(item('tags', a, 0)).toHaveAttribute('title', `Taken from ${b.name}`)
	await check('tags', b, 1).click()
	await expect(check('tags', a, 0)).toBeEnabled()
	await check('tags', a, 0).click()
	await expect(check('tags', b, 1)).toBeDisabled()
	await expect(check('addresses', a, 0)).toBeChecked()
	await expect(check('addresses', b, 0)).not.toBeChecked()
	await expect(
		page.locator(`[id^="dedupe-addresses-${c.id}-"]`),
		'an empty list has nothing to add'
	).toHaveCount(0)
	const height = (locator: ReturnType<typeof page.locator>) =>
		locator.evaluate((node) => Math.round(node.getBoundingClientRect().height))
	const emptyRows = fieldLabel(page, 'Addresses').locator('xpath=following-sibling::*[3]')
	await expect(emptyRows).toContainText('empty')
	expect(
		await height(emptyRows),
		'an empty array is as tall as one row, not the whole row of cells'
	).toBe(await height(page.locator(`.array-field__row:has([id="dedupe-addresses-${a.id}-0"])`)))

	await check('tags', b, 0).click()
	await check('addresses', b, 0).click()
	await pick(page, 'profile.score', a.id)
	await mergeButton(page).click()
	await page
		.locator('.payload__modal-item')
		.getByRole('button', { name: 'Merge 3 documents' })
		.click()
	await expect(page).toHaveURL(new RegExp(`/admin/collections/customers/${a.id}`), {
		timeout: 30_000,
	})
	const merged = (await readCustomer(context.request, a.id)).doc
	expect(merged?.tags).toEqual(['vip', 'newsletter'])
	expect((merged?.addresses as { city: string }[]).map((entry) => entry.city)).toEqual([
		'Kyiv',
		'Lviv',
	])
})

test('array rows are the admin rows, read-only, and the same row in two documents is taken twice', async ({
	page,
	context,
}) => {
	const [a, b] = groupOf('rows')
	const docs = [
		await createCustomer(context.request, a),
		await createCustomer(context.request, {
			...b,
			addresses: [
				{ city: 'Kyiv', street: 'Khreshchatyk 1' },
				{ city: 'Lviv', street: 'Rynok 1' },
			],
		}),
	] as [Customer, Customer]
	const [first, second] = docs
	await openMerge(page, { docs: ids(docs) })
	const check = (doc: Customer, index: number) =>
		page.locator(`[id="dedupe-addresses-${doc.id}-${index}"]`)
	const row = (doc: Customer, index: number) =>
		page.locator(`.array-field__row:has([id="dedupe-addresses-${doc.id}-${index}"])`)

	await expect(row(second, 1).locator('.array-field__row-header')).toContainText('Lviv')
	await row(second, 1).locator('.collapsible__toggle').click()
	const city = row(second, 1).locator('#field-addresses__1__city')
	await expect(city).toHaveValue('Lviv')
	await expect(city).toBeDisabled()

	await expect(check(first, 0)).toBeChecked()
	await expect(check(second, 0), 'rows are not compared, so none is locked').toBeEnabled()
	await expect(check(second, 0)).not.toBeChecked()
	await check(second, 0).click()
	await expect(check(second, 0)).toBeChecked()
	await expect(check(first, 0)).toBeEnabled()

	await pick(page, 'profile.score', first.id)
	await mergeButton(page).click()
	await page
		.locator('.payload__modal-item')
		.getByRole('button', { name: 'Merge 2 documents' })
		.click()
	await expect(page).toHaveURL(new RegExp(`/admin/collections/customers/${first.id}`), {
		timeout: 30_000,
	})
	const merged = (await readCustomer(context.request, first.id)).doc
	expect((merged?.addresses as { city: string }[]).map((entry) => entry.city)).toEqual([
		'Kyiv',
		'Kyiv',
	])
})

test('a list value with no spaces wraps inside its column instead of widening the table', async ({
	page,
	context,
}) => {
	const unbroken = 'a-tag-with-no-spaces'.repeat(12)
	const [a, b] = groupOf('wrap')
	const docs = [
		await createCustomer(context.request, a),
		await createCustomer(context.request, { ...b, tags: [unbroken] }),
	]
	await openMerge(page, { docs: ids(docs) })
	await expect(page.locator('.dedupe-merge__item', { hasText: unbroken })).toBeVisible()
	expect(
		await page
			.locator('.dedupe-merge__grid')
			.evaluate((grid) => grid.scrollWidth - grid.clientWidth)
	).toBe(0)
})

test('rich text is drawn as the version view draws it, headings and bold kept', async ({
	page,
	context,
}) => {
	const text = (value: string, format = 0) => ({
		type: 'text',
		text: value,
		format,
		style: '',
		mode: 'normal',
		detail: 0,
		version: 1,
	})
	const node = (type: string, children: unknown[], extra: Record<string, unknown> = {}) => ({
		type,
		children,
		direction: 'ltr',
		format: '',
		indent: 0,
		version: 1,
		...extra,
	})
	const specimen = async (label: string, ...children: unknown[]) => {
		const response = await context.request.post('/api/specimens', {
			data: {
				title: `${MARK} rich`,
				email: `rich.${label}@e2e.test`,
				notes: { root: node('root', children) },
			},
		})
		expect(response.ok(), `create failed: ${response.status()}`).toBe(true)
		return ((await response.json()) as { doc: { id: string } }).doc.id
	}
	const docs = [
		await specimen(
			'a',
			node('heading', [text('Opening hours')], { tag: 'h2' }),
			node('paragraph', [text('Open '), text('daily', 1)], { textFormat: 0 })
		),
		await specimen('b', node('paragraph', [text('Open weekly')], { textFormat: 0 })),
	]
	try {
		await page.goto(`${MERGE_PATH}?collection=specimens&docs=${docs.join(',')}&survivor=${docs[0]}`)
		const notes = page.locator(`label[for="dedupe-notes-${docs[0]}"]`)
		await expect(notes.locator('h2')).toHaveText('Opening hours')
		await expect(notes.locator('strong')).toHaveText('daily')
	} finally {
		for (const id of docs) await context.request.delete(`/api/specimens/${id}?trash=false`)
	}
})

test('what a merged-in document gives up is said in red, only for a document that gives something up', async ({
	page,
	context,
}) => {
	const [a, b, c] = (await seedGroup(context.request, 'release')) as [Customer, Customer, Customer]
	await openMerge(page, { docs: ids([a, b, c]) })
	await pick(page, 'email', b.id)

	const releases = page.locator('.dedupe-merge__releases')
	await expect(releases).toHaveCount(1)
	await expect(releases).toContainText(`${MARK} release Kowalski goes to the trash`)
	await expect(releases.locator('.banner')).toHaveClass(/banner--type-error/)
})

test('a document pointing at two merged-in documents is one row that names both', async ({
	page,
	context,
}) => {
	const [a, b, c] = (await seedGroup(context.request, 'friends')) as [Customer, Customer, Customer]
	const response = await context.request.post('/api/specimens', {
		data: { title: `${MARK} friends of both`, friends: [b.id, c.id] },
	})
	expect(response.ok(), `create failed: ${response.status()}`).toBe(true)
	const specimen = ((await response.json()) as { doc: { id: string } }).doc.id
	const errors: string[] = []
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text())
	})
	try {
		await openMerge(page, { docs: ids([a, b, c]) })
		const table = page.locator('.dedupe-related__table', { hasText: 'Specimens · Friends' })
		const rows = table.locator('tbody tr', { hasText: `${MARK} friends of both` })
		await expect(rows).toHaveCount(1)
		await expect(rows).toContainText(String(b.name))
		await expect(rows).toContainText(String(c.name))
		expect(errors.filter((text) => text.includes('same key'))).toEqual([])
	} finally {
		await context.request.delete(`/api/specimens/${specimen}?trash=false`)
	}
})

test('a relationship shows the related title rather than its id', async ({ page, context }) => {
	// A company of the Kyiv office `login` selects: the multi-tenant plugin refuses another's.
	const companies = await context.request.get(
		'/api/companies?where[name][equals]=Dnipro Paddle Club&limit=1&depth=0'
	)
	const { docs } = (await companies.json()) as { docs: { id: string; name: string }[] }
	const company = docs[0]
	if (!company) throw new Error('the dev seed should have the Dnipro Paddle Club')

	const [a, b] = (await seedGroup(context.request, 'relation', 2)) as [Customer, Customer]
	await patchCustomer(context.request, b.id, { company: company.id })
	await openMerge(page, { docs: ids([a, b]) })

	await expect(cell(page, 'company', b.id)).toContainText(company.name)
	await expect(cell(page, 'company', b.id)).not.toContainText(company.id)
})

test('a manual field blocks the merge until a document is picked for it', async ({
	page,
	context,
}) => {
	const [a, b, c] = (await seedGroup(context.request, 'manual')) as [Customer, Customer, Customer]
	await openMerge(page, { docs: ids([a, b, c]) })

	const score = fieldLabel(page, 'Score')
	await expect(score.locator('.pill', { hasText: 'Needs a choice' })).toBeVisible()
	await expect(mergeButton(page)).toBeDisabled()

	await pick(page, 'profile.score', b.id)
	await expect(score.locator('.pill', { hasText: 'Needs a choice' })).toHaveCount(0)
	await expect(mergeButton(page)).toBeEnabled()
})

test("a manual field can keep the primary's value", async ({ page, context }) => {
	const [a, b, c] = (await seedGroup(context.request, 'keep')) as [Customer, Customer, Customer]
	await openMerge(page, { docs: ids([a, b, c]) })

	await expect(
		page.locator(`[id="dedupe-profile.score-${a.id}"]`),
		'nothing is picked before the reviewer picks'
	).not.toBeChecked()
	await pick(page, 'profile.score', a.id)
	await expect(
		fieldLabel(page, 'Score').locator('.pill', { hasText: 'Needs a choice' })
	).toHaveCount(0)
	await expect(mergeButton(page)).toBeEnabled()
})

test("a column's menu keeps all of that document's values; the heads carry no check for it", async ({
	page,
	context,
}) => {
	const [a, b, c] = (await seedGroup(context.request, 'takeall')) as [Customer, Customer, Customer]
	await openMerge(page, { docs: ids([a, b, c]) })
	await expect(page.locator('.dedupe-merge__head .checkbox-input')).toHaveCount(0)

	await columnMenu(page, `${MARK} takeall Kowalski`).click()
	await page.getByRole('button', { name: 'Keep all values' }).click()
	for (const key of ['note', 'email', 'profile.score']) {
		await expect(cell(page, key, b.id), key).toHaveClass(/dedupe-merge__cell--picked/)
	}
})

test("no field takes a value of the reviewer's own, only a document's", async ({
	page,
	context,
}) => {
	const [a, b] = (await seedGroup(context.request, 'typed', 2)) as [Customer, Customer]
	await openMerge(page, { docs: ids([a, b]) })
	await expect(cell(page, 'note', a.id)).toHaveClass(/dedupe-merge__cell--picked/)
	await expect(page.locator('.dedupe-merge__label button')).toHaveCount(0)
})

test('two documents share the width, more show two columns and the edge of a third, a phone one and an edge', async ({
	page,
	context,
}) => {
	const group = await seedGroup(context.request, 'widths')
	const measure = () =>
		page.locator('.dedupe-merge__grid').evaluate((grid) => ({
			width: grid.clientWidth,
			column: grid.querySelector('.dedupe-merge__cell')?.getBoundingClientRect().width ?? 0,
			scrolls: grid.scrollWidth > grid.clientWidth,
		}))

	await page.setViewportSize({ width: 1440, height: 900 })
	await openMerge(page, { docs: ids(group.slice(0, 2)) })
	const two = await measure()
	expect(two.scrolls).toBe(false)
	expect(two.column).toBeGreaterThan(two.width * 0.45)

	await openMerge(page, { docs: ids(group) })
	const three = await measure()
	expect(three.scrolls).toBe(true)
	expect(three.column).toBeCloseTo(three.width * 0.4, 0)

	await page.setViewportSize({ width: 390, height: 900 })
	const phone = await measure()
	expect(phone.scrolls).toBe(true)
	expect(phone.column, 'the edge of the next column shows it swipes').toBeCloseTo(
		phone.width * 0.9,
		0
	)
})

test('a localized field is one row per language, and a choice in one leaves the other', async ({
	page,
	context,
}) => {
	const [a, b] = (await seedGroup(context.request, 'locales', 2)) as [Customer, Customer]
	await patchCustomer(context.request, a.id, { name: `${MARK} locales DE-A`, locale: 'de' })
	await patchCustomer(context.request, b.id, { name: `${MARK} locales DE-B`, locale: 'de' })
	await openMerge(page, { docs: ids([a, b]) })

	await expect(fieldLabel(page, 'Name')).toHaveCount(2)
	await expect(cell(page, 'name@de', a.id)).toContainText('locales DE-A')
	await expect(cell(page, 'name@de', b.id)).toContainText('locales DE-B')

	await pick(page, 'name@de', b.id)
	await expect(cell(page, 'name@en', a.id)).toHaveClass(/dedupe-merge__cell--picked/)
})

test('making another document primary moves the address and keeps the manual choices', async ({
	page,
	context,
}) => {
	const [a, b, c] = (await seedGroup(context.request, 'primary')) as [Customer, Customer, Customer]
	await openMerge(page, { docs: ids([a, b, c]) })
	await pick(page, 'profile.score', b.id)

	await page.locator(`label[for="dedupe-survivor-${c.id}"]`).click()
	await expect(page).toHaveURL(new RegExp(`survivor=${c.id}`))
	await expect(page.locator('.dedupe-merge__header h1')).toHaveText(
		`Merge into ${MARK} primary Kowalsky`
	)
	// The column stays where it stood; only its role changes.
	await expect(page.locator('.dedupe-merge__head').nth(2)).toHaveClass(
		/dedupe-merge__head--survivor/
	)
	await expect(cell(page, 'profile.score', b.id)).toHaveClass(/dedupe-merge__cell--picked/)
	await expect(cell(page, 'note', c.id)).toHaveClass(/dedupe-merge__cell--picked/)
})

test('a document taken out of the merge, once confirmed, leaves its column and the address', async ({
	page,
	context,
}) => {
	const [a, b, c] = (await seedGroup(context.request, 'remove')) as [Customer, Customer, Customer]
	await openMerge(page, { docs: ids([a, b, c]) })
	await pick(page, 'profile.score', b.id)

	const remove = async () => {
		await columnMenu(page, `${MARK} remove Kowalsky`).click()
		await page.getByRole('button', { name: 'Remove from this merge' }).click()
	}
	const modal = page.locator('.payload__modal-item')
	await remove()
	await expect(modal).toContainText(`Remove ${MARK} remove Kowalsky from this merge?`)
	await modal.getByRole('button', { name: 'Cancel' }).click()
	await expect(page.locator('.dedupe-merge__head'), 'cancel keeps it').toHaveCount(3)

	await remove()
	await modal.getByRole('button', { name: 'Remove from this merge' }).click()
	await expect(page.locator('.dedupe-merge__head')).toHaveCount(2)
	await expect(page).toHaveURL(new RegExp(`docs=${a.id}%2C${b.id}&`))
	await expect(cell(page, 'profile.score', b.id)).toHaveClass(/dedupe-merge__cell--picked/)
	await expect(mergeButton(page)).toHaveText('Merge 2 documents')
	// Two documents are the least a merge takes: neither can be taken out now.
	await columnMenu(page, `${MARK} remove Kowalski`).click()
	await expect(page.getByRole('button', { name: 'Keep all values' })).toBeVisible()
	await expect(page.getByRole('button', { name: 'Remove from this merge' })).toHaveCount(0)
})

test('making another document primary keeps the page, without a reload', async ({
	page,
	context,
}) => {
	const [a, b] = (await seedGroup(context.request, 'noreload', 2)) as [Customer, Customer]
	await openMerge(page, { docs: ids([a, b]) })
	await page.evaluate(() => {
		;(window as unknown as { stays?: boolean }).stays = true
	})
	await page.locator(`label[for="dedupe-survivor-${b.id}"]`).click()
	await expect(page).toHaveURL(new RegExp(`survivor=${b.id}`))
	await expect(page.locator('.dedupe-merge__header h1')).toHaveText(
		`Merge into ${MARK} noreload Kowalski`
	)
	expect(await page.evaluate(() => (window as unknown as { stays?: boolean }).stays)).toBe(true)
})

test("a document's name opens it in a drawer, and the drawer links to the document", async ({
	page,
	context,
}) => {
	const group = await seedGroup(context.request, 'drawer', 2)
	await openMerge(page, { docs: ids(group) })

	const head = page.locator('.dedupe-merge__head').first()
	await expect(head.getByRole('button', { name: 'Inspect' })).toHaveCount(0)
	await head.locator('.dedupe-merge__head-name').click()
	const drawer = page.locator('.drawer--is-open')
	await expect(drawer.locator('.id-label a')).toHaveAttribute(
		'href',
		new RegExp(`/collections/customers/${group[0]?.id}$`)
	)
	await expect(page).toHaveURL(new RegExp(`survivor=${group[0]?.id}`))
})

test('"Linked from" counts the documents that link to one and lists them', async ({
	page,
	context,
}) => {
	const group = await seedGroup(context.request, 'linked', 2)
	const response = await context.request.post('/api/trips', {
		data: { title: `${MARK} linked trip`, participants: [group[1]?.id] },
	})
	expect(response.ok()).toBe(true)
	const trip = ((await response.json()) as { doc: { id: string } }).doc
	try {
		await openMerge(page, { docs: ids(group) })
		const heads = page.locator('.dedupe-merge__head')
		await expect(heads.first().locator('.dedupe-merge__linked')).toBeDisabled()
		await heads.nth(1).locator('.dedupe-merge__linked').click()
		const drawer = page.locator('.drawer--is-open')
		await expect(drawer).toContainText('Trips · Participants')
		await expect(drawer.getByRole('link', { name: `${MARK} linked trip` })).toBeVisible()
	} finally {
		await context.request.delete(`/api/trips/${trip.id}`)
	}
})

test('a document with unpublished changes is listed with that reason, not under "Points at"', async ({
	page,
	context,
}) => {
	const [a, b] = (await seedGroup(context.request, 'pending', 2)) as [Customer, Customer]
	const created = await context.request.post('/api/notes', {
		data: {
			text: `${MARK} pending note`,
			about: { relationTo: 'customers', value: b.id },
			_status: 'published',
		},
	})
	expect(created.ok()).toBe(true)
	const note = ((await created.json()) as { doc: { id: string } }).doc.id
	const drafted = await context.request.patch(`/api/notes/${note}?draft=true`, {
		data: { text: `${MARK} pending note (draft)` },
	})
	expect(drafted.ok()).toBe(true)
	try {
		await openMerge(page, { docs: ids([a, b]) })
		const blocker = page.locator('.dedupe-related__table', { hasText: 'Has unpublished changes' })
		await expect(blocker).toHaveCount(1)
		await expect(blocker).toContainText(`${MARK} pending note`)
		await expect(blocker.locator('th', { hasText: 'Points at' })).toHaveCount(0)
	} finally {
		await context.request.delete(`/api/notes/${note}`)
	}
})

test('a listed document opens in its drawer again after the drawer was closed', async ({
	page,
	context,
}) => {
	const [a, b] = (await seedGroup(context.request, 'reopen', 2)) as [Customer, Customer]
	const created = await context.request.post('/api/notes', {
		data: {
			text: `${MARK} reopened note`,
			about: { relationTo: 'customers', value: b.id },
			_status: 'published',
		},
	})
	expect(created.ok()).toBe(true)
	const note = ((await created.json()) as { doc: { id: string } }).doc.id
	try {
		await openMerge(page, { docs: ids([a, b]) })
		const toggler = page
			.locator('.dedupe-related__table', { hasText: `${MARK} reopened note` })
			.locator('.drawer-link__doc-drawer-toggler')
			.first()
		const drawer = page.locator('.drawer--is-open')
		await toggler.click()
		await expect(drawer).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(drawer).toHaveCount(0)

		await toggler.click()
		await expect(drawer, 'opens the second time too').toBeVisible()
	} finally {
		await context.request.delete(`/api/notes/${note}`)
	}
})

test('warns that two documents of the group were marked not duplicates', async ({
	page,
	context,
}) => {
	const [a, b, c] = (await seedGroup(context.request, 'apart', 3)) as [Customer, Customer, Customer]
	const marked = await context.request.post('/api/dedupe/dismiss', {
		data: { collection: 'customers', docs: [a.id, c.id] },
	})
	expect(marked.ok()).toBe(true)
	await openMerge(page, { docs: ids([a, b, c]) })
	await expect(page.locator('.banner', { hasText: 'were marked as not duplicates' })).toBeVisible()
})

test('names a choice of a select by its label, as the version view does', async ({
	page,
	context,
}) => {
	const [a, b] = (await seedGroup(context.request, 'tier', 2)) as [Customer, Customer]
	await patchCustomer(context.request, a.id, { tier: 'gold' } as never)
	await patchCustomer(context.request, b.id, { tier: 'silver' } as never)
	await openMerge(page, { docs: ids([a, b]) })
	const grid = page.locator('.dedupe-merge__grid')
	await expect(grid).toContainText('Gold tier')
	await expect(grid).toContainText('Silver tier')
})

test('labels a list item with its text, apostrophes and ampersands as they are', async ({
	page,
	context,
}) => {
	const [a, b] = (await seedGroup(context.request, 'labels', 2)) as [Customer, Customer]
	await patchCustomer(context.request, a.id, { tags: ["O'Brien & Co"] } as never)
	await patchCustomer(context.request, b.id, { tags: ['plain'] } as never)
	await openMerge(page, { docs: ids([a, b]) })
	const grid = page.locator('.dedupe-merge__grid')
	await expect(grid).toContainText("O'Brien & Co")
	await expect(grid).not.toContainText('&#39;')
	await expect(grid).not.toContainText('&amp;')
})

test('says which fields lose their pointers at documents of the merge', async ({
	page,
	context,
}) => {
	const [a, b] = (await seedGroup(context.request, 'selfref', 2)) as [Customer, Customer]
	await patchCustomer(context.request, a.id, { referredBy: b.id } as never)
	await openMerge(page, { docs: ids([a, b]) })
	await expect(
		page.locator('.dedupe-merge__releases .banner', { hasText: 'Pointers at documents' })
	).toContainText('Pointers at documents of this merge are left out of Referred By')
})

test('a global that points at a merged-in document is listed and opens on its own page', async ({
	page,
	context,
}) => {
	const group = await seedGroup(context.request, 'global', 2)
	const before = await context.request.get('/api/globals/site?depth=0')
	const featured =
		((await before.json()) as { featuredCustomer?: string | null }).featuredCustomer ?? null
	const feature = (id: string | null | undefined) =>
		context.request.post('/api/globals/site', { data: { featuredCustomer: id } })
	expect((await feature(group[1]?.id)).ok()).toBe(true)
	try {
		await openMerge(page, { docs: ids(group) })
		const table = page.locator('.dedupe-related__table', { hasText: 'Site · Featured Customer' })
		await expect(table.getByRole('link', { name: 'Site' })).toHaveAttribute(
			'href',
			/\/admin\/globals\/site$/
		)
		await expect(table.locator('.drawer-link__doc-drawer-toggler')).toHaveCount(0)
	} finally {
		await feature(featured)
	}
})

test('the sidebar of a document opened on the merge screen leaves out the merge, and its Merge opens another', async ({
	page,
	context,
}) => {
	const [a, b, c] = (await seedGroup(context.request, 'drawermerge')) as [
		Customer,
		Customer,
		Customer,
	]
	await openMerge(page, { docs: ids([a, b]) })
	await page.locator('.dedupe-merge__head').nth(1).locator('.dedupe-merge__head-name').click()
	const drawer = page.locator('.drawer--is-open')
	await expect(drawer.locator('.dedupe-duplicates__item', { hasText: 'Kowalsky' })).toBeVisible()
	await expect(
		drawer.locator('.dedupe-duplicates__item', { hasText: 'Kowalska' }),
		'already in this merge'
	).toHaveCount(0)
	await drawer
		.locator('.dedupe-duplicates__item', { hasText: `${MARK} drawermerge Kowalsky` })
		.getByRole('link', { name: 'Merge', exact: true })
		.click()

	await expect(page).toHaveURL(new RegExp(`docs=${b.id}%2C${c.id}`))
	await expect(page.locator('.drawer--is-open')).toHaveCount(0)
	await expect(page.locator('.dedupe-merge__head')).toHaveCount(2)
	await expect(page.locator('.dedupe-merge__head', { hasText: 'Kowalsky' })).toBeVisible()
})

test('applying merges the whole group, closes its pairs and lands in the history', async ({
	page,
	context,
}) => {
	const [a, b, c] = (await seedGroup(context.request, 'apply')) as [Customer, Customer, Customer]
	const pairs = (
		await Promise.all([
			findPair(context.request, [a.id, b.id]),
			findPair(context.request, [a.id, c.id]),
			findPair(context.request, [b.id, c.id]),
		])
	).flatMap((pair) => (pair ? [pair.id] : []))
	expect(pairs.length, 'the scorer paired the group').toBeGreaterThan(0)

	await openMerge(page, { docs: ids([a, b, c]) })
	await pick(page, 'profile.score', b.id)

	await mergeButton(page).click()
	await expect(page.getByText('Apply this merge?')).toBeVisible()
	// Payload portals the modal, so the confirm button is addressed through it rather than by
	// position among the two buttons that now share a label.
	await page
		.locator('.payload__modal-item')
		.getByRole('button', { name: 'Merge 3 documents' })
		.click()

	await expect(page).toHaveURL(new RegExp(`/admin/collections/customers/${a.id}`), {
		timeout: 30_000,
	})
	await expect(page.getByText('Merged into the primary.')).toBeVisible()

	const after = await readCustomer(context.request, a.id, '&locale=en')
	expect(after.doc?.profile).toMatchObject({ score: 9 })
	expect(after.doc?.tags, 'a list keeps the primary items unless others are checked').toEqual([
		'vip',
	])
	expect(after.doc?.email, 'filled from the newest document').toBe('apply.c@e2e.test')
	expect(after.doc?.note, 'the conflict keeps the primary by default').toBe('from A')
	for (const doc of [b, c]) {
		expect((await readCustomer(context.request, doc.id)).status, 'out of the collection').toBe(404)
		expect((await readCustomer(context.request, doc.id, '&trash=true')).doc?.deletedAt).toBeTruthy()
	}
	for (const pair of pairs) {
		const merged = await context.request.get(`/api/dedupe-pairs/${pair}?depth=0`)
		expect(((await merged.json()) as { status: string }).status).toBe('merged')
	}

	await page.goto(`${QUEUE_PATH}/merges`)
	const row = page.locator('.dedupe-merges table tbody tr', { hasText: `${MARK} apply Kowalska` })
	await expect(row).toContainText('dev@10xmedia.de')
	await row.locator('a').first().click()
	await expect(page.locator('.dedupe-record h1')).toHaveText(`Merged into ${MARK} apply Kowalska`)

	// Every document as it was before the merge, the primary first; no column of the result.
	const heads = page.locator('.dedupe-record__head')
	await expect(heads).toHaveCount(3)
	await expect(heads.first()).toContainText('Primary')
	await expect(heads.first()).toContainText(`${MARK} apply Kowalska`)
	const cells = (path: string) =>
		page.locator(`.render-field-diffs__field[data-field-path="${path}"] .dedupe-record__cell`)
	await expect(cells('note')).toHaveCount(3)
	// Only what went into the result is marked, in the column it came from; nothing is red.
	await expect(page.locator('.dedupe-record [data-match-type="delete"]')).toHaveCount(0)
	await expect(cells('note').nth(0).locator('[data-match-type="create"]')).toHaveText('from A')
	await expect(cells('note').nth(1).locator('[data-match-type]')).toHaveCount(0)
	await expect(cells('profile.score').nth(1).locator('[data-match-type="create"]')).toHaveText('9')
	await expect(cells('profile.score').nth(0).locator('[data-match-type]')).toHaveCount(0)
	await expect(cells('email').nth(2).locator('[data-match-type="create"]')).toHaveText(
		'apply.c@e2e.test'
	)
	await expect(cells('email').nth(1).locator('[data-match-type]')).toHaveCount(0)
	// One fill per value: the band over the line or cell, with no second fill on the text.
	expect(
		await cells('note')
			.nth(0)
			.locator('[data-match-type="create"]')
			.evaluate((element) => getComputedStyle(element).backgroundColor)
	).toBe('rgba(0, 0, 0, 0)')
	// A list the result took whole fills its cell, as a single value does; a list it took part
	// of marks those items only.
	await expect(cells('addresses').nth(0)).toHaveClass(/dedupe-record__cell--taken/)
	await expect(cells('tags').nth(0)).toHaveClass(/dedupe-record__cell--taken/)
	await expect(cells('tags').nth(1)).not.toHaveClass(/dedupe-record__cell--taken/)
	// A row of an array is marked line by line, as text is, not as one filled block.
	await expect(cells('addresses').nth(0).locator('span[data-match-type="create"]')).not.toHaveCount(
		0
	)
	await expect(cells('addresses').nth(0).locator('div[data-match-type]')).toHaveCount(0)
	// The primary's ID is the one the merge kept.
	await expect(cells('id')).toHaveCount(3)
	await expect(cells('id').nth(0).locator('[data-match-type="create"]')).toHaveText(String(a.id))

	// With more than two columns they scroll as on the merge screen.
	expect(
		await page
			.locator('.dedupe-record__compare')
			.evaluate((element) => element.scrollWidth > element.clientWidth)
	).toBe(true)

	// The crumbs lead back to the history and name the primary, as a document's page does.
	const crumbs = page.locator('.step-nav')
	await expect(crumbs).toContainText('Merge history')
	await expect(crumbs).toContainText(`${MARK} apply Kowalska`)
	await expect(crumbs).not.toContainText('Duplicates')

	// Scrolled sideways on a phone, a field's name keeps the page's side margin.
	await page.setViewportSize({ width: 390, height: 900 })
	await page.reload()
	const label = page.locator('.render-field-diffs__field[data-field-path="note"] .field-diff-label')
	await expect(label).toBeVisible()
	const before = (await label.boundingBox())?.x ?? 0
	expect(before, 'the label starts at the side margin').toBeGreaterThan(0)
	const compare = page.locator('.dedupe-record__compare')
	await compare.evaluate((element) => {
		element.scrollLeft = element.scrollWidth
	})
	expect(await compare.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
	await expect.poll(async () => (await label.boundingBox())?.x).toBeCloseTo(before, 0)
	// The sideways scrollbar sits clear of the last field, as on the merge screen.
	const gap = await compare.evaluate((element) => {
		const fields = element.querySelectorAll('.render-field-diffs__field')
		const last = fields[fields.length - 1] as Element
		return element.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom
	})
	expect(gap).toBeGreaterThanOrEqual(8)

	// The primary opens in a drawer, as a document's name does on the merge screen.
	await page.setViewportSize({ width: 1280, height: 900 })
	await page.reload()
	const opener = heads.first().getByRole('button')
	await expect(opener).toHaveText(`${MARK} apply Kowalska`)
	await opener.click()
	await expect(page.locator('.drawer--is-open')).toBeVisible()
	await page.keyboard.press('Escape')
	await expect(page.locator('.drawer--is-open')).toHaveCount(0)

	// A merged-in document in the trash opens in a drawer too, read-only, as it is now.
	await heads
		.nth(1)
		.getByRole('button', { name: `${MARK} apply Kowalski` })
		.click()
	const drawer = page.locator('.drawer--is-open')
	await expect(drawer).toBeVisible()
	await expect(drawer.locator('#field-note')).toHaveValue('from B')
	await expect(drawer.locator('#field-note')).toBeDisabled()
})

test('a merged-in document in the trash shows a reader only the fields they may read', async ({
	browser,
	context,
}) => {
	const [a, b] = (await seedGroup(context.request, 'fieldread', 2)) as [Customer, Customer]
	await patchCustomer(context.request, b.id, { creditLimit: 5000 })
	const applied = await context.request.post('/api/dedupe/apply', {
		data: {
			collection: 'customers',
			survivor: a.id,
			absorbed: [b.id],
			choices: { 'profile.score': { doc: a.id } },
		},
	})
	expect(applied.status()).toBe(200)
	const { mergeId } = (await applied.json()) as { mergeId: string }
	const reader = { email: `limited-${Date.now()}@e2e.test`, password: 'password' }
	const created = await context.request.post('/api/users', { data: reader })
	expect(created.ok(), `user failed: ${created.status()}`).toBe(true)
	const { doc: user } = (await created.json()) as { doc: { id: string } }

	const limited = await browser.newContext()
	try {
		const signedIn = await limited.request.post('/api/users/login', { data: reader })
		expect(signedIn.ok()).toBe(true)
		const page = await limited.newPage()
		await page.goto(`${ADMIN_ROUTE}/dedupe/merges/${mergeId}`)
		const heads = page.locator('.dedupe-record__head')
		await heads
			.nth(1)
			.getByRole('button', { name: `${MARK} fieldread Kowalski` })
			.click()
		const drawer = page.locator('.drawer--is-open')
		await expect(drawer.locator('#field-note')).toHaveValue('from B')
		await expect(drawer.locator('#field-creditLimit')).toHaveCount(0)
	} finally {
		await limited.close()
		await context.request.delete(`/api/users/${user.id}`)
	}
})

test('the record lists a document that pointed at two merged-in documents once', async ({
	page,
	context,
}) => {
	const [a, b, c] = (await seedGroup(context.request, 'recfriends')) as [
		Customer,
		Customer,
		Customer,
	]
	const created = await context.request.post('/api/specimens', {
		data: { title: `${MARK} record friends`, friends: [b.id, c.id] },
	})
	expect(created.ok()).toBe(true)
	const specimen = ((await created.json()) as { doc: { id: string } }).doc.id
	try {
		const applied = await context.request.post('/api/dedupe/apply', {
			data: {
				collection: 'customers',
				survivor: a.id,
				absorbed: [b.id, c.id],
				choices: { 'profile.score': { doc: a.id } },
			},
		})
		expect(applied.status()).toBe(200)
		const { mergeId } = (await applied.json()) as { mergeId: string }

		await page.goto(`${ADMIN_ROUTE}/dedupe/merges/${mergeId}`)
		const rows = page
			.locator('.dedupe-related__table', { hasText: 'Specimens · Friends' })
			.locator('tbody tr', { hasText: `${MARK} record friends` })
		await expect(rows).toHaveCount(1)
		await expect(rows).toContainText(String(b.name))
		await expect(rows).toContainText(String(c.name))
	} finally {
		await context.request.delete(`/api/specimens/${specimen}?trash=false`)
	}
})

test('a row two documents share is marked in the one it was taken from', async ({
	page,
	context,
}) => {
	const [a, b] = (await seedGroup(context.request, 'samerow', 2)) as [Customer, Customer]
	const row = { city: 'Odesa', street: 'Deribasivska 1' }
	await patchCustomer(context.request, a.id, { addresses: [row] })
	await patchCustomer(context.request, b.id, { addresses: [row] })
	const applied = await context.request.post('/api/dedupe/apply', {
		data: {
			collection: 'customers',
			survivor: a.id,
			absorbed: [b.id],
			choices: {
				'profile.score': { doc: a.id },
				addresses: { items: [{ doc: b.id, index: 0 }] },
			},
		},
	})
	expect(applied.status()).toBe(200)
	const { mergeId } = (await applied.json()) as { mergeId: string }

	await page.goto(`${ADMIN_ROUTE}/dedupe/merges/${mergeId}`)
	await page.locator('#modifiedOnly').uncheck()
	const cells = page.locator(
		'.render-field-diffs__field[data-field-path="addresses"] .dedupe-record__cell'
	)
	await expect(cells).toHaveCount(2)
	await expect(cells.nth(1).locator('[data-match-type="create"]')).not.toHaveCount(0)
	await expect(cells.nth(0).locator('[data-match-type]')).toHaveCount(0)
})

test('a merged-in document in the trash opens in the language the admin shows', async ({
	page,
	context,
}) => {
	const [a, b] = (await seedGroup(context.request, 'language', 2)) as [Customer, Customer]
	await patchCustomer(context.request, b.id, { name: `${MARK} language Kowalski DE`, locale: 'de' })
	await patchCustomer(context.request, b.id, { profile: { bio: 'English only', score: 9 } })
	const applied = await context.request.post('/api/dedupe/apply', {
		data: {
			collection: 'customers',
			survivor: a.id,
			absorbed: [b.id],
			choices: { 'profile.score': { doc: a.id } },
		},
	})
	expect(applied.status()).toBe(200)
	const { mergeId } = (await applied.json()) as { mergeId: string }

	await page.goto(`${ADMIN_ROUTE}/dedupe/merges/${mergeId}?locale=de`)
	await page.locator('.dedupe-record__head').nth(1).locator('.dedupe-record__head-name').click()
	const drawer = page.locator('.drawer--is-open')
	await expect(drawer.locator('#field-name')).toHaveValue(`${MARK} language Kowalski DE`)
	// A field with no German value is empty in German, as on the document's own page. A group
	// draws its fields once it is in view.
	await drawer.locator('#field-profile').scrollIntoViewIfNeeded()
	await expect(drawer.locator('#field-profile__score')).toHaveValue('9')
	await expect(drawer.locator('#field-profile__bio')).toHaveValue('')
})

test('a document edited after the plan was built refuses to merge', async ({ page, context }) => {
	const [a, b] = (await seedGroup(context.request, 'stale', 2)) as [Customer, Customer]
	await openMerge(page, { docs: ids([a, b]) })
	await pick(page, 'profile.score', b.id)

	await patchCustomer(context.request, b.id, { note: 'changed behind the reviewer' })

	await mergeButton(page).click()
	await expect(page.getByText('Apply this merge?')).toBeVisible()
	await page
		.locator('.payload__modal-item')
		.getByRole('button', { name: 'Merge 2 documents' })
		.click()

	await expect(page.getByText(/changed since it was planned/)).toBeVisible()
	expect((await readCustomer(context.request, b.id)).status, 'nothing was written').toBe(200)
})

test('without two different documents the merge screen returns to the queue and says why', async ({
	page,
}) => {
	for (const query of ['', '?collection=ghosts&docs=1,2', '?collection=customers&docs=1,1']) {
		await page.goto(`${MERGE_PATH}${query}`)
		await expect(page).toHaveURL(/\/admin\/dedupe\?missingPair=1$/)
		await expect(page.locator('.dedupe-queue .banner--type-error')).toContainText(
			'needs a collection and two document ids'
		)
	}
})
