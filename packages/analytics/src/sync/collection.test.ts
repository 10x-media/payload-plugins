import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { METRIC_FIELDS, syncCollection } from './collection'

const named = (fields: Field[]) =>
	Object.fromEntries(
		fields.filter((f): f is Extract<Field, { name: string }> => 'name' in f).map((f) => [f.name, f])
	)

describe('syncCollection', () => {
	it('uses the given slug and a unique (source, date) index', () => {
		const c = syncCollection('analytics-daily')
		expect(c.slug).toBe('analytics-daily')
		expect(c.indexes).toEqual([{ fields: ['source', 'date'], unique: true }])
	})

	it('has required + indexed source and date, and a number field per metric', () => {
		const byName = named(syncCollection('x').fields)
		expect(byName.source).toMatchObject({ type: 'text', required: true, index: true })
		expect(byName.date).toMatchObject({ type: 'date', required: true, index: true })
		for (const metric of METRIC_FIELDS) {
			expect(byName[metric]).toMatchObject({ type: 'number' })
		}
		expect(byName.syncedAt).toMatchObject({ type: 'date' })
	})

	it('locks create/update/delete and gates read on an authenticated user', () => {
		const access = syncCollection('x').access
		expect(access?.create?.({ req: {} } as never)).toBe(false)
		expect(access?.update?.({ req: {} } as never)).toBe(false)
		expect(access?.delete?.({ req: {} } as never)).toBe(false)
		expect(access?.read?.({ req: {} } as never)).toBe(false)
		expect(access?.read?.({ req: { user: { id: '1' } } } as never)).toBe(true)
	})
})
