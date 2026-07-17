import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { captureConsent } from './captureConsent'
import type { ConsentSourceEntry } from './types'

const NOW = '2024-05-05T10:00:00.000Z'

type VersionsOption = boolean | { drafts: boolean } | undefined

const makePayload = (
	collections: Record<string, VersionsOption>,
	findVersions = vi.fn().mockResolvedValue({ docs: [{ id: 'v-1' }] })
) =>
	({
		findVersions,
		collections: Object.fromEntries(
			Object.entries(collections).map(([slug, versions]) => [slug, { config: { slug, versions } }])
		),
	}) as unknown as Payload

const field = (source?: string): FormFieldInstance =>
	({ blockType: 'consent', name: 'terms', ...(source ? { source } : {}) }) as FormFieldInstance

const privacy: ConsentSourceEntry = {
	key: 'privacy',
	label: 'Privacy',
	page: { relationTo: 'pages', id: 'page-1' },
}
const entries: ConsentSourceEntry[] = [
	privacy,
	{ key: 'notice', label: 'Notice', page: { relationTo: 'notices', id: 7 } },
	{ key: 'marketing', label: 'Marketing' },
]

describe('captureConsent', () => {
	it('records the source key, the page reference, and the published version id when drafts are on', async () => {
		const findVersions = vi.fn().mockResolvedValue({ docs: [{ id: 'v-9' }] })
		const proof = await captureConsent({
			field: field('privacy'),
			agreed: true,
			entries,
			payload: makePayload({ pages: { drafts: true } }, findVersions),
			now: NOW,
		})
		expect(proof).toEqual({
			agreed: true,
			source: 'privacy',
			page: { relationTo: 'pages', id: 'page-1' },
			versionRef: 'v-9',
			at: NOW,
		})
	})

	it('records no versionRef for a versioned collection with drafts off, rather than inventing one', async () => {
		const findVersions = vi.fn()
		const proof = await captureConsent({
			field: field('notice'),
			agreed: true,
			entries,
			payload: makePayload({ notices: { drafts: false } }, findVersions),
			now: NOW,
		})
		expect(proof).toEqual({
			agreed: true,
			source: 'notice',
			page: { relationTo: 'notices', id: 7 },
			at: NOW,
		})
		// A published-version lookup on a draftless collection matches nothing (`_status` only exists
		// under drafts), so asking at all would be a slow way to learn null.
		expect(findVersions).not.toHaveBeenCalled()
	})

	it('records no versionRef when the collection has no versions at all', async () => {
		const proof = await captureConsent({
			field: field('notice'),
			agreed: true,
			entries,
			payload: makePayload({ notices: undefined }),
			now: NOW,
		})
		expect(proof.versionRef).toBeUndefined()
		expect(proof.page).toEqual({ relationTo: 'notices', id: 7 })
	})

	it('records no versionRef when drafts are on but nothing is published yet', async () => {
		const proof = await captureConsent({
			field: field('privacy'),
			agreed: true,
			entries,
			payload: makePayload({ pages: { drafts: true } }, vi.fn().mockResolvedValue({ docs: [] })),
			now: NOW,
		})
		expect(proof.versionRef).toBeUndefined()
		expect(proof.page).toEqual({ relationTo: 'pages', id: 'page-1' })
	})

	it('threads req into the version lookup', async () => {
		const findVersions = vi.fn().mockResolvedValue({ docs: [{ id: 'v-2' }] })
		const req = { transactionID: 'tx-1' } as never
		await captureConsent({
			field: field('privacy'),
			agreed: true,
			entries,
			payload: makePayload({ pages: { drafts: true } }, findVersions),
			req,
			now: NOW,
		})
		expect(findVersions).toHaveBeenCalledWith(expect.objectContaining({ req }))
	})

	it('records the source alone for an entry with no page', async () => {
		const proof = await captureConsent({
			field: field('marketing'),
			agreed: false,
			entries,
			payload: makePayload({ pages: { drafts: true } }),
			now: NOW,
		})
		expect(proof).toEqual({ agreed: false, source: 'marketing', at: NOW })
	})

	it('records a refusal rather than dropping the proof', async () => {
		const proof = await captureConsent({
			field: field('privacy'),
			agreed: false,
			entries,
			payload: makePayload({ pages: { drafts: true } }),
			now: NOW,
		})
		expect(proof.agreed).toBe(false)
		expect(proof.source).toBe('privacy')
	})

	it('records an empty source when the field references none', async () => {
		const proof = await captureConsent({
			field: field(),
			agreed: true,
			entries,
			payload: makePayload({ pages: { drafts: true } }),
			now: NOW,
		})
		expect(proof).toEqual({ agreed: true, source: '', at: NOW })
	})

	it('records the key alone when the host no longer carries that source', async () => {
		const proof = await captureConsent({
			field: field('deleted'),
			agreed: true,
			entries,
			payload: makePayload({ pages: { drafts: true } }),
			now: NOW,
		})
		expect(proof).toEqual({ agreed: true, source: 'deleted', at: NOW })
	})

	it('never stores the statement text, so a policy edit cannot rewrite past proofs', async () => {
		const proof = await captureConsent({
			field: field('privacy'),
			agreed: true,
			entries: [{ ...privacy, statement: { root: { children: [] } } }],
			payload: makePayload({ pages: { drafts: true } }),
			now: NOW,
		})
		expect(proof).not.toHaveProperty('statement')
	})

	it('records no versionRef when the page names a collection the config does not have', async () => {
		const proof = await captureConsent({
			field: field('privacy'),
			agreed: true,
			entries,
			payload: makePayload({ other: { drafts: true } }),
			now: NOW,
		})
		expect(proof.versionRef).toBeUndefined()
		expect(proof.page).toEqual({ relationTo: 'pages', id: 'page-1' })
	})
})
