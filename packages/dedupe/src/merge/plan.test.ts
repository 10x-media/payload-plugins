import type { FlattenedField } from 'payload'
import { describe, expect, it } from 'vitest'

import type { MergeFieldSpec } from '../schema/types'
import { pickedItems, planMerge, takenItems, withChoice } from './plan'

const spec = (
	overrides: Partial<MergeFieldSpec> & Pick<MergeFieldSpec, 'path'>
): MergeFieldSpec => ({
	label: undefined,
	type: 'text',
	policy: 'nonEmpty',
	localized: false,
	list: false,
	hidden: false,
	unique: false,
	required: false,
	component: false,
	...overrides,
})

const decision = (plan: ReturnType<typeof planMerge>, key: string) => {
	const found = plan.decisions.find((entry) => entry.key === key)
	if (!found) throw new Error(`no decision ${key}`)
	return found
}

/** Documents of a group: `a` survives; the later letters were edited later. */
const a = (data: Record<string, unknown>) => ({
	id: 'a',
	updatedAt: '2026-01-01T00:00:00Z',
	...data,
})
const b = (data: Record<string, unknown>) => ({
	id: 'b',
	updatedAt: '2026-02-01T00:00:00Z',
	...data,
})
const c = (data: Record<string, unknown>) => ({
	id: 'c',
	updatedAt: '2026-03-01T00:00:00Z',
	...data,
})

describe('planMerge in a language Payload checks', () => {
	const fields = [
		spec({ path: 'title', localized: true }),
		spec({ path: 'note', localized: true, required: true }),
	]
	const schema = {
		fields: [
			{ name: 'title', type: 'text', localized: true },
			{ name: 'note', type: 'text', localized: true, required: true },
		] as FlattenedField[],
	}
	const run = (validates: boolean, publishesDrafts = false) =>
		planMerge({
			survivor: a({ title: { en: 'A' }, note: { en: 'n' } }),
			absorbed: [b({ title: { en: 'B', de: 'B de' }, note: { en: 'n' } })],
			fields,
			locales: ['en', 'de'],
			writeLocale: 'en',
			collection: 'docs',
			schema,
			validates,
			publishesDrafts,
		})

	it('names a required value no document holds in a language it writes', () => {
		expect(run(true).missing).toEqual([{ path: 'note', locale: 'de', reason: 'none' }])
	})

	it('names nothing where Payload does not check the write, as for a draft', () => {
		expect(run(false).missing).toEqual([])
	})

	it('drafts a language whose required value the survivor lacked before, where drafts publish', () => {
		const plan = run(true, true)
		expect(plan.missing).toEqual([])
		expect(plan.drafted).toEqual(['de'])
		expect(plan.readyToApply).toBe(true)
	})

	it('names a required value of the write locale, which the publish checks, drafts or not', () => {
		const plan = planMerge({
			survivor: a({ title: { de: 'A de' }, note: { de: 'n' }, flag: false }),
			absorbed: [b({ title: { de: 'B de' }, note: { de: 'n' }, flag: true })],
			fields: [...fields, spec({ path: 'flag', type: 'checkbox' })],
			locales: ['en', 'de'],
			writeLocale: 'en',
			collection: 'docs',
			schema: {
				fields: [...schema.fields, { name: 'flag', type: 'checkbox' }] as FlattenedField[],
			},
			choices: { flag: { doc: 'b' } },
			publishesDrafts: true,
		})
		expect(plan.missing).toEqual([{ path: 'note', locale: 'en', reason: 'none' }])
		expect(plan.drafted).toEqual([])
	})
})

