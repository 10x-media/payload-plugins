import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { type ConsentSnapshotMode, captureConsent } from './captureConsent'
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
	id: 'privacy',
	name: 'Privacy',
	page: { relationTo: 'pages', id: 'page-1' },
}
const entries: ConsentSourceEntry[] = [
	privacy,
	{ id: 'notice', name: 'Notice', page: { relationTo: 'notices', id: 7 } },
	{ id: 'marketing', name: 'Marketing' },
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
			name: 'Privacy',
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
			name: 'Notice',
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
		expect(proof).toEqual({ agreed: false, source: 'marketing', name: 'Marketing', at: NOW })
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

	it('records the id alone when the host no longer carries that source', async () => {
		const proof = await captureConsent({
			field: field('deleted'),
			agreed: true,
			entries,
			payload: makePayload({ pages: { drafts: true } }),
			now: NOW,
		})
		expect(proof).toEqual({ agreed: true, source: 'deleted', at: NOW })
	})

	describe('wording snapshot', () => {
		const withStatement: ConsentSourceEntry = {
			...privacy,
			statement: { root: { children: [{ children: [{ text: 'I agree' }] }] } },
		}
		const capture = (snapshot?: ConsentSnapshotMode, agreed = true) =>
			captureConsent({
				field: field('privacy'),
				agreed,
				entries: [withStatement],
				payload: makePayload({ pages: { drafts: false } }),
				now: NOW,
				snapshot,
			})

		it('snapshots the hash, text, and source name by default (both)', async () => {
			const proof = await capture()
			expect(proof.name).toBe('Privacy')
			expect(proof.statementText).toBe('I agree')
			expect(proof.statementHash).toMatch(/^[a-f0-9]{64}$/)
		})

		it('captures the snapshot even on a refusal', async () => {
			const proof = await capture('both', false)
			expect(proof.agreed).toBe(false)
			expect(proof.statementHash).toBeDefined()
			expect(proof.statementText).toBe('I agree')
		})

		it('snapshots the notice wording, and records the display, for a notice field', async () => {
			const noticeEntry: ConsentSourceEntry = {
				...withStatement,
				noticeStatement: {
					root: { children: [{ children: [{ text: 'By subscribing you agree' }] }] },
				},
			}
			const noticeField = {
				...field('privacy'),
				display: 'notice',
			} as unknown as FormFieldInstance
			const proof = await captureConsent({
				field: noticeField,
				agreed: true,
				entries: [noticeEntry],
				payload: makePayload({ pages: { drafts: false } }),
				now: NOW,
			})
			expect(proof.statementText).toBe('By subscribing you agree')
			expect(proof.display).toBe('notice')
		})

		it('snapshots the checkbox statement for a notice field whose source has no notice wording', async () => {
			const noticeField = {
				...field('privacy'),
				display: 'notice',
			} as unknown as FormFieldInstance
			const proof = await captureConsent({
				field: noticeField,
				agreed: true,
				entries: [withStatement],
				payload: makePayload({ pages: { drafts: false } }),
				now: NOW,
			})
			expect(proof.statementText).toBe('I agree')
			expect(proof.display).toBe('notice')
		})

		it('records no display member for a checkbox field, keeping the existing proof shape', async () => {
			const proof = await capture()
			expect('display' in proof).toBe(false)
		})

		it('hash mode omits the text; text mode omits the hash; false omits both', async () => {
			const hash = await capture('hash')
			expect(hash.statementHash).toBeDefined()
			expect(hash.statementText).toBeUndefined()
			const text = await capture('text')
			expect(text.statementText).toBe('I agree')
			expect(text.statementHash).toBeUndefined()
			const off = await capture(false)
			expect(off.statementHash).toBeUndefined()
			expect(off.statementText).toBeUndefined()
			expect(off.name).toBeUndefined()
		})

		it('stores the wording under statementText/Hash, never a raw `statement` key', async () => {
			const proof = await capture()
			expect(proof).not.toHaveProperty('statement')
		})
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
