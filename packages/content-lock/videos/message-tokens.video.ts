import path from 'node:path'
import { defineVideo, type Scene } from 'clipwright'
import { BASE_URL, DOCS_VIDEOS, openAdmin } from './_helpers'

/**
 * Writing an announcement with lock value tokens: text, a start token turned
 * relative, an end token as a time, then publish and the banner reading it.
 * Against `pnpm dev content-lock`: `pnpm videos content-lock`.
 */
const TITLE = 'Newsletter migration'
const HOUR = 60 * 60 * 1000
let windowId = ''

const EDITOR = '.rich-text-lexical [contenteditable="true"]'

/** Insert a token through the slash menu, filtered by its label. */
const slashToken = async (s: Scene, query: string) => {
	await s.type('/', { delay: 80 })
	await s.wait(700)
	await s.type(query, { delay: 90 })
	await s.wait(500)
	await s.press('Enter')
	await s.wait(600)
}

/** Open a token's panel and pick a format. */
const formatToken = async (s: Scene, index: number, format: string) => {
	await s.click(s.page.locator('.content-lock-token').nth(index))
	await s.wait(500)
	await s.click('.content-lock-token-editor__trigger')
	await s.wait(400)
	await s.click(
		s.page.locator('.popup-button-list__button').filter({ hasText: new RegExp(`^${format}$`) })
	)
	await s.wait(700)
}

export default defineVideo({
	name: 'message-tokens',
	context: { baseURL: BASE_URL },
	crf: 26,
	output: path.join(DOCS_VIDEOS, 'message-tokens.mp4'),
	outro: 400,
	viewport: { width: 1600, height: 900 },
	warmup: 1400,

	async beforeScene(setup) {
		await openAdmin(setup)
		const res = await setup.request.get(
			`/api/content-locks?depth=0&limit=10&draft=true&where[title][equals]=${encodeURIComponent(TITLE)}`
		)
		const { docs } = (await res.json()) as { docs: Array<{ id: string }> }
		for (const doc of docs) {
			await setup.request.delete(`/api/content-locks/${doc.id}`)
		}
		const now = Date.now()
		const created = await setup.request.post('/api/content-locks', {
			data: {
				title: TITLE,
				announce: true,
				announceAt: new Date(now - HOUR).toISOString(),
				startsAt: new Date(now + 20 * HOUR).toISOString(),
				endAtTime: true,
				endsAt: new Date(now + 22 * HOUR).toISOString(),
				lockEverything: false,
				groups: ['site'],
			},
		})
		const { doc } = (await created.json()) as { doc: { id: string } }
		windowId = doc.id
	},

	async scene(s) {
		await s.goto(`/admin/collections/content-locks/${windowId}`)
		await s.page.locator('.tabs-field__tab-button').first().waitFor({ timeout: 30_000 })
		await s.wait(800)

		await s.click(s.page.locator('.tabs-field__tab-button', { hasText: 'Announcement' }))
		await s.wait(600)
		const field = s.page.locator('.rich-text-lexical').first()
		await s.zoomTo(field, { duration: 700, scale: 1.35 })

		await s.click(s.page.locator(EDITOR).first())
		await s.type('The newsletter moves to a new system ', { delay: 45 })
		await slashToken(s, 'start')
		await s.type('. Pages and posts are read-only until ', { delay: 45 })
		await slashToken(s, 'end')
		await s.type('.', { delay: 45 })
		await s.wait(500)

		await formatToken(s, 0, 'Relative')
		await formatToken(s, 1, 'Time')
		await s.wait(700)
		// The poster: both tokens formatted, the panel still open.
		await s.snapshot('message-tokens')

		await s.zoomOut({ duration: 600 })
		await s.click('#action-save')
		await s.wait(1500)

		await s.goto('/admin/collections/pages')
		await s.page.locator('.content-lock-banner').waitFor({ timeout: 30_000 })
		await s.wait(700)
		// The banner spans the page and its text starts at the left, so frame the
		// top-left corner rather than the element's centre.
		const scale = 1.4
		const { width, height } = s.page.viewportSize() ?? { height: 900, width: 1600 }
		await s.zoom(scale, {
			at: { x: width / scale / 2, y: height / scale / 2 },
			duration: 700,
			hold: 2400,
		})
	},
})
