import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import type { ConversationsChannel, ConversationsPluginOptions } from '../types'
import { resolveInstance, runAfterPhases, runBeforePhases } from './resolveOptions'

const channel = (slug: string): ConversationsChannel => ({
	access: { create: () => true, read: () => true },
	label: slug,
	slug,
})

const base = (overrides: Partial<ConversationsPluginOptions> = {}): ConversationsPluginOptions => ({
	access: ({ targets }) => targets.map((target) => target.key),
	channels: [channel('internal'), channel('shared')],
	slug: 'comments',
	...overrides,
})

const config = {
	admin: { user: 'users' },
	collections: [{ admin: { useAsTitle: 'name' }, fields: [], slug: 'users' }],
} as unknown as Config

describe('extension pipeline', () => {
	it('runs before phases in array order, each seeing the previous result', () => {
		const seen: string[] = []
		const { options } = runBeforePhases(
			base({
				extensions: [
					{
						before: (current) => {
							seen.push('a')
							return {
								...current,
								targets: { collections: { persons: { channels: ['internal'] } } },
							}
						},
						name: 'a',
					},
					{
						before: (current) => {
							seen.push(`b:${Object.keys(current.targets?.collections ?? {}).join()}`)
							return current
						},
						name: 'b',
					},
				],
			})
		)
		expect(seen).toEqual(['a', 'b:persons'])
		expect(options.targets?.collections?.persons?.channels).toEqual(['internal'])
	})

	it('lets extensions see each other by name', () => {
		let names: string[] = []
		runBeforePhases(
			base({
				extensions: [
					{
						before: (current, { extensions }) => {
							names = [...extensions.keys()]
							return current
						},
						name: 'a',
					},
					{ name: 'reactions', options: { emoji: true } },
				],
			})
		)
		expect(names).toEqual(['a', 'reactions'])
	})

	it('throws on a duplicate extension name', () => {
		expect(() => runBeforePhases(base({ extensions: [{ name: 'x' }, { name: 'x' }] }))).toThrow(
			/extension "x" is registered twice/
		)
	})

	it('throws on a message type registered twice, naming both', () => {
		const type = { slug: 'ticket.status' }
		expect(() =>
			runBeforePhases(
				base({
					extensions: [
						{ before: (current) => ({ ...current, types: [type] }), name: 'first' },
						{
							before: (current) => ({ ...current, types: [...(current.types ?? []), type] }),
							name: 'second',
						},
					],
				})
			)
		).toThrow(/extension "first" and extension "second"/)
	})

	it('throws when two parties give one target different channels', () => {
		expect(() =>
			runBeforePhases(
				base({
					extensions: [
						{
							before: (current) => ({
								...current,
								targets: { collections: { persons: { channels: ['shared'] } } },
							}),
							name: 'ext',
						},
					],
					targets: { collections: { persons: { channels: ['internal'] } } },
				})
			)
		).toThrow(/the plugin options and extension "ext"/)
	})

	it('accepts the same target with the same channels twice', () => {
		const targets = { collections: { persons: { channels: ['internal'] } } }
		expect(() =>
			runBeforePhases(
				base({
					extensions: [{ before: (current) => ({ ...current, targets }), name: 'ext' }],
					targets,
				})
			)
		).not.toThrow()
	})

	it('runs after phases in order, threading the config', () => {
		const instance = resolveInstance(config, base(), new Map())
		const out = runAfterPhases(config, instance, [
			{ after: ({ config: c }) => ({ ...c, custom: { order: ['a'] } }), name: 'a' },
			{
				after: ({ config: c }) => ({
					...c,
					custom: { order: [...(c.custom?.order as string[]), 'b'] },
				}),
				name: 'b',
			},
		])
		expect(out.custom?.order).toEqual(['a', 'b'])
	})
})

describe('instance resolution', () => {
	it('derives slugs and defaults', () => {
		const instance = resolveInstance(config, base(), new Map())
		expect(instance.messagesSlug).toBe('comments-messages')
		expect(instance.readsSlug).toBe('comments-reads')
		expect(instance.deleted).toBe('placeholderIfReplies')
		expect(instance.users.map((user) => user.collection)).toEqual(['users'])
		expect(instance.users[0]?.display({ id: 1, name: 'Ann' }).name).toBe('Ann')
	})

	it('drops the reads collection with reads: false', () => {
		expect(resolveInstance(config, base({ reads: false }), new Map()).readsSlug).toBeNull()
	})

	it('rejects a target listing an unknown channel', () => {
		expect(() =>
			resolveInstance(
				config,
				base({ targets: { collections: { persons: { channels: ['nope'] } } } }),
				new Map()
			)
		).toThrow(/unknown channel "nope"/)
	})

	it('rejects a bad slug', () => {
		expect(() => resolveInstance(config, base({ slug: 'Bad Slug' }), new Map())).toThrow(/slug/)
	})

	it('offers only the channels a target lists, and fails closed on access', async () => {
		const instance = resolveInstance(
			config,
			base({
				access: undefined as never,
				targets: { collections: { persons: { channels: ['internal'] } } },
			}),
			new Map()
		)
		expect(instance.channelsFor({ key: '', kind: 'collection', slug: 'persons' })).toEqual([
			'internal',
		])
		expect(instance.channelsFor({ key: '', kind: 'collection', slug: 'media' })).toEqual([])
		const req = { user: { collection: 'users', id: 1 } } as never
		expect(await instance.allowedKeys(req, ['collection:persons:1'])).toEqual(new Set())
	})
})
