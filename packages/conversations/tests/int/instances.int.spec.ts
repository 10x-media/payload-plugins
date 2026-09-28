import { type BootedPayload, describeForDb } from '@10x-media/payload-test-harness'
import { createLocalReq } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { conversations, defineMessageType, postMessage, touchMessage } from '../../src/index'
import type { ConversationMessage } from '../../src/types'
import { boot, call, channels, instanceOptions, type Session, signUp } from './fixture'

const statusChange = defineMessageType<{ from: string; to: string }>()({
	slug: 'ticket.status',
	validate: (data) => (data?.to ? true : 'to is required'),
})

const cascaded: string[] = []

describeForDb('conversations instances', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let staff: Session

	beforeAll(async () => {
		booted = await boot(db, conversations(instanceOptions({ types: [statusChange] })), [
			conversations({
				access: ({ targets }) => targets.map((target) => target.key),
				channels,
				deleteWithTarget: false,
				reads: false,
				slug: 'tickets',
				targets: { collections: { persons: { channels: ['shared'] } } },
			}),
			conversations({
				access: ({ targets }) => targets.map((target) => target.key),
				channels,
				deleteWithTarget: ({ key }) => {
					cascaded.push(key)
				},
				slug: 'custom-cascade',
				targets: { collections: { media: { channels: ['internal'] } } },
			}),
			conversations({
				access: ({ targets }) => targets.map((target) => target.key),
				channels,
				components: { Message: '/components/KeptMessage#KeptMessage' },
				deleted: 'placeholder',
				slug: 'kept',
				targets: { collections: { persons: { channels: ['internal'] } } },
			}),
		])
		staff = await signUp(booted, 'users', 'Staff')
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	it('registers each instance with its own collections and endpoints', async () => {
		const slugs = booted.payload.config.collections.map((collection) => collection.slug)
		expect(slugs).toEqual(
			expect.arrayContaining(['comments-messages', 'comments-reads', 'tickets-messages'])
		)
		expect(slugs).not.toContain('tickets-reads')
		// A replacement message component lives only in plugin options; the import map finds it here.
		expect(
			booted.payload.config.admin.dependencies?.['conversations-kept-component-Message']
		).toEqual({
			path: '/components/KeptMessage#KeptMessage',
			type: 'component',
		})

		const person = await booted.payload.create({ collection: 'persons', data: { name: 'P' } })
		const key = `collection:persons:${person.id}`
		await call(booted, 'POST /conversations/comments/messages', {
			body: { channel: 'internal', key, text: 'comment' },
			session: staff,
		})
		await call(booted, 'POST /conversations/tickets/messages', {
			body: { channel: 'shared', key, text: 'ticket' },
			session: staff,
		})
		const comments = await booted.payload.find({
			collection: 'comments-messages',
			where: { key: { equals: key } },
		})
		const tickets = await booted.payload.find({
			collection: 'tickets-messages',
			where: { key: { equals: key } },
		})
		expect(comments.docs.map((doc) => doc.text)).toEqual(['comment'])
		expect(tickets.docs.map((doc) => doc.text)).toEqual(['ticket'])

		const sub = await call<{ entries: Array<{ unread?: unknown }>; reads: boolean }>(
			booted,
			'POST /conversations/tickets/subscribe',
			{ body: { keys: [key] }, session: staff }
		)
		expect(sub.json.reads).toBe(false)
		expect(sub.json.entries[0]?.unread).toBeUndefined()
	})

	describe('cascade', () => {
		it('deletes the conversation with its target by default, and not where disabled', async () => {
			const person = await booted.payload.create({ collection: 'persons', data: { name: 'Gone' } })
			const key = `collection:persons:${person.id}`
			for (const instance of ['comments', 'tickets']) {
				await call(booted, `POST /conversations/${instance}/messages`, {
					body: { channel: instance === 'comments' ? 'internal' : 'shared', key, text: 'x' },
					session: staff,
				})
			}
			await booted.payload.delete({ collection: 'persons', id: person.id })
			const where = { key: { equals: key } }
			expect(
				(await booted.payload.count({ collection: 'comments-messages', where })).totalDocs
			).toBe(0)
			expect((await booted.payload.count({ collection: 'comments-reads', where })).totalDocs).toBe(
				0
			)
			expect(
				(await booted.payload.count({ collection: 'tickets-messages', where })).totalDocs
			).toBe(1)
		})

		it('hands the key to a custom cascade', async () => {
			const media = await booted.payload.create({ collection: 'media', data: { title: 'm' } })
			await booted.payload.delete({ collection: 'media', id: media.id })
			expect(cascaded).toContain(`collection:media:${media.id}`)
		})
	})

	describe('deleted placeholders', () => {
		it('keeps counting a deleted reply that still shows', async () => {
			const person = await booted.payload.create({ collection: 'persons', data: { name: 'K' } })
			const key = `collection:persons:${person.id}`
			const root = await call<{ message: ConversationMessage }>(
				booted,
				'POST /conversations/kept/messages',
				{ body: { channel: 'internal', key, text: 'root' }, session: staff }
			)
			const reply = await call<{ message: ConversationMessage }>(
				booted,
				'POST /conversations/kept/messages',
				{ body: { key, parent: String(root.json.message.id), text: 'reply' }, session: staff }
			)
			await call(booted, `DELETE /conversations/kept/messages/${reply.json.message.id}`, {
				session: staff,
			})
			const stored = (await booted.payload.findByID({
				collection: 'kept-messages',
				id: root.json.message.id,
			})) as unknown as ConversationMessage
			expect(stored.replyCount).toBe(1)
		})
	})

	describe('server helpers', () => {
		it('posts any type from server code and validates its data', async () => {
			const person = await booted.payload.create({ collection: 'persons', data: { name: 'T' } })
			const key = `collection:persons:${person.id}`
			const req = await createLocalReq({}, booted.payload)
			const message = await postMessage(req, {
				author: staff.userKey,
				channel: 'internal',
				data: { from: 'open', to: 'closed' },
				instance: 'comments',
				key,
				type: 'ticket.status',
			})
			expect(message.type).toBe('ticket.status')
			expect(message.authorKey).toBe(staff.userKey)
			const cursor = await booted.payload.find({
				collection: 'comments-reads',
				where: { and: [{ userKey: { equals: staff.userKey } }, { key: { equals: key } }] },
			})
			expect(cursor.docs.map((doc) => new Date(doc.lastReadAt).toISOString())).toEqual([
				new Date(message.createdAt).toISOString(),
			])
			await expect(
				postMessage(req, {
					author: staff.userKey,
					channel: 'internal',
					data: { from: 'open' },
					instance: 'comments',
					key,
					type: 'ticket.status',
				})
			).rejects.toThrow(/to is required/)

			const before = message.updatedAt
			await new Promise((resolve) => setTimeout(resolve, 5))
			await touchMessage(req, { id: message.id, instance: 'comments' })
			const touched = (await booted.payload.findByID({
				collection: 'comments-messages',
				id: message.id,
			})) as unknown as ConversationMessage
			expect(new Date(touched.updatedAt).getTime()).toBeGreaterThan(new Date(before).getTime())
		})

		it('refuses a custom type from clients unless it is client-creatable', async () => {
			const person = await booted.payload.create({ collection: 'persons', data: { name: 'C' } })
			const res = await call(booted, 'POST /conversations/comments/messages', {
				body: {
					channel: 'internal',
					data: { from: 'a', to: 'b' },
					key: `collection:persons:${person.id}`,
					type: 'ticket.status',
				},
				session: staff,
			})
			expect(res.status).toBe(400)
		})
	})
})
