import { defineVideo } from 'clipwright'
import { DRAWER_PANE, openAdmin, showcase } from './_helpers'

/**
 * The standalone reading view. The search lands on `editor-features-tour`: it
 * carries the most headings of the seeded guides, so the table of contents is
 * worth showing, and it ends on a cross-reference to another guide.
 *
 * The scroll down the guide is `scrollUntil` rather than `scrollTo`: the latter
 * is `scrollIntoViewIfNeeded`, which arrives instantly and reads as a cut. This
 * one is paced, and it passes the callouts and the embedded video on its way to
 * the guide link, which is why there is no separate stop at them.
 *
 * The link opens its target in a drawer rather than navigating, so the camera is
 * back at 1x before it is clicked.
 */
export default defineVideo({
	...showcase('wiki-view'),

	async beforeScene(setup) {
		await openAdmin(setup)
	},

	async scene(s) {
		await s.goto('/admin/wiki')
		await s.snapshot('wiki-view')
		await s.wait(500)

		await s.typeInto('.wiki-index__controls input', 'editor', { delay: 90 })
		await s.wait(700)

		await s.click(
			s.page.locator('.wiki-index__row-link', { hasText: 'Editor features tour' }).first()
		)
		await s.wait(1300)

		await s.zoomTo('.wiki-toc', { duration: 700, hold: 600, scale: 1.7 })
		await s.zoomOut({ duration: 600 })

		await s.scrollUntil('.wiki-guide-link', { settle: 350 })
		await s.click('.wiki-guide-link')

		await s.waitFor(`.wiki-guide-drawer-modal ${DRAWER_PANE} .wiki-guide-article`, {
			timeout: 30_000,
		})
		await s.wait(2200)

		await s.press('Escape', { after: 800 })
	},
})
