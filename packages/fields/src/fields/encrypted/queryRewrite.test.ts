import type { Where } from 'payload'
import { describe, expect, it } from 'vitest'
import { computeBidx } from './crypto/bidx'
import { resolveKeys } from './crypto/keys'
import { encryptedField } from './encryptedField'
import { BIDX_NO_MATCH, rewriteWhereForMarkers, withEncryptedQueryRewrite } from './queryRewrite'
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
		expect(await rewriteWhereForMarkers({ where, markers, ringFor })).toEqual({
			contact_bidx: { equals: bidx('user@example.com') },
		})
	})

	it('rewrites in arrays element-wise', async () => {
		const where: Where = { contact: { in: ['a@x.com', 'b@x.com'] } }
		expect(await rewriteWhereForMarkers({ where, markers, ringFor })).toEqual({
			contact_bidx: { in: [bidx('a@x.com'), bidx('b@x.com')] },
		})
	})

	it('passes equals null through (null bidx marks null values)', async () => {
		const where: Where = { contact: { equals: null } }
		expect(await rewriteWhereForMarkers({ where, markers, ringFor })).toEqual({
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
		expect(await rewriteWhereForMarkers({ where, markers, ringFor })).toEqual({
			and: [
				{ contact_bidx: { equals: bidx('a@x.com') } },
				{ or: [{ title: { like: 'x' } }, { contact_bidx: { in: [bidx('b@x.com')] } }] },
			],
			ssn: { equals: 'plaintext-query' },
		})
	})

	it('rewrites the full exact-match operator set to the bidx sibling', async () => {
		const where: Where = {
			and: [
				{ contact: { not_equals: 'a@x.com' } },
				{ contact: { not_in: ['b@x.com', 'c@x.com'] } },
				{ contact: { exists: true } },
			],
		}
		expect(await rewriteWhereForMarkers({ where, markers, ringFor })).toEqual({
			and: [
				{ contact_bidx: { not_equals: bidx('a@x.com') } },
				{ contact_bidx: { not_in: [bidx('b@x.com'), bidx('c@x.com')] } },
				{ contact_bidx: { exists: true } },
			],
		})
	})

	it('maps operators the blind index cannot answer to a guaranteed-empty match', async () => {
		const where: Where = { contact: { like: 'partial' } }
		expect(await rewriteWhereForMarkers({ where, markers, ringFor })).toEqual({
			contact_bidx: { equals: BIDX_NO_MATCH },
		})
	})

	it('never queries the ciphertext column when an unsupported operator joins a supported one', async () => {
		const where: Where = { contact: { equals: 'a@x.com', like: 'partial' } }
		const rewritten = await rewriteWhereForMarkers({ where, markers, ringFor })
		expect(rewritten).toEqual({ contact_bidx: { equals: BIDX_NO_MATCH } })
		expect(rewritten.contact).toBeUndefined()
	})
})

describe('withEncryptedQueryRewrite strips richText ciphertext from responses', () => {
	const collection = withEncryptedQueryRewrite({
		slug: 'notes',
		fields: [
			{ name: 'title', type: 'text' },
			...encryptedField({ name: 'body', type: 'richText' }),
		],
	})

	it('attaches an afterRead stripper even without any queryable field', () => {
		expect(collection.hooks?.afterRead).toHaveLength(1)
		// No queryable/bidx marker here, so no where-rewrite is needed.
		expect(collection.hooks?.beforeOperation ?? []).toHaveLength(0)
	})

	it('deletes the ciphertext sibling from a read document, keeping the decrypted field', () => {
		const strip = collection.hooks?.afterRead?.[0]
		if (!strip) {
			throw new Error('expected an afterRead strip hook')
		}
		const doc: Record<string, unknown> = {
			title: 'kept',
			body: { root: { children: [] } },
			body_encrypted: 'pfe1.k0.iv.ct.tag',
		}
		strip({ doc } as unknown as Parameters<typeof strip>[0])
		expect('body_encrypted' in doc).toBe(false)
		expect(doc.body).toEqual({ root: { children: [] } })
		expect(doc.title).toBe('kept')
	})
})
