import type { Page } from '@playwright/test'

const ADMIN = { email: 'dev@10xmedia.de', password: 'password' }

/** Log in through the admin form, the way the dev app is actually reached. */
export const login = async (page: Page): Promise<void> => {
	await page.goto('/admin/login')
	await page.fill('input[name="email"]', ADMIN.email)
	await page.fill('input[name="password"]', ADMIN.password)
	await page.click('button[type="submit"]')
	await page.waitForURL((url) => !url.pathname.includes('/login'))
}

/**
 * The id of the first seeded job matching a query, read over REST so a spec
 * never depends on the list's ordering.
 */
export const findJobID = async (page: Page, query: string): Promise<string> => {
	const res = await page.request.get(`/api/payload-jobs?${query}&limit=1`)
	if (!res.ok()) throw new Error(`job lookup failed: ${await res.text()}`)
	const { docs } = (await res.json()) as { docs: { id: number | string }[] }
	const id = docs[0]?.id
	if (id == null) throw new Error(`no job matched ${query}`)
	return String(id)
}
