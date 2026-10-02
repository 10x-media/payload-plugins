import type { Payload } from 'payload'
import { createLocalReq } from 'payload'

import { createAuditEvent } from '../../src/index'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

const TAG_NAMES = ['release', 'internal', 'draft']

/**
 * Seed the dev Payload app.
 *
 * An audit log is only interesting once something has happened, so this does not
 * just insert rows: it creates, updates and deletes documents so that the view at
 * `/admin/audit-logs` has one entry of every shape on first load. What each step
 * is meant to demonstrate is noted inline.
 *
 * Idempotent: the whole run is skipped once an admin user exists.
 */
export const seedDev = async (payload: Payload): Promise<void> => {
	const userCount = await payload.count({ collection: 'users' })
	if (userCount.totalDocs > 0) return

	const user = await payload.create({
		collection: 'users',
		data: { email: DEV_EMAIL, password: DEV_PASSWORD, name: 'Dev Admin' },
	})
	payload.logger.info(`Seeded dev admin: ${DEV_EMAIL} / ${DEV_PASSWORD}`)

	// Someone to impersonate. Nothing below runs as them, so their entries only
	// appear once you act as them from the admin.
	await payload.create({
		collection: 'users',
		data: { email: 'editor@10xmedia.de', password: DEV_PASSWORD, name: 'Dev Editor' },
	})

	// Everything below runs as the seeded admin, so the log shows a real user
	// rather than an empty `user` column.
	const req = { user: { ...user, collection: 'users' } } as Parameters<
		typeof payload.create
	>[0]['req']

	const tagIds: string[] = []
	for (const name of TAG_NAMES) {
		const tag = await payload.create({ collection: 'tags', data: { name }, req })
		tagIds.push(String(tag.id))
	}

	// create: `snapshotOnCreate` is on for posts, so this entry carries a full
	// snapshot instead of a null-to-value diff for every field.
	const post = await payload.create({
		collection: 'posts',
		data: {
			title: 'Audit logs playground',
			summary: 'Edit this document and watch the entries appear.',
			views: 0,
			status: 'draft',
			tags: tagIds.slice(0, 2),
			author: user.id,
			seo: { title: 'Playground', description: 'Seeded post' },
			sections: [
				{ heading: 'First', body: 'Section one' },
				{ heading: 'Second', body: 'Section two' },
			],
			internalNotes: 'Never logged: internalNotes is in excludeFields.',
			apiKey: 'sk-seed-0001',
		},
		req,
	})

	// update: a scalar, a group path and a relationship change in one save, so the
	// entry has three changed paths of three different shapes.
	await payload.update({
		collection: 'posts',
		id: post.id,
		data: {
			title: 'Audit logs playground (edited)',
			status: 'review',
			seo: { title: 'Playground v2', description: 'Seeded post' },
			tags: tagIds,
		},
		req,
	})

	// update: only an excluded field and an anonymized one. The excluded field
	// leaves no trace; `apiKey` appears in changedPaths with a redacted value.
	await payload.update({
		collection: 'posts',
		id: post.id,
		data: { internalNotes: 'Edited, and still invisible.', apiKey: 'sk-seed-0002' },
		req,
	})

	// update: array rows swapped, which produces a `sections.__order__` entry
	// rather than a diff of every field in every row.
	const seeded = await payload.findByID({ collection: 'posts', id: post.id })
	const sections = (seeded.sections ?? []) as { heading?: string; body?: string }[]
	await payload.update({
		collection: 'posts',
		id: post.id,
		data: { sections: [...sections].reverse() },
		req,
	})

	// delete: `snapshotOnDelete` is on, so the removed document is recoverable
	// from the entry.
	const throwaway = await payload.create({
		collection: 'posts',
		data: { title: 'Deleted on seed', summary: 'Only exists to produce a delete entry.' },
		req,
	})
	await payload.delete({ collection: 'posts', id: throwaway.id, req })

	// A draft save and a publish on the same document. `drafts: 'ignore'` means
	// only the publish is logged.
	const page = await payload.create({
		collection: 'pages',
		data: { title: 'Draft page', slug: 'draft-page', body: 'Draft body' },
		draft: true,
		req,
	})
	await payload.update({
		collection: 'pages',
		id: page.id,
		data: { title: 'Published page', body: 'Published body', _status: 'published' },
		req,
	})

	// The other half of the drafts comparison. Same content as the page above, but this
	// collection logs every draft save, so editing the two side by side shows the split.
	await payload.create({
		collection: 'articles',
		data: { title: 'Draft article', slug: 'draft-article', body: 'Draft body' },
		draft: true,
		req,
	})

	// Globals take a separate hook path and are stored under the `__global__`
	// sentinel with the global slug as documentId.
	await payload.updateGlobal({
		slug: 'site-settings',
		data: {
			siteName: 'Audit logs dev',
			tagline: 'Everything that happens, written down',
			contact: { email: 'dev@10xmedia.de', phone: '+49 000 000' },
			nav: [{ label: 'Home', url: '/' }],
		},
		req,
	})

	// Two writes sharing one `auditGroup` value, so the group column in the view
	// has something to filter on.
	const groupedReq = {
		...req,
		context: { auditGroup: 'seed-import' },
	} as typeof req
	await payload.update({
		collection: 'tags',
		id: tagIds[0] ?? '',
		data: { color: '#22c55e' },
		req: groupedReq,
	})
	await payload.update({
		collection: 'tags',
		id: tagIds[1] ?? '',
		data: { color: '#ef4444' },
		req: groupedReq,
	})

	// A second auth collection makes `user` polymorphic. The customer places an order,
	// so their entries sit next to the admin's in the list with their own pill.
	const customer = await payload.create({
		collection: 'customers',
		data: { email: 'customer@10xmedia.de', password: DEV_PASSWORD, name: 'Dev Customer' },
	})
	const customerReq = await createLocalReq(
		{ user: { ...customer, collection: 'customers' } as never },
		payload
	)
	const order = await payload.create({
		collection: 'orders',
		data: {
			reference: 'ord-1001',
			lines: [
				{ sku: 'TEE-M', price: 25 },
				{ sku: 'CAP', price: 15 },
			],
		},
		req: customerReq,
	})
	await createAuditEvent(customerReq, {
		collection: 'orders',
		documentId: order.id,
		eventType: 'checkout_started',
		metadata: { cartItems: 2, channel: 'web' },
	})

	// The admin takes it from there: marking it paid fires the `order_paid` event
	// from the orders hook, then a refund is recorded by hand.
	const adminReq = await createLocalReq(
		{ user: { ...user, collection: 'users' } as never },
		payload
	)
	await payload.update({
		collection: 'orders',
		id: order.id,
		data: { status: 'paid' },
		req: adminReq,
	})
	await createAuditEvent(adminReq, {
		collection: 'orders',
		documentId: order.id,
		eventType: 'order_refunded',
		metadata: { amount: 15, reason: 'Item out of stock', sku: 'CAP' },
	})

	// Collection-level, no document: nothing to link to, the row only names the collection.
	await createAuditEvent(adminReq, {
		collection: 'posts',
		eventType: 'export_downloaded',
		metadata: { format: 'csv', rows: 2 },
	})

	// A custom event can join a group like any write.
	await createAuditEvent(adminReq, {
		collection: 'tags',
		eventType: 'bulk_recolor',
		group: 'seed-import',
		metadata: { tags: 2 },
	})

	const logs = await payload.count({ collection: 'audit-logs' })
	payload.logger.info(`Seeded ${logs.totalDocs} audit log entries`)
}