describe('planMerge', () => {
	it('will not empty a required field, whichever document is picked', () => {
		const plan = planMerge({
			survivor: a({ title: 'Kept' }),
			absorbed: [b({})],
			fields: [spec({ path: 'title', required: true })],
			locales: null,
			collection: 'people',
			choices: { title: { doc: 'b' } },
		})
		expect(decision(plan, 'title')).toMatchObject({ proposed: 'Kept', changed: false })
		expect(plan.base).toEqual({})
	})

	it('shows the items a required list keeps when a choice would leave it empty', () => {
		const plan = planMerge({
			survivor: a({ tags: ['x'] }),
			absorbed: [b({})],
			fields: [spec({ path: 'tags', list: true, required: true })],
			locales: null,
			collection: 'people',
		})
		const tags = decision(plan, 'tags')
		const kept = [{ doc: 'a', index: 0 }]
		expect(pickedItems(tags, { doc: 'b' }, 'a')).toEqual(kept)
		expect(pickedItems(tags, { items: [] }, 'a')).toEqual(kept)
		expect(pickedItems(tags, { doc: 'a' }, 'a')).toEqual(kept)
		expect(pickedItems(tags, { items: [{ doc: 'a', index: 9 }] }, 'a')).toEqual(kept)
	})

	it('will not empty a required list by unchecking every item', () => {
		const plan = planMerge({
			survivor: a({ tags: ['x'] }),
			absorbed: [b({ tags: ['y'] })],
			fields: [spec({ path: 'tags', list: true, required: true })],
			locales: null,
			collection: 'people',
			choices: { tags: { items: [] } },
		})
		expect(decision(plan, 'tags')).toMatchObject({ proposed: ['x'], changed: false })
	})

	it('keeps the survivor value when every document agrees and reports nothing changed', () => {
		const plan = planMerge({
			survivor: a({ email: 'a@x.io' }),
			absorbed: [b({ email: 'a@x.io' })],
			fields: [spec({ path: 'email' })],
			locales: null,
			collection: 'people',
		})
		const email = decision(plan, 'email')
		expect(email).toMatchObject({ source: 'same', changed: false, conflict: false, auto: false })
		expect(email.values).toEqual([
			{ doc: 'a', value: 'a@x.io' },
			{ doc: 'b', value: 'a@x.io' },
		])
		expect(plan.base).toEqual({})
	})

	it('fills an empty survivor field from the other document', () => {
		const plan = planMerge({
			survivor: a({ phone: '' }),
			absorbed: [b({ phone: '123' })],
			fields: [spec({ path: 'phone' })],
			locales: null,
			collection: 'people',
		})
		expect(decision(plan, 'phone')).toMatchObject({
			source: 'b',
			auto: true,
			proposed: '123',
			changed: true,
			conflict: false,
		})
		expect(plan.base).toEqual({ phone: '123' })
	})

	it('fills an empty survivor field from the most recently edited document that has it', () => {
		const plan = planMerge({
			survivor: a({ phone: '' }),
			// Listed oldest first, so a pick by order would take b.
			absorbed: [b({ phone: '2' }), c({ phone: '3' })],
			fields: [spec({ path: 'phone' })],
			locales: null,
			collection: 'people',
		})
		expect(decision(plan, 'phone')).toMatchObject({
			source: 'c',
			auto: true,
			proposed: '3',
			conflict: true,
		})
	})

	it('proposes the survivor on a conflict and lets a choice of any document override it', () => {
		const fields = [spec({ path: 'phone' })]
		const docs = { survivor: a({ phone: '1' }), absorbed: [b({ phone: '2' }), c({ phone: '3' })] }
		const conflict = planMerge({ ...docs, fields, locales: null, collection: 'people' })
		expect(decision(conflict, 'phone')).toMatchObject({
			conflict: true,
			requiresChoice: false,
			proposed: '1',
			source: 'a',
			auto: false,
			changed: false,
		})
		expect(conflict.readyToApply).toBe(true)

		const chosen = planMerge({
			...docs,
			fields,
			locales: null,
			collection: 'people',
			choices: { phone: { doc: 'c' } },
		})
		expect(decision(chosen, 'phone')).toMatchObject({ proposed: '3', source: 'c', changed: true })
	})

	it('ignores a choice of a document outside the group', () => {
		const plan = planMerge({
			survivor: a({ phone: '1' }),
			absorbed: [b({ phone: '2' })],
			fields: [spec({ path: 'phone' })],
			locales: null,
			collection: 'people',
			choices: { phone: { doc: 'z' } },
		})
		expect(decision(plan, 'phone')).toMatchObject({ proposed: '1', source: 'a' })
	})

	it('blocks on a manual conflict until a choice is made, also when only absorbed documents differ', () => {
		const fields = [spec({ path: 'name', policy: 'manual' })]
		const blocked = planMerge({
			survivor: a({ name: 'A' }),
			absorbed: [b({ name: 'B' })],
			fields,
			locales: null,
			collection: 'people',
		})
		expect(decision(blocked, 'name').requiresChoice).toBe(true)
		expect(blocked.readyToApply).toBe(false)

		const answered = planMerge({
			survivor: a({ name: 'A' }),
			absorbed: [b({ name: 'B' })],
			fields,
			locales: null,
			collection: 'people',
			choices: { name: { doc: 'a' } },
		})
		expect(answered.readyToApply).toBe(true)

		const emptySurvivor = planMerge({
			survivor: a({ name: '' }),
			absorbed: [b({ name: 'B' }), c({ name: 'C' })],
			fields,
			locales: null,
			collection: 'people',
		})
		expect(decision(emptySurvivor, 'name').requiresChoice).toBe(true)
	})

	it('unions lists of every document, survivor first, and never treats them as conflicts', () => {
		const plan = planMerge({
			survivor: a({ tags: ['a'] }),
			absorbed: [b({ tags: ['b', 'a'] }), c({ tags: ['c', 'b'] })],
			fields: [spec({ path: 'tags', policy: 'union', list: true })],
			locales: null,
			collection: 'people',
		})
		expect(decision(plan, 'tags')).toMatchObject({
			source: 'union',
			proposed: ['a', 'b', 'c'],
			conflict: false,
			changed: true,
		})
	})

	it('unions rows of every document without comparing them, survivor first', () => {
		const plan = planMerge({
			survivor: a({ rows: [{ id: 'r1', url: 'https://google.com' }] }),
			absorbed: [
				b({ rows: [{ id: 'r2', url: 'https://google.com' }] }),
				c({ rows: [{ id: 'r3', url: 'https://www.google.com' }] }),
			],
			fields: [spec({ path: 'rows', type: 'array', policy: 'union', list: true })],
			locales: null,
			collection: 'people',
		})
		const rows = decision(plan, 'rows')
		expect(rows.source).toBe('union')
		expect((rows.proposed as { url: string }[]).map((row) => row.url)).toEqual([
			'https://google.com',
			'https://google.com',
			'https://www.google.com',
		])
	})

	it('never shows or changes a survivor-policy field', () => {
		const plan = planMerge({
			survivor: a({ internal: 'x' }),
			absorbed: [b({ internal: 'y' })],
			fields: [spec({ path: 'internal', policy: 'survivor', hidden: true })],
			locales: null,
			collection: 'people',
		})
		expect(decision(plan, 'internal')).toMatchObject({ conflict: false, changed: false })
	})

	it('leaves a skipped field out entirely', () => {
		const plan = planMerge({
			survivor: a({ n: 1 }),
			absorbed: [b({ n: 2 })],
			fields: [spec({ path: 'n', policy: 'skip', type: 'number' })],
			locales: null,
			collection: 'people',
		})
		expect(plan.decisions).toEqual([])
	})

	it('treats false and undefined as different on a checkbox', () => {
		const plan = planMerge({
			survivor: a({ vip: undefined }),
			absorbed: [b({ vip: false })],
			fields: [spec({ path: 'vip', type: 'checkbox' })],
			locales: null,
			collection: 'people',
		})
		expect(decision(plan, 'vip')).toMatchObject({ proposed: false, source: 'b', changed: true })
	})

	it('decides localized fields per locale and splits the writes by locale', () => {
		const plan = planMerge({
			survivor: a({ name: { en: 'Ivan', de: '' }, phone: '' }),
			absorbed: [b({ name: { en: 'Ivan P.', de: 'Iwan' }, phone: '5' })],
			fields: [spec({ path: 'name', localized: true }), spec({ path: 'phone' })],
			locales: ['en', 'de'],
			collection: 'people',
			choices: { 'name@en': { doc: 'b' } },
		})
		expect(decision(plan, 'name@en')).toMatchObject({
			locale: 'en',
			proposed: 'Ivan P.',
			changed: true,
		})
		expect(decision(plan, 'name@de')).toMatchObject({ locale: 'de', proposed: 'Iwan', source: 'b' })
		expect(plan.base).toEqual({ phone: '5' })
		expect(plan.byLocale).toEqual({ en: { name: 'Ivan P.' }, de: { name: 'Iwan' } })
	})

	it('writes nested paths into the result', () => {
		const plan = planMerge({
			survivor: a({ profile: { bio: '' } }),
			absorbed: [b({ profile: { bio: 'hello' } })],
			fields: [spec({ path: 'profile.bio', type: 'textarea' })],
			locales: null,
			collection: 'people',
		})
		expect(plan.base).toEqual({ profile: { bio: 'hello' } })
	})

	it('treats a list every document holds alike as unchanged, so "only differences" hides it', () => {
		const plan = planMerge({
			survivor: a({ tags: ['vip', 'new'] }),
			absorbed: [b({ tags: ['vip', 'new'] })],
			fields: [spec({ path: 'tags', list: true, policy: 'union' })],
			locales: null,
			collection: 'people',
		})
		expect(decision(plan, 'tags')).toMatchObject({ source: 'same', changed: false })
	})
})

