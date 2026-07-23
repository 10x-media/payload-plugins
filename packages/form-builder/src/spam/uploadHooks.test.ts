import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { ResolvedSpamConfig } from './types'
import { buildUploadOwnerStamp, buildUploadRateLimit } from './uploadHooks'

const req = (): PayloadRequest =>
	({
		headers: new Headers({ 'x-forwarded-for': '8.8.8.8' }),
		user: null,
		i18n: { t: (k: string) => k },
		payload: {},
	}) as unknown as PayloadRequest

const cfg = (over: Partial<ResolvedSpamConfig> = {}): ResolvedSpamConfig => ({
	honeypot: false,
	rateLimit: false,
	uploadRateLimit: {
		window: 60_000,
		max: 2,
		limiter: { check: async () => ({ ok: true, remaining: 1, resetAt: 0 }) },
	},
	captcha: undefined,
	identify: () => 'ip:8.8.8.8',
	ipHeader: 'x-forwarded-for',
	metadata: { ip: false, ua: false },
	uploadOwnership: 'lenient',
	...over,
})

describe('buildUploadOwnerStamp', () => {
	it('stamps owner = identity on create', async () => {
		const stamp = buildUploadOwnerStamp(cfg())
		const data = await stamp({ data: {}, operation: 'create', req: req() } as never)
		expect((data as { owner?: string }).owner).toBe('ip:8.8.8.8')
	})

	it('does not stamp on update or when identity is null', async () => {
		const nullId = buildUploadOwnerStamp(cfg({ identify: () => null }))
		expect(
			((await nullId({ data: {}, operation: 'create', req: req() } as never)) as { owner?: string })
				.owner
		).toBeUndefined()
		const onUpdate = buildUploadOwnerStamp(cfg())
		expect(
			(
				(await onUpdate({ data: {}, operation: 'update', req: req() } as never)) as {
					owner?: string
				}
			).owner
		).toBeUndefined()
	})
})

describe('buildUploadRateLimit', () => {
	it('throws 429 when blocked, no-op when identity is null', async () => {
		const limiter = { check: vi.fn(async () => ({ ok: false, remaining: 0, resetAt: 0 })) }
		const hook = buildUploadRateLimit(cfg({ uploadRateLimit: { window: 1, max: 1, limiter } }))
		await expect(hook({ operation: 'create', req: req() } as never)).rejects.toMatchObject({
			status: 429,
		})
		const noId = buildUploadRateLimit(
			cfg({ identify: () => null, uploadRateLimit: { window: 1, max: 1, limiter } })
		)
		await expect(noId({ operation: 'create', req: req() } as never)).resolves.toBeUndefined()
	})
})
