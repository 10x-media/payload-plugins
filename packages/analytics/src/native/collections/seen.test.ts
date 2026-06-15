import { describe, expect, it } from 'vitest'
import { SEEN_SLUG, seenCollection } from './seen'

describe('seen collection', () => {
	it('uses the analytics-seen slug and is hidden from the admin', () => {
		const c = seenCollection()
		expect(c.slug).toBe(SEEN_SLUG)
		expect(c.admin?.hidden).toBe(true)
	})

	it('enforces a unique compound index on bucket+kind+value', () => {
		const c = seenCollection()
		expect(c.indexes).toEqual([{ fields: ['bucket', 'kind', 'value'], unique: true }])
	})

	it('marks every dedup-key field required so Postgres makes the columns NOT NULL', () => {
		const c = seenCollection()
		const byName = Object.fromEntries(c.fields.flatMap((f) => ('name' in f ? [[f.name, f]] : [])))
		for (const name of ['bucket', 'kind', 'value', 'period']) {
			expect((byName[name] as { required?: boolean }).required).toBe(true)
		}
	})
})
