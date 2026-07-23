import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder, turnstileProvider } from '../../src/index'
import { createKvRateLimiter } from '../../src/spam/rateLimiter'

describeForDb('form-builder spam guard', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({ spam: { metadata: { ip: true } } }), db })
	})
	afterAll(async () => {
		await booted.stop()
	})

	const makeForm = () =>
		booted.payload.create({
			collection: 'forms',
			data: { title: 'Contact', fields: [{ blockType: 'text', name: 'name', label: 'Name' }] },
		})

	it('stores a clean submission, strips reserved entries, writes meta.at', async () => {
		const form = await makeForm()
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			data: {
				form: form.id,
				values: [
					{ field: 'name', value: 'Jo' },
					{ field: '__fb_hp', value: '' },
				],
			},
		})
		const values = submission.values as Array<{ field: string }>
		expect(values.map((v) => v.field)).toEqual(['name'])
		expect(typeof (submission.meta as { at?: string }).at).toBe('string')
	})

	it('rejects a submission whose honeypot is filled', async () => {
		const form = await makeForm()
		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: { form: form.id, values: [{ field: '__fb_hp', value: 'spam' }] },
			})
		).rejects.toThrow()
	})

	it('the real payload.kv backs the window counter across calls', async () => {
		const limiter = createKvRateLimiter()
		const req = { payload: booted.payload } as unknown as PayloadRequest
		const key = `it:${Date.now()}`
		for (let i = 0; i < 3; i++) {
			expect((await limiter.check({ key, max: 3, window: 60_000, req })).ok).toBe(true)
		}
		expect((await limiter.check({ key, max: 3, window: 60_000, req })).ok).toBe(false)
	})
})

describeForDb('form-builder spam captcha', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({
				spam: { captcha: { type: 'stub', verify: async ({ token }) => token === 'good' } },
			}),
			db,
		})
	})
	afterAll(async () => {
		await booted.stop()
	})

	const makeForm = () =>
		booted.payload.create({
			collection: 'forms',
			data: { title: 'Gated', fields: [{ blockType: 'text', name: 'name', label: 'Name' }] },
		})

	it('rejects without a token, accepts with a valid token', async () => {
		const form = await makeForm()
		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: { form: form.id, values: [{ field: 'name', value: 'A' }] },
			})
		).rejects.toThrow()
		const ok = await booted.payload.create({
			collection: 'form-submissions',
			data: {
				form: form.id,
				values: [
					{ field: 'name', value: 'A' },
					{ field: '__fb_captcha', value: 'good' },
				],
			},
		})
		expect(ok.id).toBeDefined()
	})
})

describeForDb('form-builder spam bundled turnstile adapter', { dbs: ['mongo'] }, (db) => {
	const msw = setupServer(
		http.post('https://challenges.cloudflare.com/turnstile/v0/siteverify', async ({ request }) => {
			const body = new URLSearchParams(await request.text())
			return HttpResponse.json({ success: body.get('response') === 'good' })
		})
	)
	let booted: BootedPayload

	beforeAll(async () => {
		msw.listen({ onUnhandledRequest: 'bypass' })
		booted = await bootPayload({
			plugin: formBuilder({ spam: { captcha: turnstileProvider({ secretKey: 'sec' }) } }),
			db,
		})
	})
	afterAll(async () => {
		await booted.stop()
		msw.close()
	})

	it('verifies the token against the siteverify endpoint', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: { title: 'Gated', fields: [{ blockType: 'text', name: 'name', label: 'Name' }] },
		})
		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: {
					form: form.id,
					values: [
						{ field: 'name', value: 'A' },
						{ field: '__fb_captcha', value: 'bad' },
					],
				},
			})
		).rejects.toThrow()
		const ok = await booted.payload.create({
			collection: 'form-submissions',
			data: {
				form: form.id,
				values: [
					{ field: 'name', value: 'A' },
					{ field: '__fb_captcha', value: 'good' },
				],
			},
		})
		expect(ok.id).toBeDefined()
	})
})