describe('withChoice', () => {
	it('applies a picked document or a typed value to a decision on the client', () => {
		const plan = planMerge({
			survivor: a({ phone: '1' }),
			absorbed: [b({ phone: '2' })],
			fields: [spec({ path: 'phone', policy: 'manual' })],
			locales: null,
			collection: 'people',
		})
		const phone = decision(plan, 'phone')
		expect(withChoice(phone, { doc: 'b' })).toMatchObject({
			proposed: '2',
			source: 'b',
			requiresChoice: false,
			changed: true,
		})
		expect(withChoice(phone, undefined)).toBe(phone)
	})

	it('ignores a value sent instead of a document, on every field', () => {
		const plan = planMerge({
			survivor: a({ age: 30, company: 'c1', tags: ['x'], note: 'one' }),
			absorbed: [b({ age: 31, company: 'c2', tags: ['y'], note: 'two' })],
			fields: [
				spec({ path: 'age', type: 'number' }),
				spec({ path: 'company', type: 'relationship', relationTo: 'companies' }),
				spec({ path: 'tags', list: true, policy: 'union' }),
				spec({ path: 'note', hidden: true }),
			],
			locales: null,
			collection: 'people',
		})
		for (const [key, value] of [
			['age', 42],
			['company', 'c9'],
			['tags', ['z']],
			['note', 'typed'],
		] as const) {
			const planned = decision(plan, key)
			expect(withChoice(planned, { value } as never), key).toBe(planned)
		}
		expect(withChoice(decision(plan, 'tags'), { doc: 'b' })).toMatchObject({
			proposed: ['y'],
			source: 'b',
		})
	})

	it('takes the rows the reviewer checks, in group order, a row repeated in another document as often as it is checked', () => {
		const plan = planMerge({
			survivor: a({
				rows: [
					{ id: 'r1', n: 1 },
					{ id: 'r2', n: 2 },
				],
				name: 'A',
			}),
			absorbed: [
				b({
					rows: [
						{ id: 'r3', n: 2 },
						{ id: 'r4', n: 3 },
					],
				}),
				c({ rows: [{ id: 'r5', n: 4 }] }),
			],
			fields: [spec({ path: 'rows', type: 'array', list: true }), spec({ path: 'name' })],
			locales: null,
			collection: 'people',
		})
		const rows = decision(plan, 'rows')
		expect(rows).toMatchObject({ source: 'a', proposed: [{ n: 1 }, { n: 2 }] })
		const picked = withChoice(rows, {
			items: [
				{ doc: 'c', index: 0 },
				{ doc: 'a', index: 1 },
				{ doc: 'b', index: 0 },
				{ doc: 'b', index: 1 },
			],
		})
		expect(picked.source).toBe('union')
		expect((picked.proposed as { n: number }[]).map((row) => row.n)).toEqual([2, 2, 3, 4])
		expect(withChoice(rows, { items: [{ doc: 'b', index: 1 }] })).toMatchObject({
			source: 'b',
			proposed: [{ n: 3 }],
		})
		expect(withChoice(rows, { items: [] }).proposed).toEqual([])
		expect(
			withChoice(rows, {
				items: [
					{ doc: 'z', index: 0 },
					{ doc: 'a', index: 9 },
				],
			}).proposed
		).toEqual([])
		expect(withChoice(decision(plan, 'name'), { items: [{ doc: 'b', index: 0 }] }).source).toBe('a')
	})
})

