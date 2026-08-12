import { defineVideo } from 'clipwright'
import { openAdmin, resetPosts, seedPost, seedProduct, showcase } from './_helpers'

/**
 * A block is its own root, so a guide written on it follows it into every
 * collection that renders it. The clip says that by showing the same two guides
 * on the same block in two different collections, which is the one claim in
 * targeting that reads as a technicality on the page and as obvious on screen.
 *
 * Nothing is clicked. The help trigger prints its guide's title inline, so both
 * surfaces (a guide on `block:heroBanner`, another on `block:heroBanner.heading`)
 * are legible from the camera alone.
 */
let postId = ''
let productId = ''

export default defineVideo({
	...showcase('shared-block'),

	async beforeScene(setup) {
		await openAdmin(setup)
		await resetPosts(setup.request)
		postId = await seedPost(setup.request, 'Launch announcement')
		productId = await seedProduct(setup.request, 'Field kit')
	},

	async scene(s) {
		await s.goto(`/admin/collections/posts/${postId}`)
		await s.snapshot('shared-block')

		await s.scrollUntil('.wiki-block-help', { settle: 300 })
		await s.zoomTo('#field-layout', { duration: 700, hold: 1100, scale: 1.5 })
		await s.zoomOut({ duration: 500 })

		await s.goto(`/admin/collections/products/${productId}`)
		await s.scrollUntil('.wiki-block-help', { settle: 300 })
		await s.zoomTo('#field-layout', { duration: 700, hold: 1300, scale: 1.5 })
		await s.zoomOut({ duration: 500 })
	},
})
