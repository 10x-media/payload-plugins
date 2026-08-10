import { describe, expect, it } from 'vitest'

import { computeDiff, normalizeSnapshot } from './diff.js'

describe('computeDiff', () => {
  // ---------- Basic primitives ----------

  describe('primitives', () => {
    it('detects a changed string', () => {
      const result = computeDiff({ title: 'Hello' }, { title: 'World' })
      expect(result.diff).toEqual({ title: { before: 'Hello', after: 'World' } })
      expect(result.changedPaths).toEqual(['title'])
    })

    it('detects a changed number', () => {
      const result = computeDiff({ score: 10 }, { score: 20 })
      expect(result.diff).toEqual({ score: { before: 10, after: 20 } })
    })

    it('detects a changed boolean', () => {
      const result = computeDiff({ published: false }, { published: true })
      expect(result.diff).toEqual({ published: { before: false, after: true } })
    })

    it('returns empty diff when nothing changed', () => {
      const result = computeDiff({ title: 'Hello', count: 5 }, { title: 'Hello', count: 5 })
      expect(result.diff).toEqual({})
      expect(result.changedPaths).toEqual([])
    })

    it('detects a field added (before: undefined → after: value)', () => {
      const result = computeDiff({}, { name: 'Roma' })
      expect(result.diff).toEqual({ name: { before: null, after: 'Roma' } })
    })

    it('detects a field removed (before: value → after: undefined)', () => {
      const result = computeDiff({ name: 'Roma' }, {})
      expect(result.diff).toEqual({ name: { before: 'Roma', after: null } })
    })
  })

  // ---------- null / undefined ----------

  describe('null and undefined equality', () => {
    it('treats null and undefined as equal', () => {
      const result = computeDiff({ a: null }, { a: undefined })
      expect(result.diff).toEqual({})
    })

    it('treats undefined and null as equal', () => {
      const result = computeDiff({ a: undefined }, { a: null })
      expect(result.diff).toEqual({})
    })

    it('treats two nulls as equal', () => {
      const result = computeDiff({ a: null }, { a: null })
      expect(result.diff).toEqual({})
    })

    it('detects null → value change', () => {
      const result = computeDiff({ a: null }, { a: 'hello' })
      expect(result.diff).toEqual({ a: { before: null, after: 'hello' } })
    })

    it('detects value → null change', () => {
      const result = computeDiff({ a: 'hello' }, { a: null })
      expect(result.diff).toEqual({ a: { before: 'hello', after: null } })
    })

    it('handles null before document', () => {
      const result = computeDiff(null, { title: 'New' })
      expect(result.diff).toEqual({ title: { before: null, after: 'New' } })
    })

    it('handles undefined before document', () => {
      const result = computeDiff(undefined, { title: 'New' })
      expect(result.diff).toEqual({ title: { before: null, after: 'New' } })
    })
  })

  // ---------- Nested objects ----------

  describe('nested objects', () => {
    it('recurses into nested objects and produces dot-notation paths', () => {
      const result = computeDiff(
        { meta: { score: 1, status: 'active' } },
        { meta: { score: 2, status: 'active' } },
      )
      expect(result.diff).toEqual({ 'meta.score': { before: 1, after: 2 } })
      expect(result.changedPaths).toEqual(['meta.score'])
    })

    it('handles deep nesting', () => {
      const result = computeDiff(
        { a: { b: { c: { d: 1 } } } },
        { a: { b: { c: { d: 2 } } } },
      )
      expect(result.diff).toEqual({ 'a.b.c.d': { before: 1, after: 2 } })
    })

    it('records all changed fields in a nested object', () => {
      const result = computeDiff(
        { address: { city: 'Kyiv', zip: '01001' } },
        { address: { city: 'Lviv', zip: '79000' } },
      )
      expect(result.changedPaths).toEqual(
        expect.arrayContaining(['address.city', 'address.zip']),
      )
      expect(result.changedPaths).toHaveLength(2)
    })

    it('does not recurse when one side is null', () => {
      const result = computeDiff({ meta: null }, { meta: { score: 1 } })
      expect(result.diff).toEqual({ meta: { before: null, after: { score: 1 } } })
    })

    it('does not recurse when one side is an array', () => {
      const result = computeDiff({ items: [1, 2] }, { items: { 0: 1, 1: 2 } })
      expect(result.diff['items']).toBeDefined()
    })

    it('records no diff when nested object is unchanged', () => {
      const result = computeDiff(
        { meta: { score: 1 } },
        { meta: { score: 1 } },
      )
      expect(result.diff).toEqual({})
    })
  })

  // ---------- Arrays ----------

  describe('arrays', () => {
    it('stores full before/after for changed arrays', () => {
      const result = computeDiff({ tags: ['a', 'b'] }, { tags: ['a', 'c'] })
      expect(result.diff).toEqual({
        tags: { before: ['a', 'b'], after: ['a', 'c'] },
      })
    })

    it('treats identical arrays as equal', () => {
      const result = computeDiff({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })
      expect(result.diff).toEqual({})
    })

    it('detects order change in arrays as a diff', () => {
      const result = computeDiff({ tags: ['a', 'b'] }, { tags: ['b', 'a'] })
      expect(result.diff).toEqual({
        tags: { before: ['a', 'b'], after: ['b', 'a'] },
      })
    })

    it('diffs arrays of objects with id by item id (not full before/after)', () => {
      const result = computeDiff(
        { users: [{ id: 1, name: 'Alice' }] },
        { users: [{ id: 1, name: 'Bob' }] },
      )
      // id-based tracking: produces granular path, not full array replacement
      expect(result.diff).toEqual({ 'users.1.name': { before: 'Alice', after: 'Bob' } })
    })

    it('detects array growing', () => {
      const result = computeDiff({ items: [1] }, { items: [1, 2] })
      expect(result.diff).toEqual({ items: { before: [1], after: [1, 2] } })
    })
  })

  // ---------- Arrays of Payload items (id-based tracking) ----------

  describe('arrays of objects with id (Payload array fields)', () => {
    it('recurses into changed items using id as key', () => {
      const result = computeDiff(
        { steps: [{ id: 'abc', title: 'Old' }] },
        { steps: [{ id: 'abc', title: 'New' }] },
      )
      expect(result.diff).toEqual({ 'steps.abc.title': { before: 'Old', after: 'New' } })
      expect(result.changedPaths).toEqual(['steps.abc.title'])
    })

    it('records added item with before: null', () => {
      const result = computeDiff(
        { steps: [{ id: 'abc', title: 'A' }] },
        { steps: [{ id: 'abc', title: 'A' }, { id: 'xyz', title: 'B' }] },
      )
      expect(result.diff['steps.xyz']).toEqual({ before: null, after: { id: 'xyz', title: 'B' } })
      expect(result.diff['steps.abc']).toBeUndefined()
    })

    it('records removed item with after: null', () => {
      const result = computeDiff(
        { steps: [{ id: 'abc', title: 'A' }, { id: 'xyz', title: 'B' }] },
        { steps: [{ id: 'abc', title: 'A' }] },
      )
      expect(result.diff['steps.xyz']).toEqual({ before: { id: 'xyz', title: 'B' }, after: null })
      expect(result.diff['steps.abc']).toBeUndefined()
    })

    it('records __order__ when existing items are reordered', () => {
      const result = computeDiff(
        { steps: [{ id: 'abc', title: 'A' }, { id: 'xyz', title: 'B' }] },
        { steps: [{ id: 'xyz', title: 'B' }, { id: 'abc', title: 'A' }] },
      )
      expect(result.diff['steps.__order__']).toEqual({
        before: ['abc', 'xyz'],
        after: ['xyz', 'abc'],
      })
    })

    it('does not record __order__ when only adding item to end', () => {
      const result = computeDiff(
        { steps: [{ id: 'abc', title: 'A' }] },
        { steps: [{ id: 'abc', title: 'A' }, { id: 'xyz', title: 'B' }] },
      )
      expect(result.diff['steps.__order__']).toBeUndefined()
    })

    it('does not record __order__ when only removing item', () => {
      const result = computeDiff(
        { steps: [{ id: 'abc', title: 'A' }, { id: 'xyz', title: 'B' }] },
        { steps: [{ id: 'abc', title: 'A' }] },
      )
      expect(result.diff['steps.__order__']).toBeUndefined()
    })

    it('records both __order__ and item diff when reordering and changing', () => {
      const result = computeDiff(
        { steps: [{ id: 'abc', title: 'A' }, { id: 'xyz', title: 'B' }] },
        { steps: [{ id: 'xyz', title: 'B' }, { id: 'abc', title: 'Changed' }] },
      )
      expect(result.diff['steps.__order__']).toBeDefined()
      expect(result.diff['steps.abc.title']).toEqual({ before: 'A', after: 'Changed' })
    })

    it('does not diff unchanged items', () => {
      const result = computeDiff(
        { steps: [{ id: 'abc', title: 'A' }, { id: 'xyz', title: 'B' }] },
        { steps: [{ id: 'abc', title: 'A' }, { id: 'xyz', title: 'B' }] },
      )
      expect(result.diff).toEqual({})
    })

    it('handles empty before array → items added', () => {
      const result = computeDiff(
        { steps: [] },
        { steps: [{ id: 'abc', title: 'A' }] },
      )
      expect(result.diff['steps.abc']).toEqual({ before: null, after: { id: 'abc', title: 'A' } })
    })

    it('handles items array → empty after', () => {
      const result = computeDiff(
        { steps: [{ id: 'abc', title: 'A' }] },
        { steps: [] },
      )
      expect(result.diff['steps.abc']).toEqual({ before: { id: 'abc', title: 'A' }, after: null })
    })

    it('supports nested arrays inside array items — field change', () => {
      const result = computeDiff(
        { sections: [{ id: 's1', blocks: [{ id: 'b1', text: 'Old' }] }] },
        { sections: [{ id: 's1', blocks: [{ id: 'b1', text: 'New' }] }] },
      )
      expect(result.diff).toEqual({
        'sections.s1.blocks.b1.text': { before: 'Old', after: 'New' },
      })
    })

    it('supports nested arrays inside array items — item added in inner array', () => {
      const result = computeDiff(
        { sections: [{ id: 's1', blocks: [{ id: 'b1', text: 'A' }] }] },
        { sections: [{ id: 's1', blocks: [{ id: 'b1', text: 'A' }, { id: 'b2', text: 'B' }] }] },
      )
      expect(result.diff['sections.s1.blocks.b2']).toEqual({
        before: null,
        after: { id: 'b2', text: 'B' },
      })
      expect(result.diff['sections.s1.blocks.b1']).toBeUndefined()
    })

    it('supports nested arrays inside array items — item removed in inner array', () => {
      const result = computeDiff(
        { sections: [{ id: 's1', blocks: [{ id: 'b1', text: 'A' }, { id: 'b2', text: 'B' }] }] },
        { sections: [{ id: 's1', blocks: [{ id: 'b1', text: 'A' }] }] },
      )
      expect(result.diff['sections.s1.blocks.b2']).toEqual({
        before: { id: 'b2', text: 'B' },
        after: null,
      })
    })

    it('supports nested arrays inside array items — reorder in inner array', () => {
      const result = computeDiff(
        { sections: [{ id: 's1', blocks: [{ id: 'b1', text: 'A' }, { id: 'b2', text: 'B' }] }] },
        { sections: [{ id: 's1', blocks: [{ id: 'b2', text: 'B' }, { id: 'b1', text: 'A' }] }] },
      )
      expect(result.diff['sections.s1.blocks.__order__']).toEqual({
        before: ['b1', 'b2'],
        after: ['b2', 'b1'],
      })
    })

    it('supports triple nesting (array in array in array)', () => {
      const result = computeDiff(
        {
          pages: [{
            id: 'p1',
            sections: [{
              id: 's1',
              blocks: [{ id: 'b1', text: 'Old' }],
            }],
          }],
        },
        {
          pages: [{
            id: 'p1',
            sections: [{
              id: 's1',
              blocks: [{ id: 'b1', text: 'New' }],
            }],
          }],
        },
      )
      expect(result.diff).toEqual({
        'pages.p1.sections.s1.blocks.b1.text': { before: 'Old', after: 'New' },
      })
    })

    it('parent reorder + child field change simultaneously', () => {
      const result = computeDiff(
        {
          sections: [
            { id: 's1', title: 'Old Title', blocks: [] },
            { id: 's2', title: 'B', blocks: [] },
          ],
        },
        {
          sections: [
            { id: 's2', title: 'B', blocks: [] },
            { id: 's1', title: 'New Title', blocks: [] },
          ],
        },
      )
      expect(result.diff['sections.__order__']).toEqual({
        before: ['s1', 's2'],
        after: ['s2', 's1'],
      })
      expect(result.diff['sections.s1.title']).toEqual({ before: 'Old Title', after: 'New Title' })
      expect(result.diff['sections.s2']).toBeUndefined()
    })

    it('parent reorder + child array reorder simultaneously', () => {
      const result = computeDiff(
        {
          sections: [
            { id: 's1', blocks: [{ id: 'b1' }, { id: 'b2' }] },
            { id: 's2', blocks: [] },
          ],
        },
        {
          sections: [
            { id: 's2', blocks: [] },
            { id: 's1', blocks: [{ id: 'b2' }, { id: 'b1' }] },
          ],
        },
      )
      expect(result.diff['sections.__order__']).toEqual({
        before: ['s1', 's2'],
        after: ['s2', 's1'],
      })
      expect(result.diff['sections.s1.blocks.__order__']).toEqual({
        before: ['b1', 'b2'],
        after: ['b2', 'b1'],
      })
    })

    it('parent reorder + child array item added simultaneously', () => {
      const result = computeDiff(
        {
          sections: [
            { id: 's1', blocks: [{ id: 'b1', text: 'A' }] },
            { id: 's2', blocks: [] },
          ],
        },
        {
          sections: [
            { id: 's2', blocks: [] },
            { id: 's1', blocks: [{ id: 'b1', text: 'A' }, { id: 'b2', text: 'New' }] },
          ],
        },
      )
      expect(result.diff['sections.__order__']).toBeDefined()
      expect(result.diff['sections.s1.blocks.b2']).toEqual({
        before: null,
        after: { id: 'b2', text: 'New' },
      })
      expect(result.diff['sections.s1.blocks.__order__']).toBeUndefined()
    })

    it('multiple parent items changed simultaneously', () => {
      const result = computeDiff(
        {
          sections: [
            { id: 's1', title: 'A' },
            { id: 's2', title: 'B' },
            { id: 's3', title: 'C' },
          ],
        },
        {
          sections: [
            { id: 's1', title: 'A changed' },
            { id: 's2', title: 'B changed' },
            { id: 's3', title: 'C' },
          ],
        },
      )
      expect(result.diff['sections.s1.title']).toEqual({ before: 'A', after: 'A changed' })
      expect(result.diff['sections.s2.title']).toEqual({ before: 'B', after: 'B changed' })
      expect(result.diff['sections.s3']).toBeUndefined()
      expect(result.diff['sections.__order__']).toBeUndefined()
    })

    it('parent item removed + sibling item has child reorder', () => {
      const result = computeDiff(
        {
          sections: [
            { id: 's1', blocks: [{ id: 'b1' }, { id: 'b2' }] },
            { id: 's2', blocks: [] },
          ],
        },
        {
          sections: [
            { id: 's1', blocks: [{ id: 'b2' }, { id: 'b1' }] },
          ],
        },
      )
      expect(result.diff['sections.s2']).toEqual({
        before: { id: 's2', blocks: [] },
        after: null,
      })
      expect(result.diff['sections.s1.blocks.__order__']).toEqual({
        before: ['b1', 'b2'],
        after: ['b2', 'b1'],
      })
      // s2 removal is not an order change for existing items
      expect(result.diff['sections.__order__']).toBeUndefined()
    })

    it('handles outer array item removed when it contains inner array', () => {
      const result = computeDiff(
        {
          sections: [
            { id: 's1', blocks: [{ id: 'b1', text: 'A' }] },
            { id: 's2', blocks: [{ id: 'b2', text: 'B' }] },
          ],
        },
        {
          sections: [{ id: 's1', blocks: [{ id: 'b1', text: 'A' }] }],
        },
      )
      // Entire s2 recorded as removed — does not recurse into a removed item
      expect(result.diff['sections.s2']).toEqual({
        before: { id: 's2', blocks: [{ id: 'b2', text: 'B' }] },
        after: null,
      })
    })

    it('falls back to full before/after for arrays of primitives', () => {
      const result = computeDiff({ tags: ['a', 'b'] }, { tags: ['a', 'c'] })
      expect(result.diff).toEqual({ tags: { before: ['a', 'b'], after: ['a', 'c'] } })
    })

    it('falls back to full before/after for arrays of objects without id', () => {
      const result = computeDiff(
        { items: [{ name: 'A' }] },
        { items: [{ name: 'B' }] },
      )
      expect(result.diff).toEqual({ items: { before: [{ name: 'A' }], after: [{ name: 'B' }] } })
    })

    it('records __order__ with full id sequence including added items', () => {
      const result = computeDiff(
        { steps: [{ id: 'b', title: 'B' }, { id: 'a', title: 'A' }] },
        { steps: [{ id: 'a', title: 'A' }, { id: 'c', title: 'C' }, { id: 'b', title: 'B' }] },
      )
      expect(result.diff['steps.__order__']).toEqual({
        before: ['b', 'a'],
        after: ['a', 'c', 'b'],
      })
    })
  })

  // ---------- excludeFields ----------

  describe('excludeFields', () => {
    it('skips paths in excludeFields', () => {
      const result = computeDiff(
        { title: 'Hello', internalNote: 'old' },
        { title: 'Hello', internalNote: 'new' },
        ['internalNote'],
      )
      expect(result.diff).toEqual({})
    })

    it('skips nested paths in excludeFields', () => {
      const result = computeDiff(
        { meta: { score: 1, internal: 'old' } },
        { meta: { score: 1, internal: 'new' } },
        ['meta.internal'],
      )
      expect(result.diff).toEqual({})
    })

    it('does not skip fields with similar but different paths', () => {
      const result = computeDiff(
        { note: 'old', internalNote: 'old' },
        { note: 'new', internalNote: 'new' },
        ['internalNote'],
      )
      expect(result.diff).toEqual({ note: { before: 'old', after: 'new' } })
    })
  })

  // ---------- always excluded fields ----------

  describe('updatedAt and id always excluded', () => {
    it('always excludes top-level updatedAt', () => {
      const result = computeDiff(
        { title: 'Same', updatedAt: '2026-01-01' },
        { title: 'Same', updatedAt: '2026-03-24' },
      )
      expect(result.diff).toEqual({})
    })

    it('excludes updatedAt even if not in excludeFields', () => {
      const result = computeDiff(
        { updatedAt: '2026-01-01' },
        { updatedAt: '2026-03-24' },
        [],
      )
      expect(result.diff).toEqual({})
    })

    it('does not exclude nested updatedAt', () => {
      const result = computeDiff(
        { meta: { updatedAt: '2026-01-01' } },
        { meta: { updatedAt: '2026-03-24' } },
      )
      expect(result.diff).toEqual({
        'meta.updatedAt': { before: '2026-01-01', after: '2026-03-24' },
      })
    })

    it('always excludes top-level id', () => {
      const result = computeDiff(
        { title: 'Same' },
        { title: 'Same', id: '69c52bdf34a623626632f41b' },
      )
      expect(result.diff).toEqual({})
    })

    it('excludes id even when diffing against a version snapshot without id', () => {
      // findVersions returns version data without the document id field
      const result = computeDiff(
        { title: 'Old' },
        { id: '69c52bdf34a623626632f41b', title: 'New' },
      )
      expect(result.diff).toEqual({ title: { before: 'Old', after: 'New' } })
    })

    it('does not exclude nested id', () => {
      const result = computeDiff(
        { ref: { id: 'abc', name: 'Old' } },
        { ref: { id: 'abc', name: 'New' } },
      )
      expect(result.diff).toEqual({ 'ref.name': { before: 'Old', after: 'New' } })
    })
  })

  // ---------- Type transitions ----------

  describe('type transitions', () => {
    it('detects object changed to primitive', () => {
      const result = computeDiff({ field: { nested: 1 } }, { field: 'string' })
      expect(result.diff).toEqual({ field: { before: { nested: 1 }, after: 'string' } })
    })

    it('detects primitive changed to object', () => {
      const result = computeDiff({ field: 'string' }, { field: { nested: 1 } })
      expect(result.diff).toEqual({ field: { before: 'string', after: { nested: 1 } } })
    })

    it('detects object changed to array', () => {
      const result = computeDiff({ field: { a: 1 } }, { field: [1, 2] })
      expect(result.diff).toEqual({ field: { before: { a: 1 }, after: [1, 2] } })
    })

    it('detects 0 vs false as different (strict)', () => {
      const result = computeDiff({ a: 0 }, { a: false })
      expect(result.diff).toEqual({ a: { before: 0, after: false } })
    })

    it('detects empty string vs null as different', () => {
      const result = computeDiff({ a: '' }, { a: null })
      expect(result.diff).toEqual({ a: { before: '', after: null } })
    })
  })

  // ---------- changedPaths ----------

  describe('changedPaths', () => {
    it('returns all changed paths as a flat array', () => {
      const result = computeDiff(
        { a: 1, b: { c: 2, d: 3 } },
        { a: 1, b: { c: 99, d: 3 } },
      )
      expect(result.changedPaths).toEqual(['b.c'])
    })

    it('returns empty array when nothing changed', () => {
      const result = computeDiff({ a: 1 }, { a: 1 })
      expect(result.changedPaths).toEqual([])
    })
  })

  // ---------- Populated relationships ----------

  describe('populated relationships', () => {
    it('treats populated doc as no change when IDs match (string before, object after)', () => {
      const result = computeDiff(
        { author: '69c26c4c8adc2a97fbd724e5' },
        { author: { id: '69c26c4c8adc2a97fbd724e5', email: 'dev@example.com', createdAt: '2026-01-01' } },
      )
      expect(result.changedPaths).toHaveLength(0)
      expect(result.diff).toEqual({})
    })

    it('treats populated doc as no change when IDs match (object before, string after)', () => {
      const result = computeDiff(
        { author: { id: '69c26c4c8adc2a97fbd724e5', email: 'dev@example.com' } },
        { author: '69c26c4c8adc2a97fbd724e5' },
      )
      expect(result.changedPaths).toHaveLength(0)
    })

    it('detects a real relationship change when IDs differ', () => {
      const result = computeDiff(
        { author: 'id-one' },
        { author: { id: 'id-two', email: 'other@example.com', createdAt: '2026-01-01' } },
      )
      expect(result.diff).toEqual({ author: { before: 'id-one', after: 'id-two' } })
      expect(result.changedPaths).toEqual(['author'])
    })

    it('handles polymorphic relationship: same ID, one side populated', () => {
      const result = computeDiff(
        { createdBy: { relationTo: 'users', value: 'id-abc' } },
        { createdBy: { relationTo: 'users', value: { id: 'id-abc', email: 'x@x.com' } } },
      )
      expect(result.changedPaths).toHaveLength(0)
    })

    it('handles polymorphic relationship: ID changed', () => {
      const result = computeDiff(
        { createdBy: { relationTo: 'users', value: 'id-abc' } },
        { createdBy: { relationTo: 'users', value: { id: 'id-xyz', email: 'x@x.com' } } },
      )
      expect(result.diff['createdBy.value']).toEqual({ before: 'id-abc', after: 'id-xyz' })
    })

    it('handles polymorphic relationship: collection changed', () => {
      const result = computeDiff(
        { lastModifiedBy: { relationTo: 'users', value: 'id-abc' } },
        { lastModifiedBy: { relationTo: 'admins', value: { id: 'id-xyz', adminName: 'Admin' } } },
      )
      expect(result.diff['lastModifiedBy.relationTo']).toEqual({ before: 'users', after: 'admins' })
      expect(result.diff['lastModifiedBy.value']).toEqual({ before: 'id-abc', after: 'id-xyz' })
    })
  })

  // ---------- Schema-aware diffing (with fieldMap) ----------

  describe('schema-aware diffing (fieldMap)', () => {
    const fm = (entries: [string, 'rel-single' | 'rel-many' | 'join'][]): Map<string, 'rel-single' | 'rel-many' | 'join'> =>
      new Map(entries)

    describe('rel-single — top-level', () => {
      it('no diff when both sides are the same raw ID', () => {
        const result = computeDiff({ author: 'id-a' }, { author: 'id-a' }, [], fm([['author', 'rel-single']]))
        expect(result.diff).toEqual({})
      })

      it('detects change between two raw IDs', () => {
        const result = computeDiff({ author: 'id-a' }, { author: 'id-b' }, [], fm([['author', 'rel-single']]))
        expect(result.diff).toEqual({ author: { before: 'id-a', after: 'id-b' } })
      })

      it('no diff when both sides are populated objects with the same ID', () => {
        // This is the case heuristics can NOT handle — both sides are objects, no scalar asymmetry.
        // fieldMap normalizes both to IDs before comparing.
        const result = computeDiff(
          { author: { id: 'id-a', name: 'Alice', role: 'admin' } },
          { author: { id: 'id-a', name: 'Alice', role: 'editor' } }, // role changed but same relationship
          [],
          fm([['author', 'rel-single']]),
        )
        expect(result.diff).toEqual({})
      })

      it('detects change when both sides are populated objects with different IDs', () => {
        const result = computeDiff(
          { author: { id: 'id-a', name: 'Alice' } },
          { author: { id: 'id-b', name: 'Bob' } },
          [],
          fm([['author', 'rel-single']]),
        )
        expect(result.diff).toEqual({ author: { before: 'id-a', after: 'id-b' } })
      })

      it('no diff when one side is a raw ID and the other is a populated object with the same ID', () => {
        const result = computeDiff(
          { author: 'id-a' },
          { author: { id: 'id-a', name: 'Alice' } },
          [],
          fm([['author', 'rel-single']]),
        )
        expect(result.diff).toEqual({})
      })

      it('detects change when one side is null', () => {
        const result = computeDiff({ author: null }, { author: 'id-a' }, [], fm([['author', 'rel-single']]))
        expect(result.diff).toEqual({ author: { before: null, after: 'id-a' } })
      })
    })

    describe('rel-many — top-level', () => {
      it('no diff when both sides are the same raw ID arrays', () => {
        const result = computeDiff(
          { tags: ['id-1', 'id-2'] },
          { tags: ['id-1', 'id-2'] },
          [],
          fm([['tags', 'rel-many']]),
        )
        expect(result.diff).toEqual({})
      })

      it('detects change between two raw ID arrays', () => {
        const result = computeDiff(
          { tags: ['id-1', 'id-2'] },
          { tags: ['id-1', 'id-3'] },
          [],
          fm([['tags', 'rel-many']]),
        )
        expect(result.diff).toEqual({ tags: { before: ['id-1', 'id-2'], after: ['id-1', 'id-3'] } })
      })

      it('no diff when raw IDs match populated objects', () => {
        const result = computeDiff(
          { tags: ['id-1', 'id-2'] },
          { tags: [{ id: 'id-1', label: 'A' }, { id: 'id-2', label: 'B' }] },
          [],
          fm([['tags', 'rel-many']]),
        )
        expect(result.diff).toEqual({})
      })

      it('no diff when both sides are populated objects with the same IDs', () => {
        // fieldMap normalizes populated[] → id[] before comparing
        const result = computeDiff(
          { tags: [{ id: 'id-1', label: 'A' }, { id: 'id-2', label: 'B' }] },
          { tags: [{ id: 'id-1', label: 'X' }, { id: 'id-2', label: 'Y' }] },
          [],
          fm([['tags', 'rel-many']]),
        )
        expect(result.diff).toEqual({})
      })

      it('detects item added (populated after)', () => {
        const result = computeDiff(
          { tags: [{ id: 'id-1', label: 'A' }] },
          { tags: [{ id: 'id-1', label: 'A' }, { id: 'id-2', label: 'B' }] },
          [],
          fm([['tags', 'rel-many']]),
        )
        expect(result.diff).toEqual({ tags: { before: ['id-1'], after: ['id-1', 'id-2'] } })
      })

      it('detects item removed', () => {
        const result = computeDiff(
          { tags: ['id-1', 'id-2'] },
          { tags: ['id-1'] },
          [],
          fm([['tags', 'rel-many']]),
        )
        expect(result.diff).toEqual({ tags: { before: ['id-1', 'id-2'], after: ['id-1'] } })
      })
    })

    describe('inside named group', () => {
      it('rel-single inside group: no diff when IDs match', () => {
        const result = computeDiff(
          { meta: { owner: 'id-a' } },
          { meta: { owner: { id: 'id-a', name: 'Alice' } } },
          [],
          fm([['meta.owner', 'rel-single']]),
        )
        expect(result.diff).toEqual({})
      })

      it('rel-many inside group: normalizes to IDs', () => {
        const result = computeDiff(
          { meta: { reviewers: ['id-1'] } },
          { meta: { reviewers: [{ id: 'id-1', name: 'Alice' }, { id: 'id-2', name: 'Bob' }] } },
          [],
          fm([['meta.reviewers', 'rel-many']]),
        )
        expect(result.diff).toEqual({ 'meta.reviewers': { before: ['id-1'], after: ['id-1', 'id-2'] } })
      })
    })

    describe('inside array items (wildcard lookup)', () => {
      it('rel-single inside array: no diff when IDs match across items', () => {
        const result = computeDiff(
          { steps: [{ id: 's1', assignee: 'id-a' }, { id: 's2', assignee: 'id-b' }] },
          {
            steps: [
              { id: 's1', assignee: { id: 'id-a', name: 'Alice' } },
              { id: 's2', assignee: { id: 'id-b', name: 'Bob' } },
            ],
          },
          [],
          fm([['steps.*.assignee', 'rel-single']]),
        )
        expect(result.diff).toEqual({})
      })

      it('rel-single inside array: detects changed assignee', () => {
        const result = computeDiff(
          { steps: [{ id: 's1', assignee: 'id-a' }] },
          { steps: [{ id: 's1', assignee: { id: 'id-b', name: 'Bob' } }] },
          [],
          fm([['steps.*.assignee', 'rel-single']]),
        )
        expect(result.diff).toEqual({ 'steps.s1.assignee': { before: 'id-a', after: 'id-b' } })
      })

      it('rel-many inside array: no diff when IDs match', () => {
        const result = computeDiff(
          { steps: [{ id: 's1', reviewers: ['id-1', 'id-2'] }] },
          { steps: [{ id: 's1', reviewers: [{ id: 'id-1' }, { id: 'id-2' }] }] },
          [],
          fm([['steps.*.reviewers', 'rel-many']]),
        )
        expect(result.diff).toEqual({})
      })

      it('rel-many inside array: detects added reviewer', () => {
        const result = computeDiff(
          { steps: [{ id: 's1', reviewers: ['id-1'] }] },
          { steps: [{ id: 's1', reviewers: [{ id: 'id-1' }, { id: 'id-2' }] }] },
          [],
          fm([['steps.*.reviewers', 'rel-many']]),
        )
        expect(result.diff).toEqual({ 'steps.s1.reviewers': { before: ['id-1'], after: ['id-1', 'id-2'] } })
      })

      it('regular fields in array items still use id-tracked diffing', () => {
        const result = computeDiff(
          { steps: [{ id: 's1', title: 'Old', assignee: 'id-a' }] },
          { steps: [{ id: 's1', title: 'New', assignee: { id: 'id-a', name: 'Alice' } }] },
          [],
          fm([['steps.*.assignee', 'rel-single']]),
        )
        expect(result.diff['steps.s1.title']).toEqual({ before: 'Old', after: 'New' })
        expect(result.diff['steps.s1.assignee']).toBeUndefined() // same ID → no diff
      })
    })

    describe('double-nested (array inside group, array inside array)', () => {
      it('rel-single two levels deep: group → array → field', () => {
        const result = computeDiff(
          { project: { tasks: [{ id: 't1', owner: 'id-a' }] } },
          { project: { tasks: [{ id: 't1', owner: { id: 'id-a', name: 'Alice' } }] } },
          [],
          fm([['project.tasks.*.owner', 'rel-single']]),
        )
        expect(result.diff).toEqual({})
      })

      it('rel-single two arrays deep: wildcard matches both levels', () => {
        const result = computeDiff(
          { sections: [{ id: 'sec1', blocks: [{ id: 'b1', author: 'id-a' }] }] },
          { sections: [{ id: 'sec1', blocks: [{ id: 'b1', author: { id: 'id-b', name: 'Bob' } }] }] },
          [],
          fm([['sections.*.blocks.*.author', 'rel-single']]),
        )
        expect(result.diff).toEqual({ 'sections.sec1.blocks.b1.author': { before: 'id-a', after: 'id-b' } })
      })
    })

    describe('join fields are skipped', () => {
      it('ignores a top-level join field entirely', () => {
        const result = computeDiff(
          { title: 'A', related: { docs: [{ id: 'x' }], hasNextPage: false } },
          { title: 'A', related: { docs: [{ id: 'x' }, { id: 'y' }], hasNextPage: false } },
          [],
          fm([['related', 'join']]),
        )
        expect(result.diff).toEqual({})
      })

      it('ignores a join field inside an array item', () => {
        const result = computeDiff(
          { steps: [{ id: 's1', title: 'Old', linked: { docs: [], hasNextPage: false } }] },
          { steps: [{ id: 's1', title: 'New', linked: { docs: [{ id: 'x' }], hasNextPage: false } }] },
          [],
          fm([['steps.*.linked', 'join']]),
        )
        expect(result.diff).toEqual({ 'steps.s1.title': { before: 'Old', after: 'New' } })
        expect(result.diff['steps.s1.linked']).toBeUndefined()
      })
    })

    describe('fields not in fieldMap use existing logic', () => {
      it('non-relationship field unchanged — no diff', () => {
        const result = computeDiff(
          { title: 'Hello', owner: 'id-a' },
          { title: 'Hello', owner: 'id-a' },
          [],
          fm([['owner', 'rel-single']]),
        )
        expect(result.diff).toEqual({})
      })

      it('scalar field change is still detected', () => {
        const result = computeDiff(
          { title: 'Old', owner: 'id-a' },
          { title: 'New', owner: 'id-a' },
          [],
          fm([['owner', 'rel-single']]),
        )
        expect(result.diff).toEqual({ title: { before: 'Old', after: 'New' } })
      })
    })

    describe('polymorphic rel-single (multi-collection relationTo)', () => {
      it('no diff when raw ID matches populated value (the real-world case: last_updated_by)', () => {
        const result = computeDiff(
          { last_updated_by: { relationTo: 'adminUsers', value: '69c2b49ea54d6f96ba7beafd' } },
          {
            last_updated_by: {
              relationTo: 'adminUsers',
              value: { id: '69c2b49ea54d6f96ba7beafd', email: 'roman@example.com', roles: ['admin'] },
            },
          },
          [],
          fm([['last_updated_by', 'rel-single']]),
        )
        expect(result.diff).toEqual({})
        expect(result.changedPaths).toHaveLength(0)
      })

      it('no diff when both sides are populated objects with the same ID', () => {
        const result = computeDiff(
          { last_updated_by: { relationTo: 'adminUsers', value: { id: 'id-a', email: 'a@a.com', sessions: [] } } },
          { last_updated_by: { relationTo: 'adminUsers', value: { id: 'id-a', email: 'a@a.com', sessions: [{ id: 's1' }] } } },
          [],
          fm([['last_updated_by', 'rel-single']]),
        )
        expect(result.diff).toEqual({})
      })

      it('detects change when IDs differ (raw before, populated after)', () => {
        const result = computeDiff(
          { last_updated_by: { relationTo: 'adminUsers', value: 'id-a' } },
          { last_updated_by: { relationTo: 'adminUsers', value: { id: 'id-b', email: 'b@b.com' } } },
          [],
          fm([['last_updated_by', 'rel-single']]),
        )
        expect(result.diff).toEqual({
          last_updated_by: {
            before: { relationTo: 'adminUsers', value: 'id-a' },
            after: { relationTo: 'adminUsers', value: 'id-b' },
          },
        })
      })

      it('detects change when both sides are populated objects with different IDs', () => {
        const result = computeDiff(
          { last_updated_by: { relationTo: 'adminUsers', value: { id: 'id-a', email: 'a@a.com' } } },
          { last_updated_by: { relationTo: 'adminUsers', value: { id: 'id-b', email: 'b@b.com' } } },
          [],
          fm([['last_updated_by', 'rel-single']]),
        )
        expect(result.diff).toEqual({
          last_updated_by: {
            before: { relationTo: 'adminUsers', value: 'id-a' },
            after: { relationTo: 'adminUsers', value: 'id-b' },
          },
        })
      })

      it('detects change when collection changes (relationTo differs)', () => {
        const result = computeDiff(
          { createdBy: { relationTo: 'users', value: 'id-a' } },
          { createdBy: { relationTo: 'adminUsers', value: { id: 'id-a', email: 'a@a.com' } } },
          [],
          fm([['createdBy', 'rel-single']]),
        )
        // different relationTo → different normalized objects → diff recorded
        expect(result.diff['createdBy']).toEqual({
          before: { relationTo: 'users', value: 'id-a' },
          after: { relationTo: 'adminUsers', value: 'id-a' },
        })
      })

      it('detects null → polymorphic value', () => {
        const result = computeDiff(
          { createdBy: null },
          { createdBy: { relationTo: 'adminUsers', value: { id: 'id-a', email: 'a@a.com' } } },
          [],
          fm([['createdBy', 'rel-single']]),
        )
        expect(result.diff).toEqual({
          createdBy: { before: null, after: { relationTo: 'adminUsers', value: 'id-a' } },
        })
      })

      it('no diff for polymorphic rel-single inside array items', () => {
        const result = computeDiff(
          { steps: [{ id: 's1', assignedTo: { relationTo: 'users', value: 'id-a' } }] },
          { steps: [{ id: 's1', assignedTo: { relationTo: 'users', value: { id: 'id-a', name: 'Alice' } } }] },
          [],
          fm([['steps.*.assignedTo', 'rel-single']]),
        )
        expect(result.diff).toEqual({})
      })
    })

    describe('polymorphic rel-many (multi-collection has-many)', () => {
      it('no diff when raw polymorphic IDs match populated values', () => {
        const result = computeDiff(
          {
            participants: [
              { relationTo: 'users', value: 'id-1' },
              { relationTo: 'adminUsers', value: 'id-2' },
            ],
          },
          {
            participants: [
              { relationTo: 'users', value: { id: 'id-1', name: 'Alice' } },
              { relationTo: 'adminUsers', value: { id: 'id-2', email: 'b@b.com' } },
            ],
          },
          [],
          fm([['participants', 'rel-many']]),
        )
        expect(result.diff).toEqual({})
      })

      it('detects added polymorphic item', () => {
        const result = computeDiff(
          { participants: [{ relationTo: 'users', value: 'id-1' }] },
          {
            participants: [
              { relationTo: 'users', value: { id: 'id-1', name: 'Alice' } },
              { relationTo: 'adminUsers', value: { id: 'id-2', email: 'b@b.com' } },
            ],
          },
          [],
          fm([['participants', 'rel-many']]),
        )
        expect(result.diff).toEqual({
          participants: {
            before: [{ relationTo: 'users', value: 'id-1' }],
            after: [{ relationTo: 'users', value: 'id-1' }, { relationTo: 'adminUsers', value: 'id-2' }],
          },
        })
      })
    })
  })

  // ---------- Relationship arrays (has-many) ----------

  describe('relationship arrays', () => {
    it('no diff when raw IDs match populated objects (string[] before, objects after)', () => {
      const result = computeDiff(
        { participants: ['id-1', 'id-2'] },
        {
          participants: [
            { id: 'id-1', name: 'Alice', email: 'a@example.com' },
            { id: 'id-2', name: 'Bob', email: 'b@example.com' },
          ],
        },
      )
      expect(result.diff).toEqual({})
      expect(result.changedPaths).toHaveLength(0)
    })

    it('no diff when populated objects match raw IDs (objects before, string[] after)', () => {
      const result = computeDiff(
        {
          participants: [
            { id: 'id-1', name: 'Alice' },
            { id: 'id-2', name: 'Bob' },
          ],
        },
        { participants: ['id-1', 'id-2'] },
      )
      expect(result.diff).toEqual({})
    })

    it('detects added item in relationship array (raw before, populated after)', () => {
      const result = computeDiff(
        { participants: ['id-1'] },
        {
          participants: [
            { id: 'id-1', name: 'Alice' },
            { id: 'id-2', name: 'Bob' },
          ],
        },
      )
      expect(result.diff).toEqual({
        participants: { before: ['id-1'], after: ['id-1', 'id-2'] },
      })
    })

    it('detects removed item in relationship array (raw before, populated after)', () => {
      const result = computeDiff(
        { participants: ['id-1', 'id-2'] },
        { participants: [{ id: 'id-1', name: 'Alice' }] },
      )
      expect(result.diff).toEqual({
        participants: { before: ['id-1', 'id-2'], after: ['id-1'] },
      })
    })

    it('detects fully replaced relationship array', () => {
      const result = computeDiff(
        { participants: ['id-1', 'id-2'] },
        { participants: [{ id: 'id-3', name: 'Carol' }] },
      )
      expect(result.diff).toEqual({
        participants: { before: ['id-1', 'id-2'], after: ['id-3'] },
      })
    })

    it('handles empty before with populated after (falls back to item-level diff)', () => {
      const result = computeDiff(
        { participants: [] },
        { participants: [{ id: 'id-1', name: 'Alice' }] },
      )
      // Both sides are id-tracked (empty vacuously qualifies), so diffArrayByIds runs
      expect(result.diff['participants.id-1']).toEqual({ before: null, after: { id: 'id-1', name: 'Alice' } })
    })
  })
})

