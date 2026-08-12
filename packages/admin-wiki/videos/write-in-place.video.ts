import { defineVideo } from 'clipwright'
import {
	DRAWER_PANE,
	fieldWrap,
	openAdmin,
	resetPosts,
	seedPost,
	showcase,
	TAB_BUTTON,
} from './_helpers'

/**
 * Edit mode and the write affordance. The switch is flipped on the wiki's own
 * list view and the payoff is collected in a different document entirely, which
 * is the claim: it is a per-browser mode, not a per-page one.
 *
 * `branding.tagline` is the one branding field no seeded guide targets, and it
 * sits far enough down the form that the scene has to go looking for it.
 *
 * The clip ends inside the drawer rather than back on the form. Opening it is
 * not the point; the point is the target already sitting in the list, and that
 * lives one tab further in, because a guide keeps its targets on a tab of their
 * own.
 */
let postId = ''

export default defineVideo({
	...showcase('write-in-place'),

	async beforeScene(setup) {
		await openAdmin(setup)
		await resetPosts(setup.request)
		postId = await seedPost(setup.request, 'Field without a guide')
	},

	async scene(s) {
		await s.goto('/admin/collections/wiki-pages')
		await s.snapshot('write-in-place')

		await s.click('.wiki-edit-mode__pill')
		await s.wait(800)

		await s.goto(`/admin/collections/posts/${postId}`)
		await s.scrollUntil('#field-branding__tagline', { settle: 300 })

		const tagline = fieldWrap(s.page, 'branding.tagline')
		await s.zoomTo(tagline, { duration: 700, scale: 1.8 })
		await s.hover(tagline, { settle: 450 })
		await s.highlight(tagline.locator('.wiki-write-guide'), { for: 900, padding: 6 })

		// Back to 1x first: the create drawer slides in from the viewport edge,
		// which is outside any zoomed shot.
		await s.zoomOut({ duration: 600 })
		await s.click(tagline.locator('.wiki-write-guide'))

		// A real document form, so it arrives a request behind the animation.
		// Waiting on the tab strip waits on the form rather than on a guess.
		await s.waitFor(`.doc-drawer ${TAB_BUTTON}`, { timeout: 30_000 })
		await s.wait(1000)

		await s.click(s.page.locator(`.doc-drawer ${TAB_BUTTON}`, { hasText: 'Targets' }).first())
		await s.wait(800)

		const targets = s.page.locator('.doc-drawer #field-targetFields')
		await s.scrollUntil(targets, { settle: 300, within: `.doc-drawer ${DRAWER_PANE}` })
		await s.zoomTo(targets, { duration: 700, hold: 1800, scale: 1.5 })
	},
})
