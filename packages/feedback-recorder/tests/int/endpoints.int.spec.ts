import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { feedbackRecorder } from '../../src/index'

const TENX = 'https://tenx.test'
const KEY = 'rec_integration-key-for-tests-only'

type Seen = { url: string; method: string; headers: Headers; body: string | null }

describeForDb('feedbackRecorder endpoints', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let editorToken = ''
	let customerToken = ''
	let seen: Seen[] = []
	let answer: (call: Seen) => Response = () => Response.json({ ok: true })

	const realFetch = globalThis.fetch

	const send = async (input: {
		method: string
		path: string
		token?: string
		body?: BodyInit
		contentType?: string
		site?: string
	}) => {
		const response = await handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`http://localhost:3000/api/feedback-recorder${input.path}`, {
				method: input.method,
				body: input.body,
				headers: {
					host: 'localhost:3000',
					Origin: 'http://localhost:3000',
					'Sec-Fetch-Site': input.site ?? 'same-origin',
					...(input.contentType ? { 'Content-Type': input.contentType } : {}),
					...(input.token ? { Authorization: `JWT ${input.token}` } : {}),
				},
			}),
		})
		const text = await response.text()
		return {
			status: response.status,
			body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
		}
	}

	beforeAll(async () => {
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input instanceof Request ? input.url : input)
			if (!url.startsWith(TENX)) return realFetch(input, init)
			const call: Seen = {
				url,
				method: init?.method ?? 'GET',
				headers: new Headers(init?.headers),
				body:
					typeof init?.body === 'string'
						? init.body
						: init?.body instanceof ArrayBuffer
							? `bytes:${init.body.byteLength}`
							: null,
			}
			seen.push(call)
			return answer(call)
		})

		booted = await bootPayload({
			plugin: feedbackRecorder({ url: TENX, apiKey: KEY, appVersion: 'sha-123' }),
			db,
			collections: [
				{ slug: 'users', auth: true, fields: [] },
				{
					slug: 'customers',
					auth: true,
					fields: [{ name: 'name', type: 'text' }],
				},
			],
		})

		await booted.payload.create({
			collection: 'users',
			data: { email: 'editor@client.example', password: 'password' },
		})
		editorToken =
			(
				await booted.payload.login({
					collection: 'users',
					data: { email: 'editor@client.example', password: 'password' },
				})
			).token ?? ''

		await booted.payload.create({
			collection: 'customers',
			data: { email: 'customer@client.example', password: 'password', name: 'A customer' },
		})
		customerToken =
			(
				await booted.payload.login({
					collection: 'customers',
					data: { email: 'customer@client.example', password: 'password' },
				})
			).token ?? ''
	})

	afterAll(async () => {
		vi.unstubAllGlobals()
		await booted.stop()
	})

	beforeEach(() => {
		seen = []
		answer = () => Response.json({ ok: true })
	})

	it('refuses anonymous callers, other auth collections and cross-site requests', async () => {
		expect((await send({ method: 'GET', path: '/status' })).status).toBe(401)
		expect((await send({ method: 'GET', path: '/status', token: customerToken })).status).toBe(403)
		expect(
			(await send({ method: 'GET', path: '/status', token: editorToken, site: 'cross-site' }))
				.status
		).toBe(403)
		expect(seen).toHaveLength(0)
	})

	it('answers access locally, per user, without calling out', async () => {
		expect(await send({ method: 'GET', path: '/access' })).toEqual({
			status: 200,
			body: { allowed: false },
		})
		expect(await send({ method: 'GET', path: '/access', token: customerToken })).toEqual({
			status: 200,
			body: { allowed: false },
		})
		expect(await send({ method: 'GET', path: '/access', token: editorToken })).toEqual({
			status: 200,
			body: { allowed: true },
		})
		expect(seen).toHaveLength(0)
	})

	it('pings the 10x system with the key, never handing it to the browser', async () => {
		answer = () => Response.json({ ok: true, project: { id: 'p1', name: 'Client CMS' } })
		const result = await send({ method: 'GET', path: '/status', token: editorToken })
		expect(result).toEqual({
			status: 200,
			body: { ok: true, project: { id: 'p1', name: 'Client CMS' } },
		})
		expect(seen[0]?.url).toBe(`${TENX}/api/ingest/v1/ping`)
		expect(seen[0]?.headers.get('authorization')).toBe(`Bearer ${KEY}`)
		expect(JSON.stringify(result.body)).not.toContain(KEY)
	})

	it('reserves with the submitter taken from the session, not the browser', async () => {
		answer = () =>
			Response.json(
				{
					clipId: 'c1',
					videoId: 'v1',
					upload: { endpoint: 'https://tus', libraryId: 'l', signature: 's', expires: 1 },
				},
				{ status: 201 }
			)
		const result = await send({
			method: 'POST',
			path: '/clips',
			token: editorToken,
			contentType: 'application/json',
			body: JSON.stringify({
				kind: 'bug',
				title: 'Broken',
				note: 'It broke',
				durationSeconds: 12,
				submitter: { id: 'users:forged' },
				context: { pageUrl: 'http://localhost:3000/admin' },
			}),
		})
		expect(result.status).toBe(201)
		expect(result.body).toMatchObject({ clipId: 'c1' })

		const forwarded = JSON.parse(seen[0]?.body ?? '{}') as Record<string, unknown>
		expect(seen[0]?.url).toBe(`${TENX}/api/ingest/v1/clips`)
		expect(forwarded).toMatchObject({
			kind: 'bug',
			title: 'Broken',
			note: 'It broke',
			durationSeconds: 12,
			appVersion: 'sha-123',
			context: { pageUrl: 'http://localhost:3000/admin' },
			submitter: { email: 'editor@client.example' },
		})
		expect((forwarded.submitter as { id: string }).id).toMatch(/^users:/)
		expect((forwarded.submitter as { id: string }).id).not.toBe('users:forged')
	})

	it('completes and forwards audio with the submitter header', async () => {
		const done = await send({
			method: 'POST',
			path: '/clips/c1/complete',
			token: editorToken,
			contentType: 'application/json',
			body: JSON.stringify({ durationSeconds: 30 }),
		})
		expect(done.status).toBe(200)
		expect(seen[0]?.url).toBe(`${TENX}/api/ingest/v1/clips/c1/complete`)
		expect(seen[0]?.headers.get('x-submitter-id')).toMatch(/^users:/)
		expect(JSON.parse(seen[0]?.body ?? '{}')).toEqual({ durationSeconds: 30 })

		const audio = await send({
			method: 'PUT',
			path: '/clips/c1/audio',
			token: editorToken,
			contentType: 'audio/webm',
			body: new Uint8Array([1, 2, 3, 4]),
		})
		expect(audio.status).toBe(200)
		expect(seen[1]?.url).toBe(`${TENX}/api/ingest/v1/clips/c1/audio`)
		expect(seen[1]?.body).toBe('bytes:4')
	})

	it('refuses an id that is not id-shaped before calling out', async () => {
		const result = await send({
			method: 'POST',
			path: '/clips/..%2Fping/complete',
			token: editorToken,
			contentType: 'application/json',
			body: '{}',
		})
		expect([400, 404]).toContain(result.status)
		expect(seen).toHaveLength(0)
	})

	it('relays a refusal and turns a rejected key into a bad gateway', async () => {
		answer = () => Response.json({ error: 'That clip is already complete.' }, { status: 409 })
		const conflict = await send({
			method: 'POST',
			path: '/clips/c1/complete',
			token: editorToken,
			contentType: 'application/json',
			body: '{}',
		})
		expect(conflict).toEqual({
			status: 409,
			body: { error: 'refused', message: 'That clip is already complete.' },
		})

		answer = () => Response.json({ error: 'nope' }, { status: 401 })
		const rejected = await send({ method: 'GET', path: '/status', token: editorToken })
		expect(rejected.status).toBe(502)
		expect(rejected.body).toMatchObject({ error: 'keyRejected' })
	})

	it('lists only the signed-in user’s recordings', async () => {
		answer = () => Response.json({ docs: [] })
		await send({ method: 'GET', path: '/clips', token: editorToken })
		expect(seen[0]?.url).toMatch(new RegExp(`^${TENX}/api/ingest/v1/clips\\?submitter=users%3A`))
	})
})
