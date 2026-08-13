import type { ClientField } from 'payload'
import { describe, expect, it } from 'vitest'

import { buildPrefillData } from './buildPrefillData'

const fields = (...list: unknown[]): ClientField[] => list as ClientField[]

describe('buildPrefillData', () => {
	it('returns undefined when nothing below needs a row', () => {
		expect(
			buildPrefillData(
				fields(
					{ name: 'title', type: 'text' },
					{ name: 'meta', type: 'group', fields: [{ name: 'seoTitle', type: 'text' }] }
				)
			)
		).toBeUndefined()
	})

	it('opens every array with one empty row', () => {
		expect(buildPrefillData(fields({ name: 'socials', type: 'array', fields: [] }))).toEqual({
			socials: [{}],
		})
	})

	it('recurses into nested arrays', () => {
		expect(
			buildPrefillData(
				fields({
					name: 'specs',
					type: 'array',
					fields: [
						{ name: 'label', type: 'text' },
						{ name: 'values', type: 'array', fields: [{ name: 'value', type: 'text' }] },
					],
				})
			)
		).toEqual({ specs: [{ values: [{}] }] })
	})

	it('nests named groups and named tabs, but only when something below needs it', () => {
		expect(
			buildPrefillData(
				fields(
					{
						name: 'branding',
						type: 'group',
						fields: [
							{ name: 'tagline', type: 'text' },
							{ name: 'links', type: 'array', fields: [] },
						],
					},
					{ name: 'empty', type: 'group', fields: [{ name: 'note', type: 'text' }] },
					{
						type: 'tabs',
						tabs: [
							{ name: 'meta', fields: [{ name: 'keywords', type: 'array', fields: [] }] },
							{ name: 'quiet', fields: [{ name: 'seoTitle', type: 'text' }] },
						],
					}
				)
			)
		).toEqual({ branding: { links: [{}] }, meta: { keywords: [{}] } })
	})

	it('merges rows, collapsibles, unnamed tabs, and unnamed groups into the current level', () => {
		expect(
			buildPrefillData(
				fields(
					{ type: 'row', fields: [{ name: 'a', type: 'array', fields: [] }] },
					{ type: 'collapsible', fields: [{ name: 'b', type: 'array', fields: [] }] },
					{ type: 'group', fields: [{ name: 'c', type: 'array', fields: [] }] },
					{
						type: 'tabs',
						tabs: [{ label: 'Content', fields: [{ name: 'd', type: 'array', fields: [] }] }],
					}
				)
			)
		).toEqual({ a: [{}], b: [{}], c: [{}], d: [{}] })
	})

	it('skips blocks', () => {
		expect(
			buildPrefillData(
				fields({
					name: 'layout',
					type: 'blocks',
					blocks: [{ slug: 'hero', fields: [{ name: 'rows', type: 'array', fields: [] }] }],
				})
			)
		).toBeUndefined()
	})

	it('carries an array through a named group inside an array row', () => {
		expect(
			buildPrefillData(
				fields({
					name: 'rows',
					type: 'array',
					fields: [
						{
							name: 'nested',
							type: 'group',
							fields: [{ name: 'inner', type: 'array', fields: [] }],
						},
					],
				})
			)
		).toEqual({ rows: [{ nested: { inner: [{}] } }] })
	})
})
