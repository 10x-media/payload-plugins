import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { buildFieldMap } from './buildFieldMap.js'

// Minimal field constructors — typed correctly to satisfy Payload's discriminated unions
const rel = (name: string, hasMany = false): Field =>
	({ type: 'relationship', name, relationTo: 'users', hasMany }) as Field

const upload = (name: string, hasMany = false): Field =>
	({ type: 'upload', name, relationTo: 'media', hasMany }) as Field

const text = (name: string): Field => ({ type: 'text', name }) as Field

const group = (name: string, fields: Field[]): Field => ({ type: 'group', name, fields }) as Field

const unnamedGroup = (fields: Field[]): Field => ({ type: 'group', fields }) as Field

const row = (fields: Field[]): Field => ({ type: 'row', fields }) as Field

const collapsible = (fields: Field[]): Field =>
	({ type: 'collapsible', label: 'Section', fields }) as Field

const namedTab = (name: string, fields: Field[]) => ({ name, fields })
const unnamedTab = (fields: Field[]) => ({ label: 'General', fields })

const tabs = (tabList: ReturnType<typeof namedTab | typeof unnamedTab>[]): Field =>
	({ type: 'tabs', tabs: tabList }) as Field

const array = (name: string, fields: Field[]): Field => ({ type: 'array', name, fields }) as Field

const blocks = (name: string, blockList: { slug: string; fields: Field[] }[]): Field =>
	({ type: 'blocks', name, blocks: blockList }) as Field

// ----------