// ---------- normalizeSnapshot ----------

describe('normalizeSnapshot', () => {
  const fm = (entries: [string, 'rel-single' | 'rel-many' | 'join'][]) =>
    new Map(entries) as Map<string, 'rel-single' | 'rel-many' | 'join'>

  it('normalizes a top-level rel-single populated object to its ID', () => {
    const result = normalizeSnapshot(
      { title: 'Post', author: { id: 'id-a', name: 'Alice' } },
      fm([['author', 'rel-single']]),
    )
    expect(result.author).toBe('id-a')
    expect(result.title).toBe('Post')
  })

  it('normalizes a top-level rel-many populated array to IDs', () => {
    const result = normalizeSnapshot(
      { tags: [{ id: 'id-1', label: 'A' }, { id: 'id-2', label: 'B' }] },
      fm([['tags', 'rel-many']]),
    )
    expect(result.tags).toEqual(['id-1', 'id-2'])
  })

  it('passes through already-raw IDs unchanged', () => {
    const result = normalizeSnapshot(
      { author: 'id-a', tags: ['id-1', 'id-2'] },
      fm([['author', 'rel-single'], ['tags', 'rel-many']]),
    )
    expect(result.author).toBe('id-a')
    expect(result.tags).toEqual(['id-1', 'id-2'])
  })

  it('skips join fields entirely', () => {
    const doc = { title: 'Post', related: { docs: [{ id: 'x' }], hasNextPage: false } }
    const result = normalizeSnapshot(doc, fm([['related', 'join']]))
    // join fields are not touched — still present in snapshot
    expect(result.related).toEqual(doc.related)
  })

  it('normalizes rel-single inside a named group', () => {
    const result = normalizeSnapshot(
      { meta: { owner: { id: 'id-a', name: 'Alice' }, score: 5 } },
      fm([['meta.owner', 'rel-single']]),
    )
    expect((result.meta as Record<string, unknown>).owner).toBe('id-a')
    expect((result.meta as Record<string, unknown>).score).toBe(5)
  })

  it('normalizes rel-single inside array items (wildcard)', () => {
    const result = normalizeSnapshot(
      {
        steps: [
          { id: 's1', title: 'Step 1', assignee: { id: 'id-a', name: 'Alice' } },
          { id: 's2', title: 'Step 2', assignee: { id: 'id-b', name: 'Bob' } },
        ],
      },
      fm([['steps.*.assignee', 'rel-single']]),
    )
    const steps = result.steps as Record<string, unknown>[]
    expect(steps[0]!.assignee).toBe('id-a')
    expect(steps[1]!.assignee).toBe('id-b')
    expect(steps[0]!.title).toBe('Step 1')
  })

  it('normalizes rel-many inside array items (wildcard)', () => {
    const result = normalizeSnapshot(
      {
        steps: [
          { id: 's1', reviewers: [{ id: 'id-1', name: 'Alice' }, { id: 'id-2', name: 'Bob' }] },
        ],
      },
      fm([['steps.*.reviewers', 'rel-many']]),
    )
    const steps = result.steps as Record<string, unknown>[]
    expect(steps[0]!.reviewers).toEqual(['id-1', 'id-2'])
  })

  it('normalizes rel-single two arrays deep', () => {
    const result = normalizeSnapshot(
      {
        sections: [
          { id: 'sec1', blocks: [{ id: 'b1', author: { id: 'id-a', name: 'Alice' } }] },
        ],
      },
      fm([['sections.*.blocks.*.author', 'rel-single']]),
    )
    const sections = result.sections as Record<string, unknown>[]
    const blocks = sections[0]!.blocks as Record<string, unknown>[]
    expect(blocks[0]!.author).toBe('id-a')
  })

  it('normalizes a polymorphic rel-single populated value to { relationTo, value: id }', () => {
    const result = normalizeSnapshot(
      {
        last_updated_by: {
          relationTo: 'adminUsers',
          value: { id: '69c2b49ea54d6f96ba7beafd', email: 'roman@example.com', roles: ['admin'], sessions: [] },
        },
      },
      fm([['last_updated_by', 'rel-single']]),
    )
    expect(result.last_updated_by).toEqual({ relationTo: 'adminUsers', value: '69c2b49ea54d6f96ba7beafd' })
  })

  it('leaves a polymorphic rel-single raw ID unchanged', () => {
    const result = normalizeSnapshot(
      { last_updated_by: { relationTo: 'adminUsers', value: 'id-a' } },
      fm([['last_updated_by', 'rel-single']]),
    )
    expect(result.last_updated_by).toEqual({ relationTo: 'adminUsers', value: 'id-a' })
  })

  it('normalizes a polymorphic rel-many populated array to [{ relationTo, value: id }]', () => {
    const result = normalizeSnapshot(
      {
        participants: [
          { relationTo: 'users', value: { id: 'id-1', name: 'Alice' } },
          { relationTo: 'adminUsers', value: { id: 'id-2', email: 'b@b.com' } },
        ],
      },
      fm([['participants', 'rel-many']]),
    )
    expect(result.participants).toEqual([
      { relationTo: 'users', value: 'id-1' },
      { relationTo: 'adminUsers', value: 'id-2' },
    ])
  })

  it('does not mutate the original document', () => {
    const doc = { author: { id: 'id-a', name: 'Alice' } }
    normalizeSnapshot(doc, fm([['author', 'rel-single']]))
    expect(doc.author).toEqual({ id: 'id-a', name: 'Alice' })
  })

  it('handles missing path gracefully (field absent in doc)', () => {
    const result = normalizeSnapshot({ title: 'Post' }, fm([['author', 'rel-single']]))
    expect(result).toEqual({ title: 'Post' })
  })

  it('handles multiple relationship fields at different levels', () => {
    const result = normalizeSnapshot(
      {
        author: { id: 'id-a', name: 'Alice' },
        tags: [{ id: 'id-1', label: 'X' }],
        meta: { owner: { id: 'id-b', name: 'Bob' } },
      },
      fm([
        ['author', 'rel-single'],
        ['tags', 'rel-many'],
        ['meta.owner', 'rel-single'],
      ]),
    )
    expect(result.author).toBe('id-a')
    expect(result.tags).toEqual(['id-1'])
    expect((result.meta as Record<string, unknown>).owner).toBe('id-b')
  })
})
