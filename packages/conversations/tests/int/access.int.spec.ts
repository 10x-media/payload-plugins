import { type BootedPayload, describeForDb } from '@10x-media/payload-test-harness'
import { createLocalReq } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { reactions } from '../../src/exports/reactions'
import { conversations, perTarget, postMessage } from '../../src/index'
import { UNREAD_CAP } from '../../src/server/reads'
import type { ConversationMessage, ConversationsChannel } from '../../src/types'
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

type Entry = {
	channels: Array<{ canCreate: boolean; slug: string }>
	count?: number
	key: string
	unread?: Record<string, number>
}

const ruleCalls: string[] = []

const isStaff = (req: { user?: { collection?: string } | null }) => req.user?.collection === 'users'

/** The fixture's channels, counting how often their rules run. */
const channels: ConversationsChannel[] = [
	{
		access: {
			create: ({ req }) => isStaff(req),
			read: ({ req }) => {
				ruleCalls.push('internal')
				return isStaff(req)
			},
		},
		label: 'Internal',
		slug: 'internal',
	},
	{
		access: { create: () => true, read: () => true },
		cue: ({ req }) => (isStaff(req) ? { label: 'Visible to customers', tone: 'warning' } : null),
		label: 'Shared',
		slug: 'shared',
	},
]

/**
 * Target-level rules, all in conversation access: a person named "Closed" is
 * read only, "Shared only" hides Internal, customers see their own persons.
 */
const access = perTarget(
	({ doc, req }) => {
		if (!isStaff(req)) return doc?.owner !== undefined && doc.owner === String(req.user?.id)
		if (doc?.name === 'Closed') return { create: [], read: true }
		if (doc?.name === 'Shared only') return ['shared']
		return true
	},
	{ load: true }
)

