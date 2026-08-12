// biome-ignore-all lint/plugin/noProcessEnv: video rendering env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SceneSetup } from 'clipwright'
import type { APIRequestContext, BrowserContext, Locator, Page } from 'playwright'

export const ADMIN = { email: 'dev@10xmedia.de', password: 'password' }

export const BASE_URL = process.env.WIKI_DEV_URL ?? 'http://localhost:3000'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Clips render straight into the docs app rather than into a local directory
 * something then copies. One artefact in one place, and the docs site does not
 * have to know how it was made. `snapshotDir` follows `output`, so each poster
 * frame lands beside its own clip.
 */
const DOCS_ASSETS = path.resolve(dirname, '../../../apps/docs/public/videos/admin-wiki')

/**
 * The shape every clip shares.
 *
 * These are showcases rather than tutorials: no captions, and short enough to be
 * watched twice, because the docs play them muted and looping with no controls.
 * Captions were doing the pacing before, and without them there is no reading
 * time to hide behind, so each scene leans on the cursor, the camera, and the
 * admin's own animations instead.
 */
export const showcase = (name: string) => ({
	context: { baseURL: BASE_URL },
	// Screen content is mostly flat colour and compresses well. Every one of
	// these is committed, so the ceiling worth paying for is lower than the
	// default.
	crf: 26,
	name,
	output: path.join(DOCS_ASSETS, `${name}.mp4`),
	// A loop has no ending to hold open, only a seam.
	outro: 400,
	viewport: { width: 1600, height: 900 },
	warmup: 1400,
})

/**
 * Put the admin in dark mode before anything renders.
 *
 * Payload reads `<cookiePrefix>-theme` first and only falls back to
 * `prefers-color-scheme` when that cookie holds neither 'light' nor 'dark', so
 * the cookie is the deterministic lever: it decides the theme rather than
 * competing with whatever the recording machine prefers. The dev app sets no
 * `cookiePrefix`, which leaves the default.
 */
export const useDarkAdmin = async (context: BrowserContext): Promise<void> => {
	await context.addCookies([{ name: 'payload-theme', url: BASE_URL, value: 'dark' }])
}

/**
 * Dark theme, a logged-in session, and the admin shell already compiled. The
 * last one matters against a dev server: the first hit on a route builds it,
 * and that build is not something anyone should watch.
 */
export const openAdmin = async ({ context, page, request }: SceneSetup): Promise<void> => {
	await useDarkAdmin(context)
	await request.post('/api/users/login', { data: ADMIN })
	await page.goto('/admin')
}

const fieldId = (path: string): string => `#field-${path.replace(/\./g, '__')}`

const wrapOf = (control: Locator): Locator =>
	control.locator('xpath=ancestor::div[contains(@class, "field-type__wrap")][1]')

/**
 * The wrap holding one field's control and the description slot after it. Payload
 * puts the field id on the control, so the slot is a sibling rather than a
 * descendant and only the nearest wrap above holds both. Same derivation the e2e
 * helpers use, so a scene and a spec address a field identically.
 */
export const fieldWrap = (page: Page, path: string): Locator => wrapOf(page.locator(fieldId(path)))

/**
 * The same wrap, but inside the field picker drawer. Scoped because the picker
 * renders another entity's form on top of the guide being edited, and both carry
 * a `title` field.
 */
export const pickerField = (page: Page, path: string): Locator =>
	wrapOf(page.locator('.wiki-field-picker').locator(fieldId(path)))

/**
 * The element a Payload drawer actually scrolls. Not the one carrying the
 * drawer's own class: that one is `overflow: hidden`, and the gutter inside it
 * is the scroller. `scrollUntil` has to be told which, since the page body does
 * not move while a drawer is open.
 */
export const DRAWER_PANE = '.drawer__content-children'

/** The picker drawer's scrolling pane. */
export const PICKER_PANE = `.wiki-field-picker-modal ${DRAWER_PANE}`

/** Payload's tab strip, on any form built from a `tabs` field. */
export const TAB_BUTTON = '.tabs-field__tab-button'

/**
 * Leave exactly one post behind, so a scene that walks the list view shows a
 * list rather than a pile of identically titled fixtures from earlier renders.
 * The dev database lives in memory and survives until the server restarts.
 */
export const resetPosts = async (request: APIRequestContext): Promise<void> => {
	const res = await request.get('/api/posts?depth=0&limit=200')
	const { docs } = (await res.json()) as { docs: { id: number | string }[] }
	for (const doc of docs) {
		await request.delete(`/api/posts/${doc.id}`)
	}
}

/** A post with the shared hero block, so block-level help has something to attach to. */
export const seedPost = async (request: APIRequestContext, title: string): Promise<string> => {
	const res = await request.post('/api/posts', {
		data: {
			layout: [{ blockType: 'heroBanner', heading: 'Meet the new release' }],
			title,
		},
	})
	const { doc } = (await res.json()) as { doc: { id: number | string } }
	return String(doc.id)
}

/** A product carrying the same block, which is the whole point of the pair. */
export const seedProduct = async (request: APIRequestContext, name: string): Promise<string> => {
	const res = await request.post('/api/products', {
		data: {
			layout: [{ blockType: 'heroBanner', heading: 'Meet the new release' }],
			name,
			price: 49,
		},
	})
	const { doc } = (await res.json()) as { doc: { id: number | string } }
	return String(doc.id)
}

const PAGES = 'wiki-pages'

const PICKER_GUIDE_TITLE = 'Branding fields'

/**
 * A draft guide carrying two field targets already, so the Targets tab opens on
 * a populated list and picking a third reads as a change rather than as the
 * whole content of the shot.
 *
 * Drafts stay off every reading surface, which keeps this fixture out of the
 * other clips. Leftovers from an earlier render are removed by title first: the
 * dev database survives until the server restarts, and two of these would both
 * answer the locator the scene clicks.
 */
export const seedGuideFixture = async (request: APIRequestContext): Promise<string> => {
	const query = `depth=0&draft=true&limit=100&where[title][equals]=${encodeURIComponent(PICKER_GUIDE_TITLE)}`
	const existing = await request.get(`/api/${PAGES}?${query}`)
	const { docs } = (await existing.json()) as { docs: { id: number | string }[] }
	for (const doc of docs) {
		await request.delete(`/api/${PAGES}/${doc.id}`)
	}
	const res = await request.post(`/api/${PAGES}`, {
		data: {
			_status: 'draft',
			summary: 'Colour, icon, and tagline, and where each one shows up.',
			targetFields: ['collection:posts.intro', 'collection:posts.branding.accent'],
			title: PICKER_GUIDE_TITLE,
		},
	})
	const { doc } = (await res.json()) as { doc: { id: number | string } }
	return String(doc.id)
}
