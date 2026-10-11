import { defineVideo, type Scene } from 'clipwright'
import type { Locator } from 'playwright'
import { BASE_URL, DOCS_IMAGES, findId, openAdmin } from './_helpers'

/**
 * Every still in the document-preview docs, from one run against `pnpm dev
 * document-preview` on a freshly seeded database: `pnpm videos
 * document-preview`. Dark admin, no video.
 *
 * The scene writes PNG. The docs keep lossless WebP; convert after a run and
 * delete the PNGs:
 *
 *   cd apps/docs/public/images/document-preview
 *   for f in *.png; do ffmpeg -i "$f" -c:v libwebp -lossless 1 -compression_level 6 "${f%.png}.webp" && rm "$f"; done
 *
 * `pptx` is a photograph, where lossless WebP stays at about 760 KB; encode it
 * lossy instead (`-quality 90` in place of `-lossless 1`), about 220 KB.
 */
const ids = { docx: '', post: '' }

/** Crisp on high-density screens; the docs scale them down. */
const SCALE = 2

const DRAWER = '.document-preview-drawer .drawer__content'

type Rect = { height: number; width: number; x: number; y: number }

const FRAME_ID = 'document-preview-shot-frame'

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

/** One element's box in document coordinates, with room around it. */
const around = async (locator: Locator, padding: number): Promise<Rect> => {
	const box = await locator.boundingBox()
	if (!box) throw new Error('element is not visible')
	const scrollY = await locator.page().evaluate(() => window.scrollY)
	return {
		height: box.height + padding * 2,
		width: box.width + padding * 2,
		x: box.x - padding,
		y: box.y + scrollY - padding,
	}
}

/** Sorted by name, so the first screen mixes file types rather than the newest CSVs. */
const MEDIA_LIST = '/admin/collections/media?limit=50&sort=filename'

/**
 * Open a file's preview drawer from its list row and wait until `ready` shows
 * inside it, then let the viewer settle.
 */
const openDrawer = async (
	s: Scene,
	{ file, ready, settle = 1200 }: { file: string; ready: string; settle?: number }
) => {
	await s.click(s.page.getByRole('button', { name: `Preview ${file}` }))
	await s.page.locator(`${DRAWER} ${ready}`).first().waitFor({ timeout: 60_000 })
	await s.wait(settle)
}

const closeDrawer = async (s: Scene) => {
	await s.press('Escape')
	await s.wait(700)
}

/** A drawer, shot as it sits over the list. */
const drawerShot = async (s: Scene, name: string) => {
	await s.snapshot(name, { clip: DRAWER, scale: SCALE })
}

export default defineVideo({
	name: 'document-preview-screenshots',
	video: false,
	snapshotDir: DOCS_IMAGES,
	context: { baseURL: BASE_URL },
	viewport: { width: 1440, height: 1000 },
	theme: { cursor: { kind: 'none' } },

	async beforeScene(setup) {
		await openAdmin(setup)
		ids.docx = await findId(setup.request, {
			collection: 'media',
			field: 'filename',
			value: 'demo.docx',
		})
		ids.post = await findId(setup.request, {
			collection: 'posts',
			field: 'title',
			value: 'Every file type',
		})
	},

	async scene(s) {
		// The list: file-type thumbnails, formatted sizes, the Preview column.
		await s.goto(MEDIA_LIST)
		await s.page.getByRole('button', { name: 'Preview demo.docx' }).waitFor({ timeout: 60_000 })
		await s.wait(1500)
		await top(s, 'media-list', 760)

		// Office documents, each in its own viewer.
		await openDrawer(s, { file: 'demo.docx', ready: '[data-docx-page-wrapper]', settle: 2000 })
		// Pagination settles after the first paint; shoot once the real page count is in.
		await s.page.waitForFunction(
			(drawer) =>
				!/of 1$/.test(
					document.querySelector(`${drawer} .document-preview-office__position`)?.textContent ?? ''
				),
			DRAWER,
			{ timeout: 60_000 }
		)
		// The second page, where the formatting starts.
		await s.page.locator(`${DRAWER} .document-preview-docx__scroll`).evaluate((el) => {
			const second = el.querySelector('[data-docx-page-wrapper="true"][data-index="1"]')
			el.scrollTop = second instanceof HTMLElement ? second.offsetTop - 16 : el.clientHeight
		})
		await s.wait(1500)
		await drawerShot(s, 'docx')
		await s.click(s.page.locator(`${DRAWER} button[aria-label="Pages"]`))
		await s.page.locator(`${DRAWER} .document-preview-rail__item`).first().waitFor()
		await s.wait(1500)
		await drawerShot(s, 'docx-pages')
		await closeDrawer(s)

		await openDrawer(s, {
			file: 'crazy-chart-zoo.xlsx',
			ready: '.document-preview-xlsx canvas',
			settle: 3000,
		})
		await drawerShot(s, 'xlsx')
		await closeDrawer(s)

		await openDrawer(s, {
			file: 'demo.pptx',
			ready: '.document-preview-pptx__scroll',
			settle: 3000,
		})
		await s.click(s.page.locator(`${DRAWER} button[aria-label="Slides"]`))
		await s.page.locator(`${DRAWER} .document-preview-rail__item`).first().waitFor()
		await s.wait(2000)
		await drawerShot(s, 'pptx')
		await closeDrawer(s)

		// Tables, Markdown, text and code, images.
		await openDrawer(s, { file: 'mixed-widths.csv', ready: '.document-preview-csv__cell' })
		await drawerShot(s, 'csv')
		await closeDrawer(s)

		await openDrawer(s, { file: 'notes.md', ready: '.document-preview-markdown__article table' })
		await drawerShot(s, 'markdown')
		await closeDrawer(s)

		await openDrawer(s, { file: 'config.yaml', ready: '.monaco-editor .view-lines', settle: 1500 })
		await drawerShot(s, 'code')
		await closeDrawer(s)

		await openDrawer(s, { file: 'sample.png', ready: '.document-preview-image__img' })
		await drawerShot(s, 'image')
		await closeDrawer(s)

		// No viewer for the type: the info card, with its file-type icon.
		await openDrawer(s, { file: 'archive.zip', ready: '.document-preview-card' })
		await drawerShot(s, 'info-card')
		await closeDrawer(s)

		// A host viewer: the dev app's three.js scene for model/*.
		await openDrawer(s, { file: 'Avocado.glb', ready: '.model-viewer__stage canvas', settle: 4000 })
		await drawerShot(s, 'model-3d')
		await closeDrawer(s)

		// Inline above the fields, the Preview button beside Save.
		await s.goto(`/admin/collections/media/${ids.docx}`)
		await s.page.locator('.document-preview-inline [data-docx-page-wrapper]').first().waitFor({
			timeout: 60_000,
		})
		await s.wait(2000)
		await top(s, 'inline', 900)

		// Upload fields elsewhere: file-type thumbnails instead of a blank page.
		await s.goto(`/admin/collections/posts/${ids.post}`)
		const attachments = s.page.locator('.field-type.upload').filter({ hasText: 'Attachments' })
		await attachments.waitFor({ timeout: 60_000 })
		await attachments.scrollIntoViewIfNeeded()
		await s.wait(1500)
		await frame(s, 'upload-field', await around(attachments, 16))

		// Every icon, the dev app's host "3D" icon included.
		await s.goto('/admin/file-icons')
		await s.page.locator('.file-icons__grid').waitFor({ timeout: 60_000 })
		await s.wait(800)
		await s.snapshot('file-icons', { clip: '.file-icons__grid', padding: 8, scale: SCALE })
	},
})