describeForDb('conversations access', {}, (db) => {
	let booted: BootedPayload
	let staff: Session
	let staff2: Session
	let stranger: Session

	const subscribe = async (session: Session, body: Record<string, unknown>) =>
		(
			await call<{ entries: Entry[] }>(booted, 'POST /conversations/comments/subscribe', {
				body,
				session,
			})
		).json.entries

	const person = async (name: string, owner?: string) =>
		`collection:persons:${(await booted.payload.create({ collection: 'persons', data: { name, owner } })).id}`

	beforeAll(async () => {
		booted = await boot(
			db,
			conversations(instanceOptions({ access, channels, extensions: [reactions()] })),
			[
				conversations(
					instanceOptions({
						access,
						channels,
						extensions: [reactions({ allowReadOnly: true })],
						mentions: { verifyAccess: true },
						slug: 'strict',
					})
				),
				// Everyone passes access, but only staff are its users.
				conversations(
					instanceOptions({
						access: perTarget(() => true),
						channels,
						slug: 'staff-only',
						users: ['users'],
					})
				),
			]
		)
		staff = await signUp(booted, 'users', 'Staff')
		staff2 = await signUp(booted, 'users', 'Staff Two')
		stranger = await signUp(booted, 'customers', 'Stranger')
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	describe('grants per target', () => {
		it('runs a channel rule once per request, however many keys', async () => {
			const keys = await Promise.all(['A', 'B', 'C', 'D'].map((name) => person(name)))
			ruleCalls.length = 0
			const entries = await subscribe(staff, { keys })
			expect(entries).toHaveLength(4)
			expect(ruleCalls).toEqual(['internal'])
		})

		it('gives users of a collection outside `users` nothing, whatever access says', async () => {
			const key = await person('Staff room')
			const as = (session: Session) =>
				call<{ entries: Entry[] }>(booted, 'POST /conversations/staff-only/subscribe', {
					body: { keys: [key] },
					session,
				})
			expect((await as(staff)).json.entries).toHaveLength(1)
			expect((await as(stranger)).json.entries).toEqual([])
			const sent = await call(booted, 'POST /conversations/staff-only/messages', {
				body: { channel: 'shared', clientId: crypto.randomUUID(), key, text: 'let me in' },
				session: stranger,
			})
			expect(sent.status).toBe(404)
		})

		it('answers malformed ids with 404 or 400, never a database error', async () => {
			const bad = 'collection:persons:not-an-id'
			expect(await subscribe(staff, { keys: [bad] })).toEqual([])
			const page = await call(booted, 'GET /conversations/comments/messages', {
				query: { channel: 'internal', key: bad },
				session: staff,
			})
			expect(page.status).toBe(404)
			const removed = await call(booted, 'DELETE /conversations/comments/messages/not-an-id', {
				session: staff,
			})
			expect(removed.status).toBe(404)
			const key = await person('Cursor')
			const before = await call(booted, 'GET /conversations/comments/messages', {
				query: { before: `${new Date().toISOString()},not-an-id`, channel: 'internal', key },
				session: staff,
			})
			expect(before.status).toBe(400)
		})

		it('narrows the channels of one target', async () => {
			const key = await person('Shared only')
			const [entry] = await subscribe(staff, { keys: [key] })
			expect(entry?.channels).toEqual([{ canCreate: true, slug: 'shared' }])
		})

		it('makes a conversation read only: no sends, edits or deletes, reading still works', async () => {
			const key = await person('Open for now')
			const sent = await call<{ message: ConversationMessage }>(
				booted,
				'POST /conversations/comments/messages',
				{ body: { channel: 'internal', key, text: 'before closing' }, session: staff }
			)
			const id = String(key.split(':').at(-1))
			await booted.payload.update({ collection: 'persons', data: { name: 'Closed' }, id })

			const [entry] = await subscribe(staff, { keys: [key] })
			expect(entry?.channels).toEqual([
				{ canCreate: false, slug: 'internal' },
				{ canCreate: false, slug: 'shared' },
			])
			const send = await call(booted, 'POST /conversations/comments/messages', {
				body: { channel: 'internal', key, text: 'after closing' },
				session: staff,
			})
			expect(send.status).toBe(403)
			const messageId = sent.json.message.id
			const edit = await call(booted, `PATCH /conversations/comments/messages/${messageId}`, {
				body: { text: 'changed' },
				session: staff,
			})
			expect(edit.status).toBe(403)
			const remove = await call(booted, `DELETE /conversations/comments/messages/${messageId}`, {
				session: staff,
			})
			expect(remove.status).toBe(403)
			const list = await call<{ messages: ConversationMessage[] }>(
				booted,
				'GET /conversations/comments/messages',
				{ query: { channel: 'internal', key }, session: staff }
			)
			expect(list.json.messages.map((message) => message.text)).toEqual(['before closing'])
		})

		it('freezes reactions in a read-only conversation unless the instance allows them', async () => {
			const key = await person('Open for reactions')
			const post = async (instance: string) =>
				(
					await call<{ message: ConversationMessage }>(
						booted,
						`POST /conversations/${instance}/messages`,
						{ body: { channel: 'internal', key, text: 'react later' }, session: staff }
					)
				).json.message
			const frozen = await post('comments')
			const open = await post('strict')
			await booted.payload.update({
				collection: 'persons',
				data: { name: 'Closed' },
				id: String(key.split(':').at(-1)),
			})
			const react = (instance: string, message: ConversationMessage, action: 'add' | 'remove') =>
				call(booted, `POST /conversations/${instance}/reactions/${action}`, {
					body: { emoji: '👍', message: message.id },
					session: staff,
				})
			expect((await react('comments', frozen, 'add')).status).toBe(403)
			expect((await react('comments', frozen, 'remove')).status).toBe(403)
			expect((await react('strict', open, 'add')).status).toBe(200)
		})
	})

	describe('subscribe', () => {
		it('resolves a cue for the viewer', async () => {
			const cueFor = async (session: Session) =>
				(
					await call<{ channels: Record<string, { cue?: { label: string } }> }>(
						booted,
						'POST /conversations/comments/subscribe',
						{ body: { keys: [] }, session }
					)
				).json.channels.shared?.cue
			expect(await cueFor(staff)).toEqual({ label: 'Visible to customers', tone: 'warning' })
			expect(await cueFor(stranger)).toBeUndefined()
		})

		it('counts messages only for the keys asked for', async () => {
			const [a, b] = [await person('Count A'), await person('Count B')]
			await call(booted, 'POST /conversations/comments/messages', {
				body: { channel: 'internal', key: a, text: 'one' },
				session: staff,
			})
			const all = await subscribe(staff, { keys: [a, b] })
			expect(all.map((entry) => entry.count)).toEqual([1, 0])
			const some = await subscribe(staff, { count: [b], keys: [a, b] })
			expect(some.map((entry) => entry.count)).toEqual([undefined, 0])
			const none = await subscribe(staff, { count: [], keys: [a, b] })
			expect(none.every((entry) => entry.count === undefined)).toBe(true)
		})

		it('counts unread in one query and recounts pairs a busy one crowded out', async () => {
			const [busy, quiet] = [await person('Busy'), await person('Quiet')]
			const req = await createLocalReq({}, booted.payload)
			// Two keys with two channels each: the shared query stops at 4 × the cap.
			for (let index = 0; index < UNREAD_CAP * 4; index++) {
				await postMessage(req, {
					author: staff.userKey,
					channel: 'internal',
					instance: 'comments',
					key: busy,
					text: `busy ${index}`,
				})
			}
			await postMessage(req, {
				author: staff.userKey,
				channel: 'shared',
				instance: 'comments',
				key: quiet,
				text: 'quiet',
			})
			const entries = await subscribe(staff2, { count: [], keys: [busy, quiet] })
			expect(entries.map((entry) => entry.unread)).toEqual([
				{ internal: UNREAD_CAP, shared: 0 },
				{ internal: 0, shared: 1 },
			])
		}, 120_000)
	})

	describe('mentions', () => {
		const mentionStranger = async (instance: 'comments' | 'strict', key: string) => {
			const res = await call<{ message: ConversationMessage }>(
				booted,
				`POST /conversations/${instance}/messages`,
				{
					body: {
						body: bodyOf(textNode('hey '), mentionNode(stranger.userKey, 'Stranger')),
						channel: 'shared',
						key,
					},
					session: staff,
				}
			)
			return res.json.message.mentions
		}

		it('keeps a mention of someone who passes the channel rule, not the target', async () => {
			const key = await person('Not the stranger’s')
			expect(await mentionStranger('comments', key)).toEqual([stranger.userKey])
		})

		it('drops it with verifyAccess', async () => {
			const key = await person('Not the stranger’s either')
			expect(await mentionStranger('strict', key)).toEqual([])
		})
	})
})
