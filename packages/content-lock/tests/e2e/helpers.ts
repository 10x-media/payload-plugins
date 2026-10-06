import { expect, type Page } from '@playwright/test'

const ADMIN = { email: 'dev@10xmedia.de', password: 'password' }

/**
 * Through the API, as the other plugins' suites do: the session cookie lands in
 * the page's context, and no test waits on the login form's redirect to the
 * dashboard, whose first render on a cold server is slow and flaky.
 */
export const login = async (page: Page): Promise<void> => {
	const res = await page.request.post('/api/users/login', { data: ADMIN })
	expect(res.ok(), `login as ${ADMIN.email}`).toBeTruthy()
}

/** The id of the first document in a collection, read over REST. */
export const firstID = async (page: Page, collection: string): Promise<string> => {
	const res = await page.request.get(`/api/${collection}?limit=1`)
	if (!res.ok()) throw new Error(`lookup failed: ${await res.text()}`)
	const { docs } = (await res.json()) as { docs: { id: number | string }[] }
	const id = docs[0]?.id
	if (id == null) throw new Error(`no ${collection} seeded`)
	return String(id)
}
