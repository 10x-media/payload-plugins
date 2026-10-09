import type { APIRequestContext, BrowserContext, Page } from '@playwright/test'
import { expect } from '@playwright/test'

export const ADMIN = { email: 'dev@10xmedia.de', password: 'password' }

/** Every document these tests create carries it, so cleanup never touches the seed. */
export const MARK = '[e2e]'

export const ADMIN_ROUTE = '/admin'
export const QUEUE_PATH = `${ADMIN_ROUTE}/dedupe`
export const MERGE_PATH = `${QUEUE_PATH}/merge`

export type CustomerInput = {
	name: string
	email?: string
	phone?: string
	birthDate?: string
	tags?: string[]
	vip?: boolean
	company?: string
	addresses?: { city?: string; street?: string }[]
	profile?: { bio?: string; score?: number }
	note?: string
	extra?: { code?: string }
	creditLimit?: number
}

export type Customer = { id: string } & Record<string, unknown>

/**
 * Sign in through the REST API. A browser context shares its cookie jar with
 * `context.request`, so the page is authenticated afterwards without driving the form.
 */
export const login = async (context: BrowserContext): Promise<void> => {
	const response = await context.request.post('/api/users/login', { data: ADMIN })
	expect(response.ok(), `login failed: ${response.status()}`).toBe(true)
	// The dev app is multi-tenant and the tenant field is required: select the Kyiv office,
	// as the admin's tenant selector would, so documents created here land in it.
	const tenants = await context.request.get('/api/tenants?where[slug][equals]=kyiv&limit=1')
	const [kyiv] = ((await tenants.json()) as { docs: { id: string }[] }).docs
	expect(kyiv, 'the dev seed has no kyiv tenant').toBeDefined()
	await context.addCookies([
		{ name: 'payload-tenant', value: String(kyiv?.id), url: new URL(response.url()).origin },
	])
}

export const createCustomer = async (
	request: APIRequestContext,
	input: CustomerInput,
	locale = 'en'
): Promise<Customer> => {
	const response = await request.post(`/api/customers?locale=${locale}`, { data: input })
	const body = (await response.json()) as { doc?: Customer; errors?: unknown }
	expect(response.ok(), `create failed: ${response.status()} ${JSON.stringify(body)}`).toBe(true)
	return body.doc as Customer
}

/** Write onto an existing document, in the locale given or the default one. */
export const patchCustomer = async (
	request: APIRequestContext,
	id: string,
	input: Partial<CustomerInput> & { locale?: string }
): Promise<void> => {
	const { locale = 'en', ...data } = input
	const response = await request.patch(`/api/customers/${id}?locale=${locale}`, { data })
	expect(response.ok(), `patch failed: ${response.status()}`).toBe(true)
}

export const readCustomer = async (
	request: APIRequestContext,
	id: string,
	params = ''
): Promise<{ status: number; doc: Record<string, unknown> | null }> => {
	const response = await request.get(`/api/customers/${id}?depth=0${params}`)
	const doc = response.ok() ? ((await response.json()) as Record<string, unknown>) : null
	return { status: response.status(), doc }
}

/**
 * Remove every document these tests made. Deleting a customer runs the plugin's
 * `afterDelete`, which drops its keys and supersedes its pairs, so the queue starts each
 * spec with only the seed's own rows.
 */
export const cleanup = async (request: APIRequestContext): Promise<void> => {
	// `name` is localized, so filtering server-side needs a locale and still misses the
	// other one; reading a page and matching here is both simpler and complete.
	for (const params of ['&trash=true', '']) {
		const response = await request.get(`/api/customers?limit=300&depth=0&locale=en${params}`)
		if (!response.ok()) continue
		const body = (await response.json()) as { docs: { id: string; name?: string }[] }
		for (const doc of body.docs) {
			if (!String(doc.name ?? '').includes(MARK)) continue
			// Without `trash=true` the delete does not find a document in the trash; with it, it
			// deletes either kind for good.
			await request.delete(`/api/customers/${doc.id}?trash=true`)
		}
	}
}

/** A pair as the plugin stores it, read back through the REST API of its own collection. */
export type PairView = {
	id: string
	docA: { id: string }
	docB: { id: string }
	score: number
	status: string
	signals: { path: string; kind: string }[] | null
}

const STATUSES = ['open', 'dismissed']

/** The Kyiv office `login` selects, which the queue on screen is filtered by. */
const kyivId = async (request: APIRequestContext): Promise<string> => {
	const response = await request.get('/api/tenants?where[slug][equals]=kyiv&limit=1&depth=0')
	const [kyiv] = ((await response.json()) as { docs: { id: string }[] }).docs
	return String(kyiv?.id)
}

const pairsQuery = (status: string, limit: number, tenant: string) =>
	`/api/dedupe-pairs?where[target][equals]=customers&where[status][equals]=${status}&where[tenant][equals]=${tenant}&limit=${limit}&depth=0`

