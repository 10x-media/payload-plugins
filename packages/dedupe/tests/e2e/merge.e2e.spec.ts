import { expect, type Page, test } from '@playwright/test'

import {
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

test('applying merges the whole group and deletes its pairs', async ({ page, context }) => {
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
		const gone = await context.request.get(`/api/dedupe-pairs/${pair}?depth=0`)
		expect(gone.status(), 'the pairs of a merged group are deleted').toBe(404)
	}
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
