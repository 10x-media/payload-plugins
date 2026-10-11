import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import {
	collectionSlugsOf,
	DEFAULT_COLLECTION_SLUGS,
	DEFAULT_VOTED_COOKIE_PREFIX,
	resolveCollectionSlugs,
	resolveVotedCookiePrefix,
	stashCollectionSlugs,
	votedCookiePrefixOf,
} from './collectionSlugs'

const payloadWith = (custom: Record<string, unknown> | undefined) =>
	({ config: { custom } }) as unknown as Payload

describe('resolveCollectionSlugs', () => {
	it('keeps every default slug when no override names one', () => {
		expect(resolveCollectionSlugs({})).toEqual({
			forms: 'forms',
			formSubmissions: 'form-submissions',
			pollVotes: 'form-poll-votes',
		})
	})

	it('takes each slug from its collection override', () => {
		expect(
			resolveCollectionSlugs({
				overrides: { forms: { slug: 'surveys' }, formSubmissions: { slug: 'responses' } },
				poll: { votes: { overrides: { slug: 'survey-tallies' } } },
			})
		).toEqual({ forms: 'surveys', formSubmissions: 'responses', pollVotes: 'survey-tallies' })
	})

	it('treats a blank slug as unset rather than registering an unnamed collection', () => {
		expect(resolveCollectionSlugs({ overrides: { forms: { slug: '  ' } } }).forms).toBe('forms')
	})

	it('refuses two plugin collections sharing one slug, naming both options', () => {
		expect(() =>
			resolveCollectionSlugs({ overrides: { formSubmissions: { slug: 'forms' } } })
		).toThrow(/overrides\.forms.*overrides\.formSubmissions/)
	})

	it('ignores the tally override when the tally store is disabled', () => {
		expect(
			resolveCollectionSlugs({
				overrides: { forms: { slug: 'form-poll-votes' } },
				poll: { votes: false },
			}).forms
		).toBe('form-poll-votes')
	})
})

describe('collectionSlugsOf', () => {
	it('reads back what the plugin stashed on the config', () => {
		const slugs = { forms: 'surveys', formSubmissions: 'responses', pollVotes: 'tallies' }
		expect(collectionSlugsOf(payloadWith(stashCollectionSlugs(undefined, slugs)))).toEqual(slugs)
	})

	it('falls back to the defaults on a config the plugin never booted', () => {
		expect(collectionSlugsOf(payloadWith(undefined))).toEqual(DEFAULT_COLLECTION_SLUGS)
	})
})

describe('voted cookie prefix', () => {
	it('defaults to fb-voted-', () => {
		expect(resolveVotedCookiePrefix(undefined)).toBe(DEFAULT_VOTED_COOKIE_PREFIX)
		expect(DEFAULT_VOTED_COOKIE_PREFIX).toBe('fb-voted-')
		expect(votedCookiePrefixOf(payloadWith(undefined))).toBe('fb-voted-')
	})

	it('accepts any RFC 6265 cookie-name token', () => {
		expect(resolveVotedCookiePrefix('acme_poll.')).toBe('acme_poll.')
	})

	it('refuses characters a cookie name cannot carry', () => {
		for (const bad of ['', 'has space', 'semi;colon', 'eq=', 'quote"']) {
			expect(() => resolveVotedCookiePrefix(bad)).toThrow(/poll\.cookiePrefix/)
		}
	})

	it('reads back a stashed prefix', () => {
		const custom = stashCollectionSlugs(undefined, DEFAULT_COLLECTION_SLUGS, 'acme-voted-')
		expect(votedCookiePrefixOf(payloadWith(custom))).toBe('acme-voted-')
	})
})
