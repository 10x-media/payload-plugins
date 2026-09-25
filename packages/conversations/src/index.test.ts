import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { conversations } from './index'
import type { ConversationsPluginOptions } from './types'

const options = (targets: ConversationsPluginOptions['targets']): ConversationsPluginOptions => ({
	access: ({ targets: list }) => list.map((target) => target.key),
	channels: [{ access: { create: () => true, read: () => true }, label: 'Notes', slug: 'notes' }],
	slug: 'comments',
	targets,
})

const config = (): Config =>
	({
		admin: { user: 'users' },
		collections: [{ auth: true, fields: [], slug: 'users' }],
		globals: [{ fields: [], slug: 'settings' }],
	}) as unknown as Config

describe('targets', () => {
	it('refuses a target collection or global the config does not have', () => {
		expect(() =>
			conversations(options({ collections: { posts: { channels: ['notes'] } } }))(config())
		).toThrow(/unknown collections: posts/)
		expect(() =>
			conversations(options({ globals: { header: { channels: ['notes'] } } }))(config())
		).toThrow(/unknown globals: header/)
		expect(() =>
			conversations(options({ globals: { settings: { channels: ['notes'] } } }))(config())
		).not.toThrow()
	})
})
