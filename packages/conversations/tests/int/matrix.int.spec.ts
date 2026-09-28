import { type BootedPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { comments } from '../../src/comments'
import { conversations } from '../../src/index'
import type { AuthorsMap, ConversationMessage } from '../../src/types'
import {
	bodyOf,
	boot,
	call,
	instanceOptions,
	mentionNode,
	type Session,
	signUp,
	textNode,
} from './fixture'

type Sent = { authors: AuthorsMap; message: ConversationMessage; root?: ConversationMessage }
type Page = {
	authors: AuthorsMap
	cursor?: null | string
	hasNewer: boolean
	hasOlder: boolean
	messages: Array<ConversationMessage & { removed?: boolean }>
	threadReads?: Record<string, string>
}

const mentions: Array<{ key: string; users: string[] }> = []
const written: Array<{ id: string; operation: string }> = []

describeForDb('conversations core', {}, (db) => {
	let booted: BootedPayload
	let staff: Session
	let staff2: Session
	let customer: Session
	let stranger: Session
	let personKey: string
	let otherKey: string

	const send = (session: Session, body: Record<string, unknown>) =>
		call<Sent>(booted, 'POST /conversations/comments/messages', { body, session })

	const list = (session: Session, query: Record<string, string | string[]>) =>
		call<Page>(booted, 'GET /conversations/comments/messages', { query, session })

	beforeAll(async () => {
		booted = await boot(
			db,
			conversations(
				instanceOptions({
					extensions: [comments({ globals: { settings: ['internal'] } })],
					hooks: {
						afterMention: ({ key, users }) => {
							mentions.push({ key, users: users.map((u) => `${u.collection}:${u.id}`) })
						},
						afterMessage: ({ message, operation }) => {
							written.push({ id: String(message.id), operation })
						},
					},
				})
			)
		)
		staff = await signUp(booted, 'users', 'Staff One')
		staff2 = await signUp(booted, 'users', 'Staff Two')
		customer = await signUp(booted, 'customers', 'Customer')
		stranger = await signUp(booted, 'customers', 'Stranger')
		const person = await booted.payload.create({
			collection: 'persons',
			data: { name: 'Athlete', owner: String(customer.id) },
		})
		const other = await booted.payload.create({ collection: 'persons', data: { name: 'Other' } })
		personKey = `collection:persons:${person.id}`
		otherKey = `collection:persons:${other.id}`
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	describe('access', () => {
		it('requires a signed-in user', async () => {
			const res = await call(booted, 'POST /conversations/comments/subscribe', {
				body: { keys: [personKey] },
			})
			expect(res.status).toBe(401)
		})

		it('returns per-key channels for the viewer', async () => {
			const staffView = await call<{ entries: Array<{ channels: unknown[]; key: string }> }>(
				booted,
				'POST /conversations/comments/subscribe',
				{ body: { keys: [personKey, otherKey, 'collection:unknown:1'] }, session: staff }
			)
			expect(staffView.json.entries.map((entry) => entry.key).sort()).toEqual(
				[personKey, otherKey].sort()
			)
			const customerView = await call<{
				entries: Array<{ channels: Array<{ canCreate: boolean; slug: string }>; key: string }>
			}>(booted, 'POST /conversations/comments/subscribe', {
				body: { keys: [personKey, otherKey] },
				session: customer,
			})
			expect(customerView.json.entries).toHaveLength(1)
			expect(customerView.json.entries[0]?.channels).toEqual([{ canCreate: true, slug: 'shared' }])
		})

		it('hides a conversation from a user without access', async () => {
			const res = await list(stranger, { channel: 'shared', key: personKey })
			expect(res.status).toBe(404)
		})

		it('refuses a channel the user cannot create in', async () => {
			const res = await send(customer, { channel: 'internal', key: personKey, text: 'hi' })
			expect(res.status).toBe(403)
		})

		it('keeps both collections closed over REST', async () => {
			await send(staff, { channel: 'internal', key: personKey, text: 'rest check' })
			for (const slug of ['comments-messages', 'comments-reads']) {
				const res = await call<{ docs?: unknown[] }>(booted, `GET /${slug}`, { session: staff })
				expect(res.status).toBe(403)
			}
		})
	})

	describe('sending', () => {
		it('sends plain text as a body and derives text', async () => {
			const res = await send(staff, { channel: 'internal', key: personKey, text: 'hello\nworld' })
			expect(res.status).toBe(201)
			expect(res.json.message.text).toBe('hello\nworld')
			expect(res.json.message.authorKey).toBe(staff.userKey)
			expect(res.json.authors[staff.userKey]?.name).toBe('Staff One')
		})

		it('returns the same message for a retried clientId', async () => {
			const first = await send(staff, {
				channel: 'internal',
				clientId: 'retry-1',
				key: personKey,
				text: 'once',
			})
			const again = await send(staff, {
				channel: 'internal',
				clientId: 'retry-1',
				key: personKey,
				text: 'once',
			})
			expect(again.json.message.id).toBe(first.json.message.id)
		})

		it('rejects disallowed link schemes and empty messages', async () => {
			const link = {
				children: [textNode('x')],
				fields: { linkType: 'custom', url: 'javascript:alert(1)' },
				type: 'link',
				version: 1,
			}
			expect(
				(await send(staff, { body: bodyOf(link), channel: 'internal', key: personKey })).status
			).toBe(400)
			expect((await send(staff, { channel: 'internal', key: personKey, text: '   ' })).status).toBe(
				400
			)
		})

		it('rejects a body over the byte limit however short its text', async () => {
			const body = bodyOf(textNode('x'))
			const [paragraph] = body.root.children
			for (let i = 0; i < 1500; i++) {
				if (paragraph) body.root.children.push({ ...paragraph, children: [] })
			}
			const res = await send(staff, { body, channel: 'internal', key: personKey })
			expect(res.status).toBe(400)
		})

		it('keeps mentions of readers only and reports them once', async () => {
			const res = await send(staff, {
				body: bodyOf(
					textNode('ping '),
					mentionNode(staff2.userKey, 'Staff Two'),
					mentionNode(customer.userKey, 'Customer')
				),
				channel: 'internal',
				key: personKey,
			})
			expect(res.json.message.text).toBe('ping @Staff Two@Customer')
			// The customer cannot read `internal`, so the mention stays text only.
			expect(res.json.message.mentions).toEqual([staff2.userKey])
			expect(mentions.at(-1)).toEqual({ key: personKey, users: [staff2.userKey] })

			const count = mentions.length
			const edited = await call<Sent>(
				booted,
				`PATCH /conversations/comments/messages/${res.json.message.id}`,
				{
					body: {
						body: bodyOf(textNode('ping again '), mentionNode(staff2.userKey, 'Staff Two')),
					},
					session: staff,
				}
			)
			expect(edited.status).toBe(200)
			expect(edited.json.message.editedAt).toBeTruthy()
			expect(mentions).toHaveLength(count)

			const staff3 = await signUp(booted, 'users', 'Staff Three')
			await call(booted, `PATCH /conversations/comments/messages/${res.json.message.id}`, {
				body: {
					body: bodyOf(
						textNode('and '),
						mentionNode(staff2.userKey, 'Staff Two'),
						mentionNode(staff3.userKey, 'Staff Three')
					),
				},
				session: staff,
			})
			expect(mentions.slice(count)).toEqual([{ key: personKey, users: [staff3.userKey] }])
		})

		it('tells afterMessage whether a message was created, updated or deleted', async () => {
			const res = await send(staff, { channel: 'internal', key: personKey, text: 'lifecycle' })
			const id = String(res.json.message.id)
			await call(booted, `PATCH /conversations/comments/messages/${id}`, {
				body: { text: 'lifecycle, edited' },
				session: staff,
			})
			await call(booted, `DELETE /conversations/comments/messages/${id}`, { session: staff })
			expect(written.filter((entry) => entry.id === id).map((entry) => entry.operation)).toEqual([
				'create',
				'update',
				'delete',
			])
		})

		it('lets only the author edit by default', async () => {
			const res = await send(staff, { channel: 'internal', key: personKey, text: 'mine' })
			const other = await call(
				booted,
				`PATCH /conversations/comments/messages/${res.json.message.id}`,
				{ body: { text: 'theirs' }, session: staff2 }
			)
			expect(other.status).toBe(403)
		})
	})

	describe('threads', () => {
		it('counts 20 concurrent replies exactly', async () => {
			const root = await send(staff, { channel: 'internal', key: otherKey, text: 'root' })
			const rootId = String(root.json.message.id)
			const replies = await Promise.all(
				Array.from({ length: 20 }, (_, index) =>
					send(index % 2 ? staff : staff2, {
						channel: 'shared',
						key: otherKey,
						parent: rootId,
						text: `reply ${index}`,
					})
				)
			)
			expect(replies.every((reply) => reply.status === 201)).toBe(true)
			// A reply takes the root's channel whatever the client said.
			expect(replies.every((reply) => reply.json.message.channel === 'internal')).toBe(true)
			const stored = (await booted.payload.findByID({
				collection: 'comments-messages',
				id: rootId,
			})) as unknown as ConversationMessage
			expect(stored.replyCount).toBe(20)
			expect(stored.lastReplyAt).toBeTruthy()

			const thread = await list(staff, { channel: 'internal', key: otherKey, parent: rootId })
			expect(thread.json.messages).toHaveLength(20)
		})

		it('answers a reply with its root as it now is, and a root send without one', async () => {
			const root = await send(staff, { channel: 'internal', key: otherKey, text: 'root' })
			expect(root.json.root).toBeUndefined()
			const rootId = String(root.json.message.id)
			const reply = await send(staff, {
				channel: 'internal',
				key: otherKey,
				parent: rootId,
				text: 'first',
			})
			expect(reply.json.root?.id).toBe(root.json.message.id)
			expect(reply.json.root?.replyCount).toBe(1)
			expect(reply.json.root?.lastReplyAt).toBe(reply.json.message.createdAt)
			const removed = await call<{ root?: ConversationMessage }>(
				booted,
				`DELETE /conversations/comments/messages/${String(reply.json.message.id)}`,
				{ session: staff }
			)
			expect(removed.json.root?.replyCount).toBe(0)
		})

		it('rejects a reply to a reply', async () => {
			const root = await send(staff, { channel: 'internal', key: otherKey, text: 'root' })
			const reply = await send(staff, {
				key: otherKey,
				parent: String(root.json.message.id),
				text: 'reply',
			})
			const nested = await send(staff, {
				key: otherKey,
				parent: String(reply.json.message.id),
				text: 'nested',
			})
			expect(nested.status).toBe(400)
		})
	})

	describe('thread read state', () => {
		it('keeps a thread cursor apart from the channel cursor', async () => {
			const root = await send(staff, { channel: 'internal', key: otherKey, text: 'thread root' })
			const rootId = String(root.json.message.id)
			const reply = await send(staff, {
				channel: 'internal',
				key: otherKey,
				parent: rootId,
				text: 'thread reply',
			})
			const at = reply.json.message.createdAt
			await call(booted, 'POST /conversations/comments/read', {
				body: { at, key: otherKey, thread: rootId },
				session: staff2,
			})
			const feed = await list(staff2, { channel: 'internal', key: otherKey })
			expect(feed.json.threadReads?.[rootId]).toBe(at)
			const thread = await list(staff2, { channel: 'internal', key: otherKey, parent: rootId })
			expect(thread.json.cursor).toBe(at)
		})
	})

	describe('global targets', () => {
		const key = 'global:settings'

		it('adds the comments button to the global', () => {
			const settings = booted.payload.config.globals.find((global) => global.slug === 'settings')
			expect(settings?.admin?.components?.elements?.beforeDocumentControls).toEqual([
				{
					clientProps: { instance: 'comments' },
					path: '@10x-media/conversations/client#ChatTrigger',
				},
			])
		})

		it('subscribes, sends and lists on a global, for those with access only', async () => {
			const entries = async (session: Session) =>
				(
					await call<{ entries: Array<{ channels: Array<{ slug: string }>; key: string }> }>(
						booted,
						'POST /conversations/comments/subscribe',
						{ body: { keys: [key] }, session }
					)
				).json.entries
			expect((await entries(staff))[0]?.channels.map((channel) => channel.slug)).toEqual([
				'internal',
			])
			expect(await entries(customer)).toEqual([])

			const sent = await send(staff, { channel: 'internal', key, text: 'on the global' })
			expect(sent.status).toBe(201)
			const page = await list(staff2, { channel: 'internal', key })
			expect(page.json.messages.map((message) => message.text)).toEqual(['on the global'])
			expect((await list(customer, { channel: 'internal', key })).status).toBe(404)
		})
	})

	describe('feed', () => {
		let key: string
		beforeAll(async () => {
			const person = await booted.payload.create({ collection: 'persons', data: { name: 'Feed' } })
			key = `collection:persons:${person.id}`
			// Written directly with one shared timestamp, so keyset ties are real.
			const at = new Date('2026-01-01T10:00:00.000Z').toISOString()
			for (let index = 0; index < 7; index++) {
				await booted.payload.db.create({
					collection: 'comments-messages',
					data: {
						authorKey: staff.userKey,
						channel: 'internal',
						clientId: `feed-${index}`,
						createdAt: at,
						key,
						parent: null,
						replyCount: 0,
						text: `m${index}`,
						type: 'text',
						updatedAt: at,
					},
				})
			}
		})

		it('pages backwards through equal timestamps without gaps or repeats', async () => {
			const seen: string[] = []
			let page = await list(staff, { channel: 'internal', key, latest: '1', limit: '3' })
			seen.unshift(...page.json.messages.map((m) => String(m.text)))
			while (page.json.hasOlder) {
				const first = page.json.messages[0] as ConversationMessage
				page = await list(staff, {
					before: `${first.createdAt},${first.id}`,
					channel: 'internal',
					key,
					limit: '3',
				})
				seen.unshift(...page.json.messages.map((m) => String(m.text)))
			}
			expect(new Set(seen).size).toBe(7)
			expect(seen).toHaveLength(7)
		})

		it('reports changed keys with overlap through poll tokens', async () => {
			const sub = await call<{ entries: Array<{ key: string; token: string }>; now: string }>(
				booted,
				'POST /conversations/comments/subscribe',
				{ body: { keys: [key, personKey] }, session: staff }
			)
			const tokens = sub.json.entries.map((entry) => entry.token)
			await send(staff, { channel: 'internal', key, text: 'fresh' })
			const polled = await call<{ changed: string[]; now: string }>(
				booted,
				'POST /conversations/comments/poll',
				{ body: { since: sub.json.now, tokens }, session: staff }
			)
			expect(polled.json.changed).toContain(key)

			const foreign = await call<{ changed: string[]; expired: string[] }>(
				booted,
				'POST /conversations/comments/poll',
				{ body: { since: sub.json.now, tokens }, session: staff2 }
			)
			expect(foreign.json.changed).toEqual([])
			expect(foreign.json.expired).toHaveLength(tokens.length)
		})
	})

	describe('read state', () => {
		it('counts unread, excludes own messages, and raises monotonically', async () => {
			const person = await booted.payload.create({ collection: 'persons', data: { name: 'Reads' } })
			const key = `collection:persons:${person.id}`
			await send(staff, { channel: 'internal', key, text: 'one' })
			const second = await send(staff, { channel: 'internal', key, text: 'two' })
			const unread = async (session: Session) => {
				const res = await call<{ entries: Array<{ unread?: Record<string, number> }> }>(
					booted,
					'POST /conversations/comments/subscribe',
					{ body: { keys: [key] }, session }
				)
				return res.json.entries[0]?.unread
			}
			expect(await unread(staff)).toEqual({ internal: 0, shared: 0 })
			expect(await unread(staff2)).toEqual({ internal: 2, shared: 0 })

			const at = second.json.message.createdAt
			await Promise.all(
				Array.from({ length: 5 }, () =>
					call(booted, 'POST /conversations/comments/read', {
						body: { at, channels: ['internal'], key },
						session: staff2,
					})
				)
			)
			expect(await unread(staff2)).toEqual({ internal: 0, shared: 0 })
			await call(booted, 'POST /conversations/comments/read', {
				body: { at: '2000-01-01T00:00:00.000Z', channels: ['internal'], key },
				session: staff2,
			})
			expect(await unread(staff2)).toEqual({ internal: 0, shared: 0 })
			const rows = await booted.payload.find({
				collection: 'comments-reads',
				where: { and: [{ userKey: { equals: staff2.userKey } }, { key: { equals: key } }] },
			})
			expect(rows.totalDocs).toBe(1)
		})
	})

	describe('read state per channel', () => {
		it('keeps another channel unread when the viewer posts in one', async () => {
			const person = await booted.payload.create({
				collection: 'persons',
				data: { name: 'Channels' },
			})
			const key = `collection:persons:${person.id}`
			await send(staff2, { channel: 'shared', key, text: 'for the customer' })
			await send(staff, { channel: 'internal', key, text: 'staff note' })
			const res = await call<{ entries: Array<{ unread?: Record<string, number> }> }>(
				booted,
				'POST /conversations/comments/subscribe',
				{ body: { keys: [key] }, session: staff }
			)
			expect(res.json.entries[0]?.unread).toEqual({ internal: 0, shared: 1 })
		})
	})

	describe('deleting', () => {
		it('wipes content, keeps a root with replies as a placeholder, removes the rest', async () => {
			const person = await booted.payload.create({ collection: 'persons', data: { name: 'Del' } })
			const key = `collection:persons:${person.id}`
			const lonely = await send(staff, { channel: 'internal', key, text: 'lonely' })
			const root = await send(staff, { channel: 'internal', key, text: 'root' })
			const reply = await send(staff, { key, parent: String(root.json.message.id), text: 'r' })

			for (const id of [lonely.json.message.id, root.json.message.id, reply.json.message.id]) {
				const res = await call(booted, `DELETE /conversations/comments/messages/${id}`, {
					session: staff,
				})
				expect(res.status).toBe(200)
			}
			const stored = (await booted.payload.findByID({
				collection: 'comments-messages',
				id: root.json.message.id,
			})) as unknown as ConversationMessage
			expect(stored.text).toBeNull()
			expect(stored.deletedAt).toBeTruthy()
			expect(stored.replyCount).toBe(0)

			const feed = await list(staff, { channel: 'internal', key })
			// The root had a reply when deleted but its count is now 0, so it is gone too.
			expect(feed.json.messages.map((m) => m.id)).toEqual([])
		})

		it('keeps a deleted message empty when the Local API writes a body', async () => {
			const sent = await send(staff, { channel: 'internal', key: personKey, text: 'gone' })
			const id = sent.json.message.id
			await call(booted, `DELETE /conversations/comments/messages/${id}`, { session: staff })
			await booted.payload.update({
				collection: 'comments-messages',
				data: { body: bodyOf(textNode('back')) },
				id,
			})
			const stored = (await booted.payload.findByID({
				collection: 'comments-messages',
				id,
			})) as unknown as ConversationMessage
			expect(stored.body ?? null).toBeNull()
			expect(stored.text).toBeNull()
		})

		it('keeps a deleted root that still has replies', async () => {
			const person = await booted.payload.create({ collection: 'persons', data: { name: 'Del2' } })
			const key = `collection:persons:${person.id}`
			const root = await send(staff, { channel: 'internal', key, text: 'root' })
			await send(staff, { key, parent: String(root.json.message.id), text: 'r' })
			await call(booted, `DELETE /conversations/comments/messages/${root.json.message.id}`, {
				session: staff,
			})
			const feed = await list(staff, { channel: 'internal', key })
			expect(feed.json.messages).toHaveLength(1)
			expect(feed.json.messages[0]?.deletedAt).toBeTruthy()
			expect(feed.json.messages[0]?.text).toBeNull()
		})
	})

	describe('authors', () => {
		it('projects authors across auth collections and marks deleted users', async () => {
			const person = await booted.payload.create({
				collection: 'persons',
				data: { name: 'Auth', owner: String(customer.id) },
			})
			const key = `collection:persons:${person.id}`
			const gone = await signUp(booted, 'users', 'Gone')
			await send(customer, { channel: 'shared', key, text: 'from a customer' })
			await send(gone, { channel: 'shared', key, text: 'from someone leaving' })
			await booted.payload.delete({ collection: 'users', id: gone.id })
			const feed = await list(staff, { channel: 'shared', key })
			expect(feed.json.authors[customer.userKey]).toEqual({ avatar: null, name: 'Customer' })
			expect(feed.json.authors[gone.userKey]).toEqual({ deleted: true, name: 'Deleted user' })
		})

		it('searches mentionable users who can read the channel', async () => {
			const res = await call<{ users: Array<{ name: string; userKey: string }> }>(
				booted,
				'GET /conversations/comments/mentions',
				{ query: { channel: 'internal', key: personKey, q: 'Staff' }, session: staff }
			)
			const keys = res.json.users.map((user) => user.userKey)
			expect(keys).toContain(staff2.userKey)
			expect(keys).not.toContain(customer.userKey)
		})
	})
})
