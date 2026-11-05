import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createKeepAlive, loadNextAfter, NO_AFTER_WARNING } from './keepAlive'

describe('loadNextAfter', () => {
	it('loads after() from next/server through a specifier the bundler can see', async () => {
		const text = readFileSync(new URL('./keepAlive.ts', import.meta.url), 'utf8')
		expect(text).toContain("await import('next/server')")
		expect(text).not.toContain('Ignore')
		expect(typeof (await loadNextAfter())).toBe('function')
	})
})

describe('createKeepAlive', () => {
	it('never loads next/server where Next serves no request (a worker, the CLI, a test)', async () => {
		const load = vi.fn(async () => undefined)
		const warn = vi.fn()
		const keep = createKeepAlive({ env: {}, warn, load })
		await keep(Promise.resolve())
		expect(load).not.toHaveBeenCalled()
		expect(warn).not.toHaveBeenCalled()
	})

	it('loads after() once, waiting for it, so work started before it loaded is kept too', async () => {
		const after = vi.fn()
		let resolveLoad: (value: typeof after) => void = () => {}
		const load = vi.fn(
			() =>
				new Promise<typeof after>((resolve) => {
					resolveLoad = resolve
				})
		)
		const keep = createKeepAlive({ env: { NEXT_RUNTIME: 'nodejs' }, warn: vi.fn(), load })
		const first = Promise.resolve('first')
		const second = Promise.resolve('second')
		const kept = Promise.all([keep(first), keep(second)])
		resolveLoad(after)
		await kept
		expect(load).toHaveBeenCalledTimes(1)
		expect(after.mock.calls).toEqual([[first], [second]])
	})

	it('says once that after() is missing where Next runs without it', async () => {
		const warn = vi.fn()
		const keep = createKeepAlive({
			env: { NEXT_RUNTIME: 'nodejs' },
			warn,
			load: async () => undefined,
		})
		await keep(Promise.resolve())
		await keep(Promise.resolve())
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn).toHaveBeenCalledWith(NO_AFTER_WARNING)
	})

	it('rejects with what after() threw outside a request, for the caller to settle', async () => {
		const keep = createKeepAlive({
			env: { NEXT_RUNTIME: 'nodejs' },
			warn: vi.fn(),
			load: async () => () => {
				throw new Error('after() was called outside a request scope')
			},
		})
		await expect(keep(Promise.resolve())).rejects.toThrow('outside a request scope')
	})
})
