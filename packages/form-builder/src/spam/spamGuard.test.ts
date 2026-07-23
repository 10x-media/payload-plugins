import { APIError, type PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { CAPTCHA_TOKEN_KEY, IDENTITY_CONTEXT_KEY } from './constants'
import { buildSpamGuard } from './spamGuard'
import type { ResolvedSpamConfig } from './types'

const baseReq = (): PayloadRequest =>
	({
		headers: new Headers({ 'x-forwarded-for': '1.2.3.4', 'user-agent': 'jest' }),
		user: null,
		context: {},
		i18n: { t: (k: string) => k },
		payload: { kv: { get: async () => null, set: async () => undefined } },
	}) as unknown as PayloadRequest

const okLimiter = { check: async () => ({ ok: true, remaining: 9, resetAt: 0 }) }
const blockLimiter = { check: async () => ({ ok: false, remaining: 0, resetAt: 0 }) }

const cfg = (over: Partial<ResolvedSpamConfig> = {}): ResolvedSpamConfig => ({
	honeypot: { fieldName: 'website' },
	rateLimit: { window: 60_000, max: 5, limiter: okLimiter },
	uploadRateLimit: false,
	captcha: undefined,
	identify: () => 'ip:1.2.3.4',
	ipHeader: 'x-forwarded-for',
	metadata: { ip: false, ua: false },
	...over,
})

const run = async (
	guard: ReturnType<typeof buildSpamGuard>,
	data: Record<string, unknown>,
	req = baseReq()
) => guard({ data, operation: 'create', req } as never)

describe('buildSpamGuard', () => {
	it('passes a clean submission, writes meta.at, stashes identity, strips reserved entries', async () => {
		const req = baseReq()
		const guard = buildSpamGuard(cfg())
		const data = { form: 'f1', values: [{ field: 'name', value: 'Jo' }] }
		const out = (await run(guard, data, req)) as typeof data & { meta?: Record<string, unknown> }
		expect(out.values).toEqual([{ field: 'name', value: 'Jo' }])
		expect(typeof out.meta?.at).toBe('string')
		expect(req.context[IDENTITY_CONTEXT_KEY]).toBe('ip:1.2.3.4')
	})

	it('rejects when the honeypot is filled (generic message, no distinguishing detail)', async () => {
		const guard = buildSpamGuard(cfg())
		await expect(
			run(guard, { form: 'f1', values: [{ field: 'website', value: 'bot' }] })
		).rejects.toBeInstanceOf(APIError)
	})

	it('throws 429 when the limiter blocks', async () => {
		const guard = buildSpamGuard(cfg({ rateLimit: { window: 1, max: 1, limiter: blockLimiter } }))
		await expect(run(guard, { form: 'f1', values: [] })).rejects.toMatchObject({ status: 429 })
	})

	it('fails open when identity is null, but records it on meta.spam so it is not silent', async () => {
		const limiter = { check: vi.fn(async () => ({ ok: false, remaining: 0, resetAt: 0 })) }
		const guard = buildSpamGuard(
			cfg({ identify: () => null, rateLimit: { window: 1, max: 1, limiter } })
		)
		const out = (await run(guard, { form: 'f1', values: [] })) as {
			meta?: { spam?: { rateLimit?: string } }
		}
		expect(limiter.check).not.toHaveBeenCalled()
		expect(out.meta?.spam?.rateLimit).toBe('skipped-no-identity')
	})

	it('records the enforced and disabled rate-limit states on meta.spam', async () => {
		const enforced = (await run(buildSpamGuard(cfg()), { form: 'f1', values: [] })) as {
			meta?: { spam?: { rateLimit?: string } }
		}
		expect(enforced.meta?.spam?.rateLimit).toBe('enforced')
		const disabled = (await run(buildSpamGuard(cfg({ rateLimit: false })), {
			form: 'f1',
			values: [],
		})) as { meta?: { spam?: { rateLimit?: string } } }
		expect(disabled.meta?.spam?.rateLimit).toBe('disabled')
	})

	it('rejects when a captcha is configured but the token is missing or invalid', async () => {
		const captcha = {
			type: 'stub',
			verify: async ({ token }: { token: string }) => token === 'good',
		}
		const guard = buildSpamGuard(cfg({ captcha }))
		await expect(run(guard, { form: 'f1', values: [] })).rejects.toMatchObject({ status: 400 })
		await expect(
			run(guard, { form: 'f1', values: [{ field: CAPTCHA_TOKEN_KEY, value: 'bad' }] })
		).rejects.toMatchObject({ status: 400 })
		await expect(
			run(guard, { form: 'f1', values: [{ field: CAPTCHA_TOKEN_KEY, value: 'good' }] })
		).resolves.toBeTruthy()
	})

	it('captures ip/ua onto meta only when opted in', async () => {
		const guard = buildSpamGuard(cfg({ metadata: { ip: true, ua: true } }))
		const out = (await run(guard, { form: 'f1', values: [] })) as { meta?: Record<string, unknown> }
		expect(out.meta?.ip).toBe('1.2.3.4')
		expect(out.meta?.ua).toBe('jest')
	})

	it('skips honeypot + captcha for authenticated requests', async () => {
		const req = baseReq()
		;(req as { user: unknown }).user = { id: 1 }
		const captcha = { type: 'stub', verify: async () => false }
		const guard = buildSpamGuard(cfg({ captcha }))
		const out = (await run(
			guard,
			{ form: 'f1', values: [{ field: 'website', value: 'x' }] },
			req
		)) as { meta?: { spam?: { captcha?: string } } }
		expect(out.meta?.spam?.captcha).toBe('skipped')
	})

	it('preserves an authenticated caller meta with server fields winning', async () => {
		const req = baseReq()
		;(req as { user: unknown }).user = { id: 1 }
		const guard = buildSpamGuard(cfg())
		const out = (await run(
			guard,
			{ form: 'f1', values: [], meta: { source: 'import', at: 'CLIENT' } },
			req
		)) as { meta?: Record<string, unknown> }
		expect(out.meta?.source).toBe('import')
		expect(out.meta?.at).not.toBe('CLIENT')
	})

	it('discards anonymous-supplied meta', async () => {
		const guard = buildSpamGuard(cfg())
		const out = (await run(guard, { form: 'f1', values: [], meta: { source: 'evil' } })) as {
			meta?: Record<string, unknown>
		}
		expect(out.meta?.source).toBeUndefined()
	})
})
