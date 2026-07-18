import type { Where } from 'payload'
import { describe, expect, it } from 'vitest'
import { computeBidx } from './crypto/bidx'
import { resolveKeys } from './crypto/keys'
import { encryptedField } from './encryptedField'
import { rewriteWhereForMarkers } from './queryRewrite'
import { queryableOnly, scanEncryptedFields } from './scan'

const SECRET = 'test-secret-not-for-prod'
const ring = await resolveKeys(undefined, SECRET)
const ringFor = async () => ring

const fields = [
	...encryptedField({ name: 'contact', type: 'email' }, { queryable: true }),
	...encryptedField({ name: 'ssn', type: 'text' }),
]
const markers = queryableOnly(scanEncryptedFields(fields))

const bidx = (value: string, mode: 'email' | 'standard' = 'email') =>
	computeBidx(value, ring.indexKey, mode)

describe('rewriteWhereForMarkers', () => {
	it('rewrites equals to the bidx sibling with normalization', async () => {
		const where: Where = { contact: { equals: ' User@Example.com ' } }
		expect(await rewriteWhereForMarkers(where, markers, ringFor)).toEqual({
			contact_bidx: { equals: bidx('user@example.com') },
		})
	})

	it('rewrites in arrays element-wise', async () => {
		const where: Where = { contact: { in: ['a@x.com', 'b@x.com'] } }
		expect(await rewriteWhereForMarkers(where, markers, ringFor)).toEqual({
			contact_bidx: { in: [bidx('a@x.com'), bidx('b@x.com')] },
		})
	})

	it('passes equals null through (null bidx marks null values)', async () => {
		const where: Where = { contact: { equals: null } }
		expect(await rewriteWhereForMarkers(where, markers, ringFor)).toEqual({
			contact_bidx: { equals: null },
		})
	})

	it('recurses and/or and leaves other fields and operators untouched', async () => {
		const where: Where = {
			and: [
				{ contact: { equals: 'a@x.com' } },
				{ or: [{ title: { like: 'x' } }, { contact: { in: ['b@x.com'] } }] },
			],
			ssn: { equals: 'plaintext-query' },
		}
		expect(await rewriteWhereForMarkers(where, markers, ringFor)).toEqual({
			and: [
				{ contact_bidx: { equals: bidx('a@x.com') } },
				{ or: [{ title: { like: 'x' } }, { contact_bidx: { in: [bidx('b@x.com')] } }] },
			],
			ssn: { equals: 'plaintext-query' },
		})
	})

	it('keeps non-rewritable operators on the original path', async () => {
		const where: Where = { contact: { equals: 'a@x.com', like: 'partial' } }
		expect(await rewriteWhereForMarkers(where, markers, ringFor)).toEqual({
			contact: { like: 'partial' },
			contact_bidx: { equals: bidx('a@x.com') },
		})
	})
})
