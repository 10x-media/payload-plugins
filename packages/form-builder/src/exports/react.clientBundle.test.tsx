import { describe, expect, it, vi } from 'vitest'

// A bundler cannot leave a Node builtin unresolved in a browser build, so a host app ships a full
// crypto polyfill (whose vm shim calls eval) for any node:crypto import reachable from this entry.
vi.mock('node:crypto', () => {
	throw new Error('the ./react entry reached node:crypto')
})
vi.mock('crypto', () => {
	throw new Error('the ./react entry reached crypto')
})

describe('./react client entry', () => {
	it('loads without importing Node crypto', async () => {
		await expect(import('./react')).resolves.toBeDefined()
	})
})
