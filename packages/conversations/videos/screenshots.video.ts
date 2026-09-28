import { defineVideo, type Scene } from 'clipwright'
import { BASE_URL, CUSTOMER, DOCS_IMAGES, findId, openAdmin, react } from './_helpers'

/**
 * Every still in the conversations docs, from one run against `pnpm dev
 * conversations`: `pnpm videos conversations`. Dark admin, no video.
 *
 * Primitives come from the playground's "Docs shots" stories on the mock
 * backend, so their data is the same on every run; each story marks its
 * crops with `data-shot`. Extensions and composed surfaces come from the
 * seeded dev data, because only the real admin shows them in place.
 *
 * The scene writes PNG. The docs keep lossless WebP, a third of the size in
 * git; convert after a run and delete the PNGs:
 *
 *   cd apps/docs/public/images/conversations
 *   for f in *.png; do ffmpeg -i "$f" -c:v libwebp -lossless 1 -compression_level 6 "${f%.png}.webp" && rm "$f"; done
 */
const ids = { person: '', project: '', ticket: '' }

/** Crisp on high-density screens; the docs scale them down. */
const SCALE = 2

const shot = (s: Scene, name: string, { clip, padding = 0 }: { clip: string; padding?: number }) =>
	s.snapshot(name, { clip, padding, scale: SCALE })

/** No loading placeholder left anywhere on the page. */
const settled = async (s: Scene) => {
	await s.page
		.locator('.conversations-feed__skeleton')
		.first()
		.waitFor({ state: 'detached', timeout: 15_000 })
		.catch(() => undefined)
	await s.wait(500)
}

/** A playground story, loaded fresh so mock state and open menus never carry over. */
const story = async (s: Scene, id: string) => {
	await s.goto(`/admin/playground#${id}`)
	await s.page.reload()
	await s.page.locator('.pg-canvas').waitFor()
	// The mock answers at once, but the store subscribes on the next tick.
	await s.wait(900)
	await settled(s)
}

/** Narrower pages for surfaces that stretch to the window: a form field, the chat view. */
const withViewport = async (
	s: Scene,
	size: { height: number; width: number },
	run: () => Promise<void>
) => {
	const before = s.page.viewportSize()
	await s.page.setViewportSize(size)
	try {
		await run()
	} finally {
		if (before) await s.page.setViewportSize(before)
	}
}

const typeInComposer = async (s: Scene, shotName: string, text: string) => {
	const editor = s.page.locator(`[data-shot="${shotName}"] [contenteditable="true"]`)
	await editor.click()
	await s.page.keyboard.type(text, { delay: 60 })
	await s.wait(700)
}

/** The drawer that is open right now; `.conversations-drawer` alone also matches playground frames. */
const OPEN_DRAWER = '.conversations-drawer-shell .conversations-drawer'

/** The support chat on the dev website: `ConversationPanel` from the registry, with its heading. */
const WEBSITE_CHAT = 'main > div.mt-4'

/** Room at the drawer's left edge, which sits flush against its gutter. */
const DRAWER_PADDING = 24

const openMessageMenu = async (s: Scene) => {
	const message = s.page.locator(`${OPEN_DRAWER} .conversations-message`).last()
	await message.hover()
	await message.locator('.conversations-message__menu-button').click()
	await s.wait(500)
}