describe('pointers at the merge itself', () => {
	const pointer = (overrides: Partial<MergeFieldSpec> = {}) =>
		spec({ path: 'friend', type: 'relationship', relationTo: 'people', ...overrides })
	const plan = (fields: MergeFieldSpec[], survivor: Record<string, unknown>, more = {}) =>
		planMerge({
			survivor: a(survivor),
			absorbed: [b({}), c({})],
			fields,
			locales: null,
			collection: 'people',
			...more,
		})

	it('empties a field that may be empty, and names it', () => {
		const result = plan([pointer()], { friend: 'b' })
		expect([decision(result, 'friend').proposed, result.base.friend, result.cleared]).toEqual([
			null,
			null,
			['friend'],
		])
	})

	it("keeps a pointer elsewhere, and the merge's own one in a required field", () => {
		expect(decision(plan([pointer()], { friend: 'z' }), 'friend').proposed).toBe('z')
		const required = plan([pointer({ required: true })], { friend: 'b' })
		expect([decision(required, 'friend').proposed, required.cleared]).toEqual(['b', []])
	})

	it("drops only the merge's own documents from a list, polymorphic ones by their collection", () => {
		const many = plan([pointer({ list: true })], { friend: ['z', 'a', 'c'] })
		expect(decision(many, 'friend').proposed).toEqual(['z'])
		const poly = plan([pointer({ relationTo: ['people', 'pets'] })], {
			friend: { relationTo: 'pets', value: 'b' },
		})
		expect(decision(poly, 'friend').proposed).toEqual({ relationTo: 'pets', value: 'b' })
	})

	it('reaches pointers inside rows through the schema, per locale where a row holds locales', () => {
		const rows = spec({ path: 'circle', type: 'array', list: true })
		const fields = [
			{
				name: 'circle',
				type: 'array',
				flattenedFields: [
					{ name: 'who', type: 'relationship', relationTo: 'people' },
					{ name: 'backup', type: 'relationship', relationTo: 'people', localized: true },
				],
			},
		] as unknown as FlattenedField[]
		const value = [{ id: 'r1', who: 'b', backup: { en: 'c', de: 'z' } }]
		expect(decision(plan([rows], { circle: value }), 'circle').proposed).toEqual(value)
		const result = plan([rows], { circle: value }, { schema: { fields } })
		expect([decision(result, 'circle').proposed, result.cleared]).toEqual([
			[{ id: 'r1', who: null, backup: { en: null, de: 'z' } }],
			['circle'],
		])
	})
})

describe('takenItems', () => {
	const rows = (proposed: unknown[], values: { doc: string; value: unknown }[]) =>
		takenItems({ list: true, type: 'array', proposed, values })

	it('counts a row for the first document that has it, while the result holds it unchanged', () => {
		const row = { id: 'r1', who: 'z' }
		const taken = rows(
			[row],
			[
				{ doc: 'a', value: [row] },
				{ doc: 'b', value: [row] },
			]
		)
		expect([taken('a', row), taken('b', row)]).toEqual([true, false])
	})

	it('does not count a row the result holds changed, such as one a pointer was taken out of', () => {
		const before = { id: 'r1', who: 'b' }
		const taken = rows([{ id: 'r1', who: null }], [{ doc: 'a', value: [before] }])
		expect(taken('a', before)).toBe(false)
	})

	it('tells items of a plain list by their value', () => {
		const taken = takenItems({
			list: true,
			type: 'text',
			proposed: ['x'],
			values: [
				{ doc: 'a', value: ['y'] },
				{ doc: 'b', value: ['x'] },
			],
		})
		expect([taken('a', 'y'), taken('b', 'x')]).toEqual([false, true])
	})
})
