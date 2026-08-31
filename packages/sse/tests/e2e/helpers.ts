import { expect, type Page } from '@playwright/test'

export const ADMIN = { email: 'dev@10xmedia.de', password: 'password' }
export const VIEWER = { email: 'viewer@10xmedia.de', password: 'password' }

export const login = async (
	page: Page,
	creds: { email: string; password: string } = ADMIN
): Promise<void> => {
	const res = await page.request.post('/api/users/login', { data: creds })
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

export const updateDoc = async (args: {
	page: Page
	collection: string
	id: string
	data: Record<string, unknown>
}): Promise<void> => {
	const { page, collection, id, data } = args
	const res = await page.request.patch(`/api/${collection}/${id}`, { data })
	if (!res.ok()) throw new Error(`update ${collection}/${id} failed: ${await res.text()}`)
}

export const openCollectionList = async (page: Page, collection: string): Promise<void> => {
	await page.goto(`/admin/collections/${collection}`)
	await expect(page.locator('table, .table, [class*="list"]').first()).toBeVisible({
		timeout: 30_000,
	})
}

export const openDoc = async (page: Page, collection: string, id: string): Promise<void> => {
	await page.goto(`/admin/collections/${collection}/${id}`)
	await expect(page.locator('#action-save')).toBeVisible({ timeout: 30_000 })
}
