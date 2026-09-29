import type { AccessArgs, Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { resolveOptions } from '../options'
import { resolveLockAccess, updateUnlessEnded } from './access'
import { buildLockCollection } from './lockCollection'

const args = (user: unknown = { id: 1 }) => ({ req: { user } }) as unknown as AccessArgs
const isAdmin = () => true

describe('resolveLockAccess', () => {
	it('spreads one function over the writes and leaves read alone', () => {
		expect(resolveLockAccess(isAdmin)).toEqual({
			create: isAdmin,
			delete: isAdmin,
			update: isAdmin,
		})
	})

	it('passes an object through', () => {
		const access = { read: isAdmin }
		expect(resolveLockAccess(access)).toBe(access)
	})
})

describe('updateUnlessEnded', () => {
	it('narrows a grant to windows that have not ended', async () => {
		const result = JSON.stringify(await updateUnlessEnded(isAdmin)(args()))
		expect(result).toContain('endedAt')
		// A window never published stays editable.
		expect(result).toContain('"_status":{"equals":"draft"}')
	})

	it('keeps a denial', async () => {
		expect(await updateUnlessEnded(() => false)(args())).toBe(false)
	})

	it("combines with the original's query", async () => {
		const own = { title: { equals: 'mine' } }
		const result = (await updateUnlessEnded(() => own)(args())) as { and: unknown[] }
		expect(result.and[0]).toBe(own)
	})

	it("falls back to Payload's default for a missing original", async () => {
		expect(await updateUnlessEnded(undefined)(args(null))).toBe(false)
	})
})

describe('lock collection access', () => {
	const config = { collections: [], globals: [] } as unknown as Config

	it('keeps ended windows read-only when overrides replace access', async () => {
		const collection = buildLockCollection(config, resolveOptions({}), {
			collection: {
				overrides: (built) => ({ ...built, access: { update: () => true } }),
			},
		})
		const result = await collection.access?.update?.(args())
		expect(JSON.stringify(result)).toContain('endedAt')
	})

	it('applies a single access function to every write', async () => {
		const collection = buildLockCollection(config, resolveOptions({}), {
			collection: { access: () => false },
		})
		expect(await collection.access?.create?.(args())).toBe(false)
		expect(await collection.access?.update?.(args())).toBe(false)
		expect(collection.access?.read).toBeUndefined()
	})
})
