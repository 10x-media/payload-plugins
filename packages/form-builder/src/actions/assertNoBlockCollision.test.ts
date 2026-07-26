import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import { assertNoActionBlockCollision } from './assertNoBlockCollision'
import type { ActionRegistry } from './registry'

const registry = (types: string[]): ActionRegistry =>
	new Map(types.map((type) => [type, { type, label: type, run: async () => {} }]))

const withBlocks = (slugs: string[]): Config =>
	({ blocks: slugs.map((slug) => ({ slug, fields: [] })) }) as unknown as Config

describe('assertNoActionBlockCollision', () => {
	it('throws, naming the colliding type, when an action type matches a host block slug', () => {
		expect(() =>
			assertNoActionBlockCollision(withBlocks(['newsletter']), registry(['newsletter']))
		).toThrow(/"newsletter"/)
	})

	it('does not throw when no action type matches a host block slug', () => {
		expect(() =>
			assertNoActionBlockCollision(withBlocks(['hero', 'cta']), registry(['newsletter', 'emailTeam']))
		).not.toThrow()
	})

	it('is a no-op when the host registers no blocks', () => {
		expect(() =>
			assertNoActionBlockCollision({} as Config, registry(['emailTeam', 'confirmation']))
		).not.toThrow()
	})
})
