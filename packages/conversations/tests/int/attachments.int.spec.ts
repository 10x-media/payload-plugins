import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type BootedPayload, describeForDb } from '@10x-media/payload-test-harness'
import { createLocalReq, handleEndpoints } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { type AttachmentView, attachments } from '../../src/exports/attachments'
import { conversations, postMessage } from '../../src/index'
import type { ConversationMessage } from '../../src/types'
import { boot, call, instanceOptions, type Session, signUp } from './fixture'

type Message = ConversationMessage & { removed?: boolean }

const COLLECTION = 'comments-attachments'

const filesOf = (message: Message | undefined): AttachmentView[] =>
	(message?.ext?.attachments as AttachmentView[] | undefined) ?? []

for (const deleteWithMessage of [false, true])
	describeForDb(`attachments extension, deleteWithMessage: ${deleteWithMessage}`, {}, (db) => {
		let booted: BootedPayload
		let staff: Session
		let customer: Session
		let personKey: string
		let personId: number | string
		const staticDir = mkdtempSync(join(tmpdir(), 'conversations-attachments-'))

		/** Through the collection's own REST endpoint, as a composer uploads. */
		const upload = async (
			session: Session,
			{ composer = true, name = 'notes.txt' }: { composer?: boolean; name?: string } = {}
		) => {
			const form = new FormData()
			form.append('file', new Blob(['hello'], { type: 'text/plain' }), name)
			const headers = new Headers({ Authorization: `JWT ${session.token}` })
			if (composer) {
				headers.set('x-conversations-attachment', 'comments')
				headers.set('x-conversations-key', personKey)
				headers.set('x-conversations-channel', 'shared')
			}
			const res = await handleEndpoints({
				config: booted.payload.config,
				payloadInstanceCacheKey: booted.cacheKey,
				request: new Request(`http://localhost:3000/api/${COLLECTION}`, {
					body: form,
					headers,
					method: 'POST',
				}),
			})
			const json = (await res.json()) as { doc?: { id: number | string; source?: string } }
			return { doc: json.doc, status: res.status }
		}

		const send = (session: Session, body: Record<string, unknown>) =>
			call<{ message: Message }>(booted, 'POST /conversations/comments/messages', {
				body: { channel: 'shared', clientId: crypto.randomUUID(), key: personKey, ...body },
				session,
			})

		const page = async (session: Session) =>
			(
				await call<{ messages: Message[] }>(booted, 'GET /conversations/comments/messages', {
					query: { channel: 'shared', key: personKey },
					session,
				})
			).json.messages

		const fileExists = async (id: number | string) =>
			(
				await booted.payload.find({
					collection: COLLECTION as 'users',
					where: { id: { equals: id } },
				})
			).totalDocs === 1

		beforeAll(async () => {
			booted = await boot(
				db,
				conversations(
					instanceOptions({
						extensions: [
							attachments({
								data: ({ key, req }) => ({
									source: `${req.user?.collection}:${key ? 'composer' : 'none'}`,
								}),
								deleteWithMessage,
								maxFiles: 2,
								overrides: {
									access: {
										// Staff read every file; a customer only what customers uploaded.
										read: ({ req }) =>
											req.user?.collection === 'users' ? true : { source: { like: 'customers:' } },
									},
									fields: () => [{ name: 'source', required: true, type: 'text' }],
									upload: { staticDir },
								},
							}),
						],
					})
				)
			)
			staff = await signUp(booted, 'users', 'Staff One')
			customer = await signUp(booted, 'customers', 'Customer')
			const person = await booted.payload.create({
				collection: 'persons',
				data: { name: 'Athlete', owner: String(customer.id) },
			})
			personId = person.id
			personKey = `collection:persons:${person.id}`
		}, 240_000)

		afterAll(async () => {
			await booted?.stop()
			rmSync(staticDir, { force: true, recursive: true })
		})

		it('fills required fields of a composer upload through `data`, and only for those', async () => {
			const composed = await upload(customer)
			expect(composed.status).toBe(201)
			expect(composed.doc?.source).toBe('customers:composer')
			// Without the header the hook stays out, so the required field is missing.
			expect((await upload(customer, { composer: false })).status).toBe(400)
		})

		it('keeps update and delete closed on its own collection over REST', async () => {
			const file = await upload(customer)
			const rest = (method: 'DELETE' | 'PATCH') =>
				handleEndpoints({
					config: booted.payload.config,
					payloadInstanceCacheKey: booted.cacheKey,
					request: new Request(`http://localhost:3000/api/${COLLECTION}/${file.doc?.id}`, {
						body: method === 'PATCH' ? JSON.stringify({ source: 'changed' }) : undefined,
						headers: {
							Authorization: `JWT ${staff.token}`,
							'Content-Type': 'application/json',
						},
						method,
					}),
				})
			expect((await rest('PATCH')).status).toBe(403)
			expect((await rest('DELETE')).status).toBe(403)
			expect(await fileExists(file.doc?.id ?? '')).toBe(true)
		})

		it('stores the ids on the message and shows the files on every response', async () => {
			const first = await upload(customer, { name: 'a.txt' })
			const second = await upload(customer, { name: 'b.txt' })
			const res = await send(customer, {
				ext: { attachments: [second.doc?.id, first.doc?.id] },
				text: 'two files',
			})
			expect(res.status).toBe(201)
			expect(filesOf(res.json.message).map((file) => file.filename)).toEqual(['b.txt', 'a.txt'])
			expect(filesOf(res.json.message)[0]).toMatchObject({
				filesize: 5,
				mimeType: 'text/plain',
				thumbnail: null,
			})
			expect(filesOf(res.json.message)[0]?.url).toContain('b.txt')
			// The stored field itself never reaches the browser.
			expect(res.json.message).not.toHaveProperty('attachments')
			const seen = (await page(staff)).find((row) => row.id === res.json.message.id)
			expect(filesOf(seen)).toHaveLength(2)
		})

		it('refuses files the sender cannot read, unknown ids and too many files', async () => {
			const staffFile = await upload(staff)
			const refused = await send(customer, { ext: { attachments: [staffFile.doc?.id] }, text: 'x' })
			expect(refused.status).toBe(400)
			const unknown = await send(staff, { ext: { attachments: ['999999'] }, text: 'x' })
			expect(unknown.status).toBe(400)
			// In turn: concurrent uploads race for the same free filename.
			const three = []
			for (const name of ['one.txt', 'two.txt', 'three.txt']) three.push(await upload(staff, { name }))
			expect(three.every((entry) => entry.status === 201)).toBe(true)
			const tooMany = await call<{ errors?: Array<{ message: string }> }>(
				booted,
				'POST /conversations/comments/messages',
				{
					body: {
						channel: 'shared',
						clientId: crypto.randomUUID(),
						ext: { attachments: three.map((entry) => entry.doc?.id) },
						key: personKey,
						text: 'x',
					},
					session: staff,
				}
			)
			expect(tooMany.status).toBe(400)
			expect(tooMany.json.errors?.[0]?.message).toBe('At most 2 files per message')
			expect((await send(staff, { ext: { attachments: 'nope' }, text: 'x' })).status).toBe(400)
			expect((await send(staff, { ext: 'nope', text: 'x' })).status).toBe(400)
		})

		it('attaches from server code without access checks', async () => {
			const staffFile = await upload(staff, { name: 'import.txt' })
			const message = await postMessage(await createLocalReq({}, booted.payload), {
				author: staff.userKey,
				channel: 'shared',
				ext: { attachments: [staffFile.doc?.id] },
				instance: 'comments',
				key: personKey,
				text: 'imported',
			})
			const seen = (await page(customer)).find((row) => row.id === message.id)
			expect(filesOf(seen).map((file) => file.filename)).toEqual(['import.txt'])
		})

		it(
			deleteWithMessage
				? 'deletes the files with the message'
				: 'hides the files of a deleted message and keeps them',
			async () => {
				const file = await upload(customer)
				const sent = await send(customer, { ext: { attachments: [file.doc?.id] }, text: 'bye' })
				const id = sent.json.message.id
				const removed = await call<{ message: Message }>(
					booted,
					`DELETE /conversations/comments/messages/${id}`,
					{ session: customer }
				)
				expect(removed.status).toBe(200)
				expect(filesOf(removed.json.message)).toEqual([])
				expect(await fileExists(file.doc?.id ?? '')).toBe(!deleteWithMessage)
			}
		)

		it(
			deleteWithMessage
				? 'deletes the files with the target'
				: 'keeps the files when the target goes',
			async () => {
				const file = await upload(customer)
				await send(customer, { ext: { attachments: [file.doc?.id] }, text: 'last words' })
				await booted.payload.delete({ collection: 'persons', id: personId })
				expect(await fileExists(file.doc?.id ?? '')).toBe(!deleteWithMessage)
			}
		)
	})