export default defineVideo({
	name: 'conversations-screenshots',
	video: false,
	snapshotDir: DOCS_IMAGES,
	context: { baseURL: BASE_URL },
	viewport: { width: 1440, height: 1000 },
	theme: { cursor: { kind: 'none' } },

	async beforeScene(setup) {
		await openAdmin(setup)
		ids.person = await findId(setup.request, {
			collection: 'persons',
			field: 'name',
			value: 'Jana Nováková',
		})
		ids.ticket = await findId(setup.request, {
			collection: 'tickets',
			field: 'status',
			value: 'open',
		})
		ids.project = await findId(setup.request, {
			collection: 'projects',
			field: 'name',
			value: 'Website relaunch',
		})
		await react(setup.request, {
			channel: 'internal',
			emojis: ['👍', '🎉'],
			instance: 'comments',
			key: `collection:persons:${ids.person}`,
		})
	},

	async scene(s) {
		// Primitives, on the playground's mock backend.
		await story(s, 'shot-panel')
		await shot(s, 'panel', { clip: '[data-shot="panel"]' })

		await story(s, 'shot-thread')
		await shot(s, 'thread', { clip: '[data-shot="thread"]' })

		await story(s, 'shot-trigger')
		await shot(s, 'trigger', { clip: '[data-shot="trigger"]' })

		await story(s, 'shot-tabs')
		await shot(s, 'tabs', { clip: '[data-shot="tabs"]' })

		await story(s, 'shot-feed')
		await shot(s, 'feed', { clip: '[data-shot="feed"]' })

		await story(s, 'shot-bare')
		await shot(s, 'bare-layout', { clip: '[data-shot="bare-layout"]' })

		await story(s, 'shot-composer')
		await shot(s, 'composer', { clip: '[data-shot="composer"]' })
		await typeInComposer(s, 'composer-commands', '/')
		await shot(s, 'composer-commands', { clip: '[data-shot="composer-commands"]' })
		await s.page.keyboard.press('Escape')
		await typeInComposer(s, 'composer-mention', '@a')
		await shot(s, 'composer-mention', { clip: '[data-shot="composer-mention"]' })

		await story(s, 'shot-slots')
		await s.page.getByRole('button', { name: 'Open the slot map' }).click()
		await s.page.locator(OPEN_DRAWER).waitFor()
		await s.wait(900)
		await openMessageMenu(s)
		await shot(s, 'slots', { clip: OPEN_DRAWER, padding: DRAWER_PADDING })

		// Extensions and surfaces, on the seeded dev data.
		await s.goto(`/admin/collections/persons/${ids.person}`)
		await s.page.locator('.conversations-trigger').waitFor()
		await s.wait(600)
		await shot(s, 'comments-button', { clip: '.conversations-trigger', padding: 12 })

		await s.page.locator('.conversations-trigger').click()
		await s.page.locator(OPEN_DRAWER).waitFor()
		await settled(s)
		await shot(s, 'comments-drawer', { clip: OPEN_DRAWER, padding: DRAWER_PADDING })

		await openMessageMenu(s)
		await shot(s, 'reactions-menu', { clip: OPEN_DRAWER, padding: DRAWER_PADDING })
		await s.page.keyboard.press('Escape')

		await withViewport(s, { height: 900, width: 1100 }, async () => {
			await s.goto(`/admin/collections/tickets/${ids.ticket}`)
			await s.page.locator('.conversations-inline').waitFor()
			await settled(s)
			await shot(s, 'ticket-field', { clip: '.conversations-inline', padding: 8 })
		})

		await withViewport(s, { height: 720, width: 1280 }, async () => {
			await s.goto('/admin/chat')
			await s.page.locator('.chat-app').waitFor()
			await s.page.locator('.chat-app__rooms').getByText('general').click()
			await settled(s)
			await shot(s, 'chat-view', { clip: '.chat-app' })
		})

		await s.goto(`/admin/collections/projects/${ids.project}`)
		await s.page.locator('.conversations-trigger').waitFor()
		await s.page.locator('.conversations-trigger').click()
		await s.page.locator(OPEN_DRAWER).waitFor()
		await settled(s)
		// The Panel replacement's outline holds everything the drawer draws.
		await shot(s, 'notes-replaced', { clip: `${OPEN_DRAWER} > .replaced`, padding: 12 })

		// The website: the shadcn registry components on the dev `/support` page. Last, because a
		// customer login replaces the admin's session (Payload keeps one cookie).
		await s.page.request.post('/api/customers/login', { data: CUSTOMER })
		await s.goto(`/support/${ids.ticket}`)
		// The dev site is light; shadcn's `.dark` tokens are in its CSS, so the class switches it.
		await s.page.evaluate(() => document.documentElement.classList.add('dark'))
		await s.page.locator(WEBSITE_CHAT).waitFor()
		await s.wait(1500)
		await shot(s, 'registry-panel', { clip: WEBSITE_CHAT, padding: 16 })

		const last = s.page.locator(`${WEBSITE_CHAT} [data-message-id]`).last()
		await last.hover()
		await last.getByRole('button', { name: 'Message actions' }).click()
		await s.wait(500)
		await shot(s, 'registry-menu', { clip: WEBSITE_CHAT, padding: 16 })
	},
})
