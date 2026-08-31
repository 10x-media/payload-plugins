import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Shared driving code for the audit-logs e2e specs.
 *
 * The dev seed already produced one entry of every shape, so the specs read the
 * view rather than building state. Anything a spec does need is created through
 * the REST API, which goes through the same hooks the admin panel does.
 */

const ADMIN = { email: 'dev@10xmedia.de', password: 'password' }

export const login = async (page: Page): Promise<void> => {
	const res = await page.request.post('/api/users/login', { data: ADMIN })
	expect(res.ok()).toBeTruthy()
}

export const createDoc = async (
	page: Page,
	collection: string,
	data: Record<string, unknown>
): Promise<string> => {
	const res = await page.request.post(`/api/${collection}`, { data })
	if (!res.ok()) throw new Error(`create ${collection} failed: ${await res.text()}`)
	const { doc } = (await res.json()) as { doc: { id: number | string } }
	return String(doc.id)
}

// biome-ignore lint/complexity/useMaxParams: mirrors the REST shape it wraps (collection, id, body)
export const updateDoc = async (
	page: Page,
	collection: string,
	id: string,
	data: Record<string, unknown>
): Promise<void> => {
	const res = await page.request.patch(`/api/${collection}/${id}`, { data })
	if (!res.ok()) throw new Error(`update ${collection}/${id} failed: ${await res.text()}`)
}

export const gotoLogs = async (page: Page, query = ''): Promise<void> => {
	await page.goto(`/admin/audit-logs${query}`)
	await expect(page.locator('.al-row').first()).toBeVisible()
}

export const rows = (page: Page): Locator => page.locator('.al-row')

/** The clickable summary line of a log row; expands to reveal the diff. */
export const rowSummary = (row: Locator): Locator => row.locator('.al-row__summary')

export const filterPills = (page: Page): Locator => page.locator('.al-filterpill')