/** The queue as the API sees it, for asserting on state the screen only summarises. */
export const fetchQueue = async (
	request: APIRequestContext,
	status = 'open'
): Promise<{ docs: PairView[]; counts: Record<string, number> }> => {
	const tenant = await kyivId(request)
	const response = await request.get(pairsQuery(status, 100, tenant))
	expect(response.ok(), `pairs failed: ${response.status()}`).toBe(true)
	const body = (await response.json()) as {
		docs: (Omit<PairView, 'docA' | 'docB'> & { docA: string; docB: string })[]
	}
	const counts: Record<string, number> = {}
	for (const entry of STATUSES) {
		const count = await request.get(pairsQuery(entry, 1, tenant))
		counts[entry] = ((await count.json()) as { totalDocs: number }).totalDocs
	}
	return {
		docs: body.docs.map((row) => ({ ...row, docA: { id: row.docA }, docB: { id: row.docB } })),
		counts,
	}
}

/** The pair naming both documents, whichever way round it was stored. */
export const findPair = async (
	request: APIRequestContext,
	ids: [string, string],
	status = 'open'
): Promise<PairView | undefined> => {
	const [a, b] = ids
	const { docs } = await fetchQueue(request, status)
	return docs.find(
		(pair) =>
			(pair.docA.id === a && pair.docB.id === b) || (pair.docA.id === b && pair.docB.id === a)
	)
}

/**
 * The same person entered twice, as far as the dev config's match rules are concerned:
 * the surname differs by one letter (a `similar` name signal), phone and birth date are
 * the same, and only one side carries an email.
 *
 * Note the email: it is `unique` on this collection, so two documents can never share
 * one. A pair therefore cannot reach score 1 here - leaving the survivor's email empty
 * leaves that field out of the score rather than counting a penalty, which is the highest
 * a pair can score in this dev app.
 */
export const matchingPair = (
	label: string,
	overrides: { a?: Partial<CustomerInput>; b?: Partial<CustomerInput> } = {}
): [CustomerInput, CustomerInput] => {
	const base = {
		phone: '+380 50 111 22 33',
		birthDate: '1990-05-15T00:00:00.000Z',
	}
	return [
		{ ...base, name: `${MARK} ${label} Kowalska`, ...overrides.a },
		{ ...base, name: `${MARK} ${label} Kowalski`, email: `${label}@e2e.test`, ...overrides.b },
	]
}

export const openQueue = async (page: Page, status?: string): Promise<void> => {
	const query = new URLSearchParams({ collection: 'customers' })
	if (status) query.set('status', status)
	await page.goto(`${QUEUE_PATH}?${query}`)
	// The container renders before the fetch resolves, so wait for whichever of the two
	// outcomes the queue settles on.
	await expect(page.locator('.dedupe-queue__table, .dedupe-queue__message').first()).toBeVisible()
}

export const openMerge = async (
	page: Page,
	args: { docs: string[]; survivor?: string }
): Promise<void> => {
	const query = new URLSearchParams({
		collection: 'customers',
		docs: args.docs.join(','),
		survivor: args.survivor ?? (args.docs[0] as string),
	})
	await page.goto(`${MERGE_PATH}?${query}`)
	await expect(page.locator('.dedupe-merge__grid')).toBeVisible()
}

/**
 * The label cell of one field row, addressed by the label it shows; a localized field has
 * one row per language, told apart by its locale chip.
 */
export const fieldLabel = (page: Page, label: string, locale?: string) => {
	const base = page.locator('.dedupe-merge__label', {
		has: page.locator('.dedupe-merge__label-text', { hasText: new RegExp(`^${label}$`) }),
	})
	return locale
		? base.filter({ has: page.locator('.field-diff__locale-label', { hasText: locale }) })
		: base
}

/** The cell of one document in one field row, by the decision key and the document id. */
export const cell = (page: Page, key: string, doc: string) =>
	page.locator(`label[for="dedupe-${key}-${doc}"]`)

/**
 * Pick a document for a field the way a reader does, by clicking its cell: the admin hides
 * the radio input itself behind a styled control, so the input cannot take the click.
 */
export const pick = async (page: Page, key: string, doc: string): Promise<void> => {
	const target = cell(page, key, doc)
	await target.evaluate((node) => node.scrollIntoView({ block: 'center' }))
	await target.click()
	await expect(target).toHaveClass(/dedupe-merge__cell--picked/)
}

/** The merge button in the footer, named after the number of documents it merges. */
export const mergeButton = (page: Page) =>
	page.locator('.dedupe-merge__footer').getByRole('button', { name: /^Merge \d+ documents$/ })

/** A row of the queue, by a title of one of its documents. */
export const queueRow = (page: Page, title: string) =>
	page.locator('.dedupe-queue__table tbody tr', { hasText: title })

/** A status tab above the queue, with its count. */
export const queueTab = (page: Page, label: string) =>
	page.locator('.default-list-view-tabs__button', { hasText: label })
