import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { isLoggedIn } from '../../plugin/access'
import { buildPollVotesCollection, POLL_VOTES_SLUG, RESPONDENTS_VALUE } from './votesCollection'

const fieldNamed = (fields: Field[], name: string) =>
	fields.find((field) => 'name' in field && field.name === name)

describe('buildPollVotesCollection', () => {
	it('uses the reserved slug', () => {
		const collection = buildPollVotesCollection({})
		expect(collection.slug).toBe(POLL_VOTES_SLUG)
		expect(POLL_VOTES_SLUG).toBe('form-poll-votes')
	})

	it('is hidden from the admin nav', () => {
		const collection = buildPollVotesCollection({})
		expect(collection.admin?.hidden).toBe(true)
	})

	it('defines form, field, value, and count fields', () => {
		const collection = buildPollVotesCollection({})
		const form = fieldNamed(collection.fields, 'form')
		expect(form?.type).toBe('text')
		expect((form as Extract<Field, { type: 'text' }>)?.required).toBe(true)
		expect((form as Extract<Field, { type: 'text' }>)?.index).toBe(true)

		const field = fieldNamed(collection.fields, 'field')
		expect(field?.type).toBe('text')
		expect((field as Extract<Field, { type: 'text' }>)?.required).toBe(true)

		const value = fieldNamed(collection.fields, 'value')
		expect(value?.type).toBe('text')

		const count = fieldNamed(collection.fields, 'count')
		expect(count?.type).toBe('number')
		expect((count as Extract<Field, { type: 'number' }>)?.required).toBe(true)
		expect((count as Extract<Field, { type: 'number' }>)?.defaultValue).toBe(0)
	})

	it('has a unique compound index over form, field, value', () => {
		const collection = buildPollVotesCollection({})
		expect(collection.indexes).toEqual([{ fields: ['form', 'field', 'value'], unique: true }])
	})

	it('gates reads behind isLoggedIn', () => {
		const collection = buildPollVotesCollection({})
		expect(collection.access?.read).toBe(isLoggedIn)
	})

	it('composes overrides over the defaults', () => {
		const collection = buildPollVotesCollection({
			overrides: {
				labels: { singular: 'Vote', plural: 'Votes' },
				admin: { hidden: false },
				access: { read: () => true },
			},
		})
		expect(collection.labels).toMatchObject({ singular: 'Vote', plural: 'Votes' })
		expect(collection.admin?.hidden).toBe(false)
		expect(collection.access?.read).not.toBe(isLoggedIn)
	})

	it('exports the reserved respondents tally value', () => {
		expect(RESPONDENTS_VALUE).toBe('')
	})
})
