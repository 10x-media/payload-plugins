import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { type CollectionConfig, handleEndpoints } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { defineFormVariants, EVALUATE_PATH, formVariants } from '../../src/index'
import type { EvaluateRequest, EvaluateResponse } from '../../src/plugin/endpoint'

const ADMIN = { email: 'admin@example.com', password: 'password' }
const EDITOR = { email: 'editor@example.com', password: 'password' }

const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	fields: [{ name: 'role', type: 'select', defaultValue: 'editor', options: ['admin', 'editor'] }],
}

const people: CollectionConfig = {
	slug: 'people',
	access: {
		update: ({ req }) => (req.user as { role?: string } | null)?.role === 'admin',
	},
	custom: {
		formVariants: defineFormVariants('people', {
			variants: [
				{
					key: 'quick',
					access: ({ user }) => (user as { role?: string } | null)?.role === 'editor',
					steps: [
						{ key: 'identity', fields: ['firstName', 'lastName'] },
						{
							key: 'contact',
							condition: ({ values }) => values.firstName === 'Ada',
							fields: ['email'],
							gate: ({ values }) =>
								values.email === 'taken@example.com'
									? { message: 'That address is taken.', result: 'block' }
									: { result: 'patch', state: { checked: true }, values: { lastName: 'Patched' } },
						},
					],
					afterSave: ({ operation, savedDoc }) => ({
						outcome: { id: String(savedDoc.id), lastName: String(savedDoc.lastName), operation },
					}),
				},
				{
					key: 'native',
					access: ({ user }) => (user as { role?: string } | null)?.role === 'admin',
				},
			],
		}),
	},
	fields: [
		{ name: 'firstName', type: 'text' },
		{ name: 'lastName', type: 'text' },
		{ name: 'email', type: 'email' },
	],
}

describeForDb('formVariants evaluate endpoint', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let editorToken: string
	let adminToken: string
	let docId: string

	const call = (token: string | undefined, body: Partial<EvaluateRequest>) =>
		handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`http://localhost:3000/api${EVALUATE_PATH}`, {
				body: JSON.stringify(body),
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `JWT ${token}` } : {}),
				},
				method: 'POST',
			}),
		})

	const base = (): Partial<EvaluateRequest> => ({
		collection: 'people',
		phase: 'visibility',
		state: {},
		values: {},
		variant: 'quick',
	})

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [users, people],
			db,
			plugin: formVariants({}),
			configOverrides: { admin: { user: 'users' } },
		})
		await booted.payload.create({ collection: 'users', data: { ...ADMIN, role: 'admin' } })
		await booted.payload.create({ collection: 'users', data: { ...EDITOR, role: 'editor' } })
		const created = await booted.payload.create({
			collection: 'people',
			data: { firstName: 'Grace', lastName: 'Hopper' },
		})
		docId = String(created.id)
		const login = async (credentials: typeof ADMIN) => {
			const result = await booted.payload.login({ collection: 'users', data: credentials })
			return result.token as string
		}
		editorToken = await login(EDITOR)
		adminToken = await login(ADMIN)
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('answers 401 without a user and 400 for a malformed body', async () => {
		expect((await call(undefined, base())).status).toBe(401)
		expect((await call(editorToken, { collection: 'people' })).status).toBe(400)
	})

	it('answers 404 for an unknown variant and for native', async () => {
		expect((await call(editorToken, { ...base(), variant: 'ghost' })).status).toBe(404)
		expect((await call(editorToken, { ...base(), variant: 'native' })).status).toBe(404)
	})

	it('answers 403 when the account lacks update access to the document', async () => {
		expect((await call(editorToken, { ...base(), id: docId })).status).toBe(403)
	})

	it('answers 403 when the variant access refuses the account', async () => {
		expect((await call(adminToken, { ...base(), id: docId })).status).toBe(403)
	})

	it('evaluates step conditions against the sent values', async () => {
		const hidden = (await (await call(editorToken, base())).json()) as EvaluateResponse
		expect(hidden.visible).toEqual(['identity'])
		const shown = (await (
			await call(editorToken, { ...base(), values: { firstName: 'Ada' } })
		).json()) as EvaluateResponse
		expect(shown.visible).toEqual(['identity', 'contact'])
	})

	it('runs a gate and returns block or patch', async () => {
		const blocked = (await (
			await call(editorToken, {
				...base(),
				phase: 'gate',
				step: 'contact',
				values: { email: 'taken@example.com', firstName: 'Ada' },
			})
		).json()) as EvaluateResponse
		expect(blocked.gate).toEqual({ message: 'That address is taken.', result: 'block' })

		const patched = (await (
			await call(editorToken, {
				...base(),
				phase: 'gate',
				step: 'contact',
				values: { email: 'free@example.com', firstName: 'Ada' },
			})
		).json()) as EvaluateResponse
		expect(patched.gate).toEqual({
			result: 'patch',
			state: { checked: true },
			values: { lastName: 'Patched' },
		})
	})

	it('refuses afterSave without the saved document id', async () => {
		expect((await call(editorToken, { ...base(), phase: 'afterSave' })).status).toBe(400)
	})

	it('runs afterSave after a create with create access and the document the server reads', async () => {
		const response = await call(editorToken, {
			...base(),
			id: docId,
			operation: 'create',
			phase: 'afterSave',
		})
		expect(response.status).toBe(200)
		const body = (await response.json()) as EvaluateResponse
		expect(body.action).toEqual({
			outcome: { id: docId, lastName: 'Hopper', operation: 'create' },
		})
	})

	it('checks update access for afterSave after an update', async () => {
		expect((await call(editorToken, { ...base(), id: docId, phase: 'afterSave' })).status).toBe(403)
	})
})
