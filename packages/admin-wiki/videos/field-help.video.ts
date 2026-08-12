import { defineVideo } from 'clipwright'
import { DRAWER_PANE, fieldWrap, openAdmin, resetPosts, seedPost, showcase } from './_helpers'

/**
 * The plugin's core claim: a guide renders under the field it documents, and
 * opens in full without leaving the document being edited.
 *
 * The drawer gets the longest beat in the clip, and some of the guide is
 * scrolled past inside it. A drawer that opens and is immediately dismissed
 * shows that a drawer exists; scrolling it is what shows there is a guide in
 * there.
 *
 * It ends by dismissing that drawer, which is both the claim (the form is still
 * sitting there, untouched) and what lets the clip loop back to its first frame
 * without a cut.
 */
let postId = ''

export default defineVideo({
	...showcase('field-help'),

	async beforeScene(setup) {
		await openAdmin(setup)
		await resetPosts(setup.request)
		postId = await seedPost(setup.request, 'Launch announcement')
	},

	async scene(s) {
		await s.goto(`/admin/collections/posts/${postId}`)
		await s.snapshot('field-help')

		const title = fieldWrap(s.page, 'title')
		const trigger = title.locator('.wiki-field-help__trigger')

		await s.zoomTo(title, { duration: 700, scale: 1.9 })
		await s.hover(trigger, { settle: 400 })
		await s.click(trigger)
		await s.wait(900)

		// Back to 1x first: the drawer slides in from the edge of the viewport,
		// which is outside any zoomed shot.
		await s.zoomOut({ duration: 600 })
		await s.click('.wiki-field-help__item-open')

		// The guide body is fetched when the drawer opens, so the drawer is on
		// screen before there is anything in it.
		await s.waitFor('.wiki-guide-article', { timeout: 30_000 })
		await s.wait(1400)

		await s.scrollUntil(s.page.locator('.wiki-guide-article h2').last(), {
			settle: 400,
			within: `.wiki-guide-drawer-modal ${DRAWER_PANE}`,
		})
		await s.wait(900)

		await s.press('Escape', { after: 800 })
	},
})
