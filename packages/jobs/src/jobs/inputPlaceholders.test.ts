import type { Config, Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { collectInputPlaceholders, derivePlaceholder } from './inputPlaceholders'

describe('derivePlaceholder', () => {
	it('maps scalar field types to empty values of their kind', () => {
		const fields: Field[] = [
			{ name: 'title', type: 'text' },
			{ name: 'notes', type: 'textarea' },
			{ name: 'limit', type: 'number' },
			{ name: 'dryRun', type: 'checkbox' },
			{ name: 'since', type: 'date' },
			{ name: 'raw', type: 'json' },
			{ name: 'body', type: 'richText' },
			{ name: 'where', type: 'point' },
		]
		expect(derivePlaceholder(fields)).toEqual({
			title: '',
			notes: '',
			limit: 0,
			dryRun: false,
			since: '',
			raw: {},
			body: {},
			where: [0, 0],
		})
	})

	it('prefers a static defaultValue and ignores a function one', () => {
		const fields: Field[] = [
			{ name: 'limit', type: 'number', defaultValue: 100 },
			{ name: 'codes', type: 'text', hasMany: true, defaultValue: ['a', 'b'] },
			{ name: 'mode', type: 'select', options: ['fast', 'full'], defaultValue: 'full' },
			{ name: 'stamp', type: 'text', defaultValue: () => 'now' },
		]
		expect(derivePlaceholder(fields)).toEqual({
			limit: 100,
			codes: ['a', 'b'],
			mode: 'full',
			stamp: '',
		})
	})

	it('uses the first option for a select and one element for hasMany', () => {
		const fields: Field[] = [
			{ name: 'mode', type: 'select', options: ['fast', 'full'] },
			{ name: 'empty', type: 'select', options: [] },
			{
				name: 'phases',
				type: 'select',
				hasMany: true,
				options: [
					{ label: 'Persons', value: 'persons' },
					{ label: 'Events', value: 'events' },
				],
			},
			{ name: 'codes', type: 'text', hasMany: true },
			{ name: 'weights', type: 'number', hasMany: true },
		]
		expect(derivePlaceholder(fields)).toEqual({
			mode: 'fast',
			empty: '',
			phases: ['persons'],
			codes: [''],
			weights: [0],
		})
	})

	it('names the collection a relationship expects an id from', () => {
		const fields: Field[] = [
			{ name: 'tenant', type: 'relationship', relationTo: 'tenants' },
			{ name: 'people', type: 'relationship', relationTo: 'people', hasMany: true },
			{ name: 'target', type: 'relationship', relationTo: ['pages', 'posts'] },
			{ name: 'targets', type: 'relationship', relationTo: ['pages', 'posts'], hasMany: true },
			{ name: 'cover', type: 'upload', relationTo: 'media' },
		]
		expect(derivePlaceholder(fields)).toEqual({
			tenant: '<tenants id>',
			people: ['<people id>'],
			target: { relationTo: 'pages', value: '<pages id>' },
			targets: [{ relationTo: 'pages', value: '<pages id>' }],
			cover: '<media id>',
		})
	})

	it('nests named groups, and shows one row of an array and of blocks', () => {
		const fields: Field[] = [
			{
				name: 'collections',
				type: 'group',
				fields: [
					{ name: 'events', type: 'checkbox' },
					{ name: 'persons', type: 'checkbox' },
				],
			},
			{
				name: 'ranges',
				type: 'array',
				fields: [
					{ name: 'from', type: 'number' },
					{ name: 'to', type: 'number' },
				],
			},
			{
				name: 'steps',
				type: 'blocks',
				blocks: [
					{ slug: 'wait', fields: [{ name: 'ms', type: 'number' }] },
					{ slug: 'ping', fields: [{ name: 'url', type: 'text' }] },
				],
			},
			{ name: 'none', type: 'blocks', blocks: [] },
		]
		expect(derivePlaceholder(fields)).toEqual({
			collections: { events: false, persons: false },
			ranges: [{ from: 0, to: 0 }],
			steps: [{ blockType: 'wait', ms: 0 }],
			none: [],
		})
	})

	it('flattens layout-only containers into the parent', () => {
		const fields: Field[] = [
			{ type: 'row', fields: [{ name: 'a', type: 'text' }] },
			{ type: 'collapsible', label: 'More', fields: [{ name: 'b', type: 'number' }] },
			{ type: 'group', fields: [{ name: 'e', type: 'checkbox' }] },
			{
				type: 'tabs',
				tabs: [
					{ label: 'Plain', fields: [{ name: 'c', type: 'checkbox' }] },
					{ name: 'named', label: 'Named', fields: [{ name: 'd', type: 'text' }] },
				],
			},
			{ type: 'ui', name: 'preview', admin: { components: {} } },
		]
		expect(derivePlaceholder(fields)).toEqual({
			a: '',
			b: 0,
			e: false,
			c: false,
			named: { d: '' },
		})
	})

	it('derives an empty object from no schema', () => {
		expect(derivePlaceholder()).toEqual({})
		expect(derivePlaceholder([])).toEqual({})
	})
})

describe('collectInputPlaceholders', () => {
	const config = {
		jobs: {
			tasks: [
				{
					slug: 'sync',
					inputSchema: [
						{ name: 'limit', type: 'number' },
						{ name: 'dryRun', type: 'checkbox' },
					],
				},
				{ slug: 'noop' },
			],
			workflows: [{ slug: 'publish', inputSchema: [{ name: 'force', type: 'checkbox' }] }],
		},
	} as unknown as Config

	it('keys placeholders by slug for tasks and workflows', () => {
		expect(collectInputPlaceholders(config)).toEqual({
			tasks: { sync: { limit: 0, dryRun: false }, noop: {} },
			workflows: { publish: { force: false } },
		})
	})

	it('merges an example over the derived object, keeping keys the example omits', () => {
		const { tasks } = collectInputPlaceholders(config, {
			sync: { limit: 250, extra: 'x' },
			noop: { flag: true },
		})
		expect(tasks.sync).toEqual({ limit: 250, dryRun: false, extra: 'x' })
		expect(tasks.noop).toEqual({ flag: true })
	})

	it('copes with a config that declares no jobs', () => {
		expect(collectInputPlaceholders({} as Config)).toEqual({ tasks: {}, workflows: {} })
	})
})
