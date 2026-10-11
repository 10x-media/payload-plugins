import { defineVideo, type Scene } from 'clipwright'
import { BASE_URL, DOCS_IMAGES, findId, openAdmin } from './_helpers'

/**
 * Every still in the content-lock docs, from one run against `pnpm dev
 * content-lock` on a freshly seeded database: `pnpm videos content-lock`.
 * Dark admin, no video.
 *
 * The scene writes PNG. The docs keep lossless WebP; convert after a run and
 * delete the PNGs:
 *
 *   cd apps/docs/public/images/content-lock
 *   for f in *.png; do ffmpeg -i "$f" -c:v libwebp -lossless 1 -compression_level 6 "${f%.png}.webp" && rm "$f"; done
 */
const ids = { upgrade: '', product: '' }

/** Crisp on high-density screens; the docs scale them down. */
const SCALE = 2

type Rect = { height: number; width: number; x: number; y: number }

const FRAME_ID = 'content-lock-shot-frame'

/**
 * Snapshot a rect of the page. The camera owns the viewport, so resizing it
 * mid-scene is not an option; an invisible element over the rect is.
 */
const frame = async (s: Scene, name: string, rect: Rect) => {
	await s.page.evaluate(
		({ id, rect }) => {
			const el = document.createElement('div')
			el.id = id
			Object.assign(el.style, {
				height: `${rect.height}px`,
				left: `${rect.x}px`,
				pointerEvents: 'none',
				position: 'absolute',
				top: `${rect.y}px`,
				width: `${rect.width}px`,
			})
			document.body.append(el)
		},
		{ id: FRAME_ID, rect }
	)
	await s.snapshot(name, { clip: `#${FRAME_ID}`, scale: SCALE })
	await s.page.evaluate((id) => document.getElementById(id)?.remove(), FRAME_ID)
}

/** The top of the page, full width. */
const top = async (s: Scene, name: string, height: number) => {
	const width = await s.page.evaluate(() => document.documentElement.clientWidth)
	await frame(s, name, { height, width, x: 0, y: 0 })
}

/** The union of two elements' boxes, in document coordinates, with room around it. */
const around = async (s: Scene, selectors: string[], padding: number): Promise<Rect> =>
	s.page.evaluate(
		({ padding, selectors }) => {
			const boxes = selectors.map((selector) => {
				const box = document.querySelector(selector)?.getBoundingClientRect()
				if (!box) throw new Error(`nothing matches ${selector}`)
				return box
			})
			const x = Math.min(...boxes.map((box) => box.left)) - padding
			const y = Math.min(...boxes.map((box) => box.top)) - padding
			const right = Math.max(...boxes.map((box) => box.right)) + padding
			const bottom = Math.max(...boxes.map((box) => box.bottom)) + padding
			return { height: bottom - y, width: right - x, x: x + window.scrollX, y: y + window.scrollY }
		},
		{ padding, selectors }
	)

/** The page, with its banner rendered and relative dates formatted. */
const open = async (s: Scene, url: string) => {
	await s.goto(url)
	await s.page.locator('.content-lock-banner').first().waitFor({ timeout: 30_000 })
	await s.wait(1200)
}

export default defineVideo({
	name: 'content-lock-screenshots',
	video: false,
	snapshotDir: DOCS_IMAGES,
	context: { baseURL: BASE_URL },
	viewport: { width: 1440, height: 1000 },
	theme: { cursor: { kind: 'none' } },

	async beforeScene(setup) {
		await openAdmin(setup)
		ids.upgrade = await findId(setup.request, {
			collection: 'content-locks',
			field: 'title',
			value: 'Database upgrade',
		})
		ids.product = await findId(setup.request, {
			collection: 'products',
			field: 'title',
			value: 'Desk lamp',
		})
	},

	async scene(s) {
		// An active lock on the catalog: banner with the pager, a list without Create.
		await open(s, '/admin/collections/products')
		await top(s, 'locked-list', 420)

		// A document in scope, read-only.
		await open(s, `/admin/collections/products/${ids.product}`)
		await top(s, 'locked-document', 440)

		// The windows list: stage pills and the quick filters.
		await open(s, '/admin/collections/content-locks')
		await s.snapshot('windows-list', { clip: '.collection-list__wrap', padding: 8, scale: SCALE })

		// A window's form: dates with time zones, scope, messages, the sidebar toggles.
		await open(s, `/admin/collections/content-locks/${ids.upgrade}`)
		await top(s, 'window-form', 720)

		// The announcement message with a token's panel open.
		await s.click(s.page.locator('.tabs-field__tab-button', { hasText: 'Announcement' }))
		await s.wait(600)
		const editor = s.page.locator('.rich-text-lexical').first()
		await editor.scrollIntoViewIfNeeded()
		await s.click(editor.locator('.content-lock-token').first())
		await s.page.locator('.content-lock-token-editor').first().waitFor()
		await s.wait(500)
		const panel = await around(
			s,
			[
				'.rich-text-lexical .fixed-toolbar',
				'.rich-text-lexical .editor-container',
				'.content-lock-token-editor',
			],
			20
		)
		// Room for the field label above the toolbar.
		await frame(s, 'token-panel', { ...panel, height: panel.height + 18, y: panel.y - 18 })
	},
})
