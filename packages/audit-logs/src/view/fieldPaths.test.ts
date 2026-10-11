import { describe, expect, it } from 'vitest'

import { fieldPaths } from './fieldPaths'

describe('fieldPaths', () => {
	it('dots through groups and named tabs, and passes through layout fields', () => {
		expect(
			fieldPaths([
				{ name: 'title', type: 'text' },
				{ fields: [{ name: 'title', type: 'text' }], name: 'seo', type: 'group' },
				{ fields: [{ name: 'status', type: 'select' }], type: 'row' },
				{
					tabs: [
						{ fields: [{ name: 'body', type: 'richText' }] },
						{ fields: [{ name: 'slug', type: 'text' }], name: 'settings' },
					],
					type: 'tabs',
				},
			])
		).toEqual(['title', 'seo.title', 'status', 'body', 'settings.slug'])
	})

	it('leaves out arrays, blocks, ui fields and the timestamps', () => {
		expect(
			fieldPaths([
				{ fields: [{ name: 'heading', type: 'text' }], name: 'sections', type: 'array' },
				{ name: 'layout', type: 'blocks' },
				{ name: 'preview', type: 'ui' },
				{ name: 'updatedAt', type: 'date' },
				{ name: 'createdAt', type: 'date' },
			])
		).toEqual([])
	})
})