describe('buildFieldMap', () => {
	describe('relationship and upload fields', () => {
		it('records a has-one relationship as rel-single', () => {
			const map = buildFieldMap([rel('author')])
			expect(map.get('author')).toBe('rel-single')
		})

		it('records a hasMany relationship as rel-many', () => {
			const map = buildFieldMap([rel('members', true)])
			expect(map.get('members')).toBe('rel-many')
		})

		it('records an upload field as rel-single', () => {
			const map = buildFieldMap([upload('cover')])
			expect(map.get('cover')).toBe('rel-single')
		})

		it('records a hasMany upload field as rel-many', () => {
			const map = buildFieldMap([upload('images', true)])
			expect(map.get('images')).toBe('rel-many')
		})

		it('ignores non-relationship fields', () => {
			const map = buildFieldMap([text('title'), rel('author')])
			expect(map.has('title')).toBe(false)
			expect(map.get('author')).toBe('rel-single')
		})
	})

	describe('named group', () => {
		it('adds group name as path prefix', () => {
			const map = buildFieldMap([group('settings', [rel('owner')])])
			expect(map.get('settings.owner')).toBe('rel-single')
			expect(map.has('owner')).toBe(false)
		})

		it('handles a top-level prefix with a named group', () => {
			const map = buildFieldMap([group('meta', [rel('author')])], 'root')
			expect(map.get('root.meta.author')).toBe('rel-single')
		})
	})

	describe('unnamed group', () => {
		it('inlines fields (no path segment added)', () => {
			const map = buildFieldMap([unnamedGroup([rel('author')])])
			expect(map.get('author')).toBe('rel-single')
		})
	})

	describe('row and collapsible', () => {
		it('row: inlines fields', () => {
			const map = buildFieldMap([row([rel('reviewer'), rel('approvers', true)])])
			expect(map.get('reviewer')).toBe('rel-single')
			expect(map.get('approvers')).toBe('rel-many')
		})

		it('collapsible: inlines fields', () => {
			const map = buildFieldMap([collapsible([rel('assignee')])])
			expect(map.get('assignee')).toBe('rel-single')
		})
	})

	describe('tabs', () => {
		it('named tab adds a path prefix', () => {
			const map = buildFieldMap([tabs([namedTab('general', [rel('owner')])])])
			expect(map.get('general.owner')).toBe('rel-single')
			expect(map.has('owner')).toBe(false)
		})

		it('unnamed tab inlines fields', () => {
			const map = buildFieldMap([tabs([unnamedTab([rel('owner')])])])
			expect(map.get('owner')).toBe('rel-single')
		})

		it('mixed tabs: named and unnamed in the same field', () => {
			const map = buildFieldMap([
				tabs([namedTab('general', [rel('owner')]), unnamedTab([rel('reviewer')])]),
			])
			expect(map.get('general.owner')).toBe('rel-single')
			expect(map.get('reviewer')).toBe('rel-single')
		})
	})

	describe('array fields', () => {
		it('uses wildcard for item-level relationships', () => {
			const map = buildFieldMap([array('steps', [rel('assignee')])])
			expect(map.get('steps.*.assignee')).toBe('rel-single')
			expect(map.has('steps.assignee')).toBe(false)
		})

		it('handles hasMany relationship inside array', () => {
			const map = buildFieldMap([array('steps', [rel('reviewers', true)])])
			expect(map.get('steps.*.reviewers')).toBe('rel-many')
		})

		it('ignores non-relationship fields inside array', () => {
			const map = buildFieldMap([array('steps', [text('title'), rel('assignee')])])
			expect(map.has('steps.*.title')).toBe(false)
			expect(map.get('steps.*.assignee')).toBe('rel-single')
		})
	})

	describe('blocks fields', () => {
		it('uses wildcard for relationships in blocks', () => {
			const map = buildFieldMap([
				blocks('content', [{ slug: 'hero', fields: [rel('background')] }]),
			])
			expect(map.get('content.*.background')).toBe('rel-single')
		})

		it('merges relationships from multiple block types under the same wildcard', () => {
			const map = buildFieldMap([
				blocks('content', [
					{ slug: 'hero', fields: [rel('image')] },
					{ slug: 'cta', fields: [rel('link'), rel('authors', true)] },
				]),
			])
			expect(map.get('content.*.image')).toBe('rel-single')
			expect(map.get('content.*.link')).toBe('rel-single')
			expect(map.get('content.*.authors')).toBe('rel-many')
		})
	})

	describe('nesting', () => {
		it('relationship inside array inside named group', () => {
			const map = buildFieldMap([group('meta', [array('items', [rel('owner')])])])
			expect(map.get('meta.items.*.owner')).toBe('rel-single')
		})

		it('array inside array (double wildcard)', () => {
			const map = buildFieldMap([array('sections', [array('blocks', [rel('author')])])])
			expect(map.get('sections.*.blocks.*.author')).toBe('rel-single')
		})

		it('relationship inside named tab inside array', () => {
			const map = buildFieldMap([array('steps', [tabs([namedTab('details', [rel('assignee')])])])])
			expect(map.get('steps.*.details.assignee')).toBe('rel-single')
		})

		it('relationship inside row inside named group', () => {
			const map = buildFieldMap([
				group('settings', [row([rel('owner'), rel('contributors', true)])]),
			])
			expect(map.get('settings.owner')).toBe('rel-single')
			expect(map.get('settings.contributors')).toBe('rel-many')
		})
	})

	describe('prefix parameter', () => {
		it('prepends prefix to all paths', () => {
			const map = buildFieldMap([rel('author'), rel('tags', true)], 'version')
			expect(map.get('version.author')).toBe('rel-single')
			expect(map.get('version.tags')).toBe('rel-many')
		})
	})

	describe('join fields', () => {
		it('records a join field as join kind', () => {
			const map = buildFieldMap([
				{ type: 'join', name: 'relatedPosts', collection: 'posts', on: 'author' } as Field,
			])
			expect(map.get('relatedPosts')).toBe('join')
		})

		it('records a join field inside a named group', () => {
			const map = buildFieldMap([
				group('meta', [{ type: 'join', name: 'linked', collection: 'posts', on: 'ref' } as Field]),
			])
			expect(map.get('meta.linked')).toBe('join')
		})

		it('records a join field inside an array (wildcard)', () => {
			const map = buildFieldMap([
				array('steps', [
					{ type: 'join', name: 'related', collection: 'posts', on: 'step' } as Field,
				]),
			])
			expect(map.get('steps.*.related')).toBe('join')
		})
	})

	describe('map accumulation', () => {
		it('accumulates into an existing map when passed in', () => {
			const existing = new Map<string, 'rel-single' | 'rel-many'>([['pre.owner', 'rel-single']])
			buildFieldMap([rel('reviewer')], '', existing)
			expect(existing.get('pre.owner')).toBe('rel-single')
			expect(existing.get('reviewer')).toBe('rel-single')
		})
	})
})
