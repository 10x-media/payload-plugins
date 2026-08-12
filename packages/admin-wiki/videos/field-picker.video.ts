import { defineVideo } from 'clipwright'
import {
	openAdmin,
	PICKER_PANE,
	pickerField,
	seedGuideFixture,
	showcase,
	TAB_BUTTON,
} from './_helpers'

/**
 * The field target picker: a guide's targets are chosen off the real form,
 * rendered with the host's own labels, layout and field components, rather than
 * typed as schema paths.
 *
 * The clip picks `title`, which sits at the top of the post form and needs no
 * scrolling. Anything deeper would spend most of the runtime travelling, and the
 * plate is the same plate wherever it is.
 *
 * `waitFor` rather than a fixed pause after the kind is chosen: the drawer opens
 * immediately and its fields arrive from Payload's `form-state` server function,
 * so the plates are a round trip behind it and how long that takes is the dev
 * server's business, not the scene's.
 */
let guideId = ''

export default defineVideo({
	...showcase('field-picker'),

	async beforeScene(setup) {
		await openAdmin(setup)
		guideId = await seedGuideFixture(setup.request)
	},

	async scene(s) {
		await s.goto(`/admin/collections/wiki-pages/${guideId}`)
		await s.snapshot('field-picker')

		await s.click(s.page.locator(TAB_BUTTON, { hasText: 'Targets' }).first())
		await s.wait(700)

		await s.click('.wiki-target-fields__open')
		await s.wait(400)
		await s.click(s.page.locator('.popup-button-list__button', { hasText: 'Collection' }).first())

		await s.waitFor(`${PICKER_PANE} .wiki-field-pick`, { timeout: 30_000 })
		await s.wait(600)

		const title = pickerField(s.page, 'title')
		await s.click(title.locator('.wiki-field-pick'))
		await s.wait(800)

		await s.zoomOut({ duration: 600 })
		await s.click(s.page.locator('.wiki-field-picker__footer button', { hasText: 'Apply' }))
		await s.wait(1000)

		await s.highlight('#field-targetFields', { for: 1100 })
	},
})
