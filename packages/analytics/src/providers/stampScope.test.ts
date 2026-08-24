import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { stampScope } from './stampScope'

const req = { user: { id: 1 } } as unknown as PayloadRequest

const base = {
	scoped: true,
	scopeField: 'scope',
	resolveScope: async () => 't1' as string | null,
	platformRead: async () => false,
}

type HookArgs = Parameters<ReturnType<typeof stampScope>>[0]
const run = (hook: ReturnType<typeof stampScope>, args: Partial<HookArgs>) =>
	hook({ req, operation: 'create', data: {}, ...args } as HookArgs)

describe('stampScope', () => {
	it('unscoped installs pass data through untouched', async () => {
		const hook = stampScope({ ...base, scoped: false })
		const data = { provider: 'posthog' }
		expect(await run(hook, { data })).toBe(data)
	})

	it('stamps the resolved scope on create when absent', async () => {
		const hook = stampScope(base)
		expect(await run(hook, { data: { provider: 'posthog' } })).toEqual({
			provider: 'posthog',
			scope: 't1',
		})
	})

	it('stamps over an empty-string scope', async () => {
		const hook = stampScope(base)
		expect(await run(hook, { data: { scope: '' } })).toEqual({ scope: 't1' })
	})

	it('passes through a matching pre-populated value (multi-tenant plugin)', async () => {
		const hook = stampScope({ ...base, scopeField: 'tenant' })
		const data = { tenant: 't1' }
		expect(await run(hook, { data })).toBe(data)
	})

	it('string-compares so relationship ids match', async () => {
		const hook = stampScope({ ...base, scopeField: 'tenant', resolveScope: async () => '42' })
		const data = { tenant: 42 }
		expect(await run(hook, { data })).toBe(data)
	})

	it('rejects a mismatched scope on create for non-platform users', async () => {
		const hook = stampScope(base)
		await expect(run(hook, { data: { scope: 't2' } })).rejects.toThrow(/scope/)
	})

	it('allows a mismatched scope for platform users', async () => {
		const hook = stampScope({ ...base, platformRead: async () => true })
		const data = { scope: 't2' }
		expect(await run(hook, { data })).toBe(data)
	})

	it('platform user with null resolved scope creates an install-wide doc unstamped', async () => {
		const hook = stampScope({
			...base,
			resolveScope: async () => null,
			platformRead: async () => true,
		})
		const data = { provider: 'posthog' }
		expect(await run(hook, { data })).toBe(data)
	})

	it('rejects moving a doc to another scope on update for non-platform users', async () => {
		const hook = stampScope(base)
		await expect(
			run(hook, {
				operation: 'update',
				data: { scope: 't2' },
				originalDoc: { scope: 't1' },
			})
		).rejects.toThrow(/scope/)
	})

	it('update keeping the same scope passes', async () => {
		const hook = stampScope(base)
		const data = { scope: 't1', enabled: false }
		expect(await run(hook, { operation: 'update', data, originalDoc: { scope: 't1' } })).toBe(data)
	})

	it('update not touching the scope passes', async () => {
		const hook = stampScope(base)
		const data = { enabled: false }
		expect(await run(hook, { operation: 'update', data, originalDoc: { scope: 't1' } })).toBe(data)
	})

	it('rejects create when no scope resolves and the user is not platform', async () => {
		const hook = stampScope({ ...base, resolveScope: async () => null })
		await expect(run(hook, { data: { provider: 'posthog' } })).rejects.toThrow(/scope/)
	})
})
