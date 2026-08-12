import { describe, expect, it } from 'vitest'

import { REDACTED } from '../types'
import { anonymizeDoc } from './anonymize'

const run = (doc: Record<string, unknown>, anonymize: Parameters<typeof anonymizeDoc>[4]) =>
	anonymizeDoc(doc, 'users', '1', 'update', anonymize)

describe('anonymizeDoc', () => {
	it('leaves a document alone when nothing is redacted', () => {
		const doc = { email: 'a@b.c', meta: { ip: '1.2.3.4' } }
		expect(run(doc, ({ value }) => value)).toEqual(doc)
	})

	it('redacts by full dot path', () => {
		const result = run({ email: 'a@b.c', name: 'Ann' }, ({ path, value, redacted }) =>
			path === 'email' ? redacted : value
		)
		expect(result).toEqual({ email: REDACTED, name: 'Ann' })
	})

	it('reaches nested objects with the path built up', () => {
		const seen: string[] = []
		run({ meta: { ip: '1.2.3.4', ua: 'curl' } }, ({ path, value }) => {
			seen.push(path)
			return value
		})
		expect(seen).toEqual(['meta', 'meta.ip', 'meta.ua'])
	})

	it('indexes array entries into the path', () => {
		const result = run({ tags: ['a', 'b'] }, ({ path, value, redacted }) =>
			path === 'tags.1' ? redacted : value
		)
		expect(result).toEqual({ tags: ['a', REDACTED] })
	})

	it('stops descending once a branch is redacted', () => {
		const seen: string[] = []
		const result = run({ card: { number: '4111', cvv: '123' } }, ({ path, value, redacted }) => {
			seen.push(path)
			return path === 'card' ? redacted : value
		})
		expect(result).toEqual({ card: REDACTED })
		expect(seen).toEqual(['card'])
	})

	it('replaces a value with whatever the function returns', () => {
		const result = run({ email: 'ann@example.com' }, ({ path, value }) =>
			path === 'email' ? 'a***@example.com' : value
		)
		expect(result).toEqual({ email: 'a***@example.com' })
	})

	it('does not descend into a replaced object', () => {
		const seen: string[] = []
		const result = run({ meta: { ip: '1.2.3.4' } }, ({ path, value }) => {
			seen.push(path)
			return path === 'meta' ? { ip: 'hidden' } : value
		})
		expect(result).toEqual({ meta: { ip: 'hidden' } })
		expect(seen).toEqual(['meta'])
	})

	it('passes the collection, id and operation to every call', () => {
		const calls: string[] = []
		anonymizeDoc(
			{ a: 1 },
			'posts',
			'42',
			'delete',
			({ collection, documentId, operation, value }) => {
				calls.push(`${collection}/${documentId}/${operation}`)
				return value
			}
		)
		expect(calls).toEqual(['posts/42/delete'])
	})

	it('treats null as a plain value', () => {
		expect(run({ deletedAt: null }, ({ value }) => value)).toEqual({ deletedAt: null })
	})
})
