import { type BootedPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { reactions } from '../../src/exports/reactions'
import { conversations } from '../../src/index'
import type { ReactionSummary } from '../../src/reactions/shared'
import type { ConversationMessage } from '../../src/types'
import { boot, call, instanceOptions, type Session, signUp } from './fixture'

type Message = ConversationMessage & { removed?: boolean }
type Page = { messages: Message[] }

const summaries = (message: Message | undefined): ReactionSummary[] =>
	(message?.ext?.reactions as ReactionSummary[] | undefined) ?? []

for (const storage of ['collection', 'message'] as const)
	describeForDb(`reactions extension, ${storage} storage`, {}, (db) => {
		let booted: BootedPayload
		let staff: Session
		let customer: Session
		let personKey: string

		const send = async (session: Session, channel: string, text: string) =>
			(
				await call<{ message: Message }>(booted, 'POST /conversations/comments/messages', {
					body: { channel, clientId: crypto.randomUUID(), key: personKey, text },
					session,
				})
			).json.message

		const react = (
			session: Session,
			{ action, emoji, message }: { action: 'add' | 'remove'; emoji: string; message: Message }
		) =>
			call<{ message: Message }>(booted, `POST /conversations/comments/reactions/${action}`, {
				body: { emoji, message: message.id },
				session,
			})

		const page = async (session: Session, channel: string, query: Record<string, string> = {}) =>
			(
				await call<Page>(booted, 'GET /conversations/comments/messages', {
					query: { channel, key: personKey, ...query },
					session,
				})
			).json.messages

		beforeAll(async () => {
			booted = await boot(
				db,
				conversations(instanceOptions({ extensions: [reactions({ maxPerUser: 2, storage })] }))
			)
			staff = await signUp(booted, 'users', 'Staff One')
			customer = await signUp(booted, 'customers', 'Customer')
			const person = await booted.payload.create({
				collection: 'persons',
				data: { name: 'Athlete', owner: String(customer.id) },
			})
			personKey = `collection:persons:${person.id}`
		}, 240_000)

		afterAll(async () => {
			await booted?.stop()
		})

		it('adds a reaction and returns the decorated message', async () => {
			const message = await send(staff, 'shared', 'react to me')
			const res = await react(customer, { action: 'add', emoji: '👍', message: message })
			expect(res.status).toBe(200)
			expect(summaries(res.json.message)).toEqual([
				{
					count: 1,
					emoji: '👍',
					mine: true,
					users: [{ name: 'Customer', userKey: customer.userKey }],
				},
			])
			// Another viewer sees the same reaction, not as theirs, on a normal page.
			const seen = (await page(staff, 'shared')).find((row) => row.id === message.id)
			expect(summaries(seen)).toMatchObject([{ count: 1, emoji: '👍', mine: false }])
		})

		it('is idempotent and removes cleanly', async () => {
			const message = await send(staff, 'internal', 'twice')
			await react(staff, { action: 'add', emoji: '🎉', message: message })
			const again = await react(staff, { action: 'add', emoji: '🎉', message: message })
			expect(summaries(again.json.message)).toMatchObject([{ count: 1, emoji: '🎉' }])
			const removed = await react(staff, { action: 'remove', emoji: '🎉', message: message })
			expect(summaries(removed.json.message)).toEqual([])
			const noop = await react(staff, { action: 'remove', emoji: '🎉', message: message })
			expect(noop.status).toBe(200)
		})

		it('counts concurrent reactions from many users exactly', async () => {
			const message = await send(staff, 'shared', 'popular')
			const people = await Promise.all(
				Array.from({ length: 12 }, (_, index) => signUp(booted, 'users', `Fan ${index}`))
			)
			// Everyone at once, and each of them twice.
			await Promise.all(
				[...people, ...people].map((person) =>
					react(person, { action: 'add', emoji: '❤️', message: message })
				)
			)
			const seen = (await page(staff, 'shared')).find((row) => row.id === message.id)
			expect(summaries(seen)).toMatchObject([{ count: 12, emoji: '❤️', mine: false }])
		})

		it('moves updatedAt so change sync picks a reaction up', async () => {
			const message = await send(staff, 'internal', 'sync me')
			const since = new Date(Date.now() - 1000).toISOString()
			await react(staff, { action: 'add', emoji: '👀', message: message })
			const changed = await page(staff, 'internal', { updatedSince: since })
			expect(summaries(changed.find((row) => row.id === message.id))).toMatchObject([
				{ count: 1, emoji: '👀', mine: true },
			])
		})

		it('refuses unknown emoji and messages the user cannot read', async () => {
			const message = await send(staff, 'internal', 'staff only')
			expect((await react(staff, { action: 'add', emoji: '🦄', message: message })).status).toBe(
				400
			)
			expect((await react(customer, { action: 'add', emoji: '👍', message: message })).status).toBe(
				404
			)
		})

		it('keeps reactions on a deleted message: no new ones, own ones can go', async () => {
			const message = await send(staff, 'internal', 'about to go')
			await react(staff, { action: 'add', emoji: '👍', message })
			await call(booted, `DELETE /conversations/comments/messages/${message.id}`, {
				session: staff,
			})
			// A root without replies drops out of pages, so read it through the extension's answer.
			expect((await react(staff, { action: 'add', emoji: '🎉', message })).status).toBe(404)
			const removed = await react(staff, { action: 'remove', emoji: '👍', message })
			expect(removed.status).toBe(200)
			expect(summaries(removed.json.message)).toEqual([])
		})

		it('shows reactions on a deleted root that anchors a thread', async () => {
			const root = await send(staff, 'internal', 'root with replies')
			await call(booted, 'POST /conversations/comments/messages', {
				body: {
					channel: 'internal',
					clientId: crypto.randomUUID(),
					key: personKey,
					parent: String(root.id),
					text: 'a reply',
				},
				session: staff,
			})
			await react(staff, { action: 'add', emoji: '✅', message: root })
			await call(booted, `DELETE /conversations/comments/messages/${root.id}`, { session: staff })
			const placeholder = (await page(staff, 'internal')).find((row) => row.id === root.id)
			expect(placeholder?.deletedAt).toBeTruthy()
			expect(summaries(placeholder)).toMatchObject([{ count: 1, emoji: '✅', mine: true }])
		})

		it('refuses a reaction past the per-person limit and keeps the others', async () => {
			const message = await send(staff, 'internal', 'limited')
			await react(staff, { action: 'add', emoji: '👍', message })
			await react(staff, { action: 'add', emoji: '🎉', message })
			const third = await react(staff, { action: 'add', emoji: '👀', message })
			expect(third.status).toBe(409)
			// Re-adding one already there is not a new reaction, so the limit does not apply.
			expect((await react(staff, { action: 'add', emoji: '👍', message })).status).toBe(200)
			const seen = (await page(staff, 'internal')).find((row) => row.id === message.id)
			expect(summaries(seen).map((entry) => entry.emoji)).toEqual(['👍', '🎉'])
		})

		it.runIf(storage === 'collection')('keeps the collection closed to REST', async () => {
			const res = await call(booted, 'GET /comments-reactions', { session: staff })
			expect(res.status).toBe(403)
		})

		it.runIf(storage === 'message')('keeps the stored field on the server', async () => {
			const slugs = booted.payload.config.collections.map((collection) => collection.slug)
			expect(slugs).not.toContain('comments-reactions')
			const message = await send(staff, 'internal', 'private field')
			const res = await react(staff, { action: 'add', emoji: '👍', message })
			expect(res.json.message).not.toHaveProperty('reactions')
			expect(res.json.message).not.toHaveProperty('reactionsVersion')
			expect(summaries(res.json.message)).toMatchObject([{ count: 1, emoji: '👍', mine: true }])
		})

		it.runIf(storage === 'collection')('removes a target’s reactions with the target', async () => {
			const other = await booted.payload.create({ collection: 'persons', data: { name: 'Gone' } })
			const key = `collection:persons:${other.id}`
			const sent = await call<{ message: Message }>(
				booted,
				'POST /conversations/comments/messages',
				{
					body: { channel: 'internal', clientId: crypto.randomUUID(), key, text: 'soon gone' },
					session: staff,
				}
			)
			await react(staff, { action: 'add', emoji: '👍', message: sent.json.message })
			await booted.payload.delete({ collection: 'persons', id: other.id })
			const left = await booted.payload.count({
				collection: 'comments-reactions' as never,
				where: { key: { equals: key } },
			})
			expect(left.totalDocs).toBe(0)
		})
	})

for (const storage of ['collection', 'message'] as const)
	describeForDb(`reactions extension, one per person, replacing, ${storage} storage`, {}, (db) => {
		let booted: BootedPayload
		let staff: Session
		let personKey: string

		beforeAll(async () => {
			booted = await boot(
				db,
				conversations(
					instanceOptions({
						extensions: [reactions({ maxPerUser: 1, onLimit: 'replace', storage })],
					})
				)
			)
			staff = await signUp(booted, 'users', 'Staff')
			const person = await booted.payload.create({ collection: 'persons', data: { name: 'P' } })
			personKey = `collection:persons:${person.id}`
		}, 240_000)

		afterAll(async () => {
			await booted?.stop()
		})

		it('changes the reaction instead of adding a second one', async () => {
			const sent = await call<{ message: Message }>(
				booted,
				'POST /conversations/comments/messages',
				{
					body: {
						channel: 'internal',
						clientId: crypto.randomUUID(),
						key: personKey,
						text: 'pick one',
					},
					session: staff,
				}
			)
			const add = (emoji: string) =>
				call<{ message: Message }>(booted, 'POST /conversations/comments/reactions/add', {
					body: { emoji, message: sent.json.message.id },
					session: staff,
				})
			await add('👍')
			const changed = await add('❤️')
			expect(changed.status).toBe(200)
			expect(summaries(changed.json.message)).toMatchObject([{ count: 1, emoji: '❤️', mine: true }])
		})
	})
