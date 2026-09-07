import { describe, expect, it } from 'vitest'
import { type MatchableEvent, matchGoals } from './match'
import type { Goal } from './types'

const ev = (over: Partial<MatchableEvent> = {}): MatchableEvent => ({
	type: 'pageview',
	path: '/',
	...over,
})

describe('matchGoals kinds', () => {
	const explicit: Goal = { slug: 'signup', name: 'Signup', match: { kind: 'goal' } }
	const named: Goal = { slug: 'cta', name: 'CTA', match: { kind: 'event', name: 'cta_click' } }
	const paths: Goal = {
		slug: 'thanks',
		name: 'Thanks',
		match: { kind: 'path', pattern: '/thank-you' },
	}
	const goals = [explicit, named, paths]

	it('matches an explicit goal event by slug', () => {
		expect(matchGoals(ev({ type: 'goal', name: 'signup' }), goals)).toEqual([
			{ slug: 'signup', value: 0 },
		])
	})

	it('does not match an explicit goal whose slug differs', () => {
		expect(matchGoals(ev({ type: 'goal', name: 'other' }), goals)).toEqual([])
	})

	it('does not match a kind:goal target from a custom event of the same name', () => {
		expect(matchGoals(ev({ type: 'event', name: 'signup' }), goals)).toEqual([])
	})

	it('matches a custom event by name', () => {
		expect(matchGoals(ev({ type: 'event', name: 'cta_click' }), goals)).toEqual([
			{ slug: 'cta', value: 0 },
		])
	})

	it('does not match a custom-event goal from a goal event of the same name', () => {
		expect(matchGoals(ev({ type: 'goal', name: 'cta_click' }), goals)).toEqual([])
	})

	it('matches a path goal on a pageview', () => {
		expect(matchGoals(ev({ type: 'pageview', path: '/thank-you' }), goals)).toEqual([
			{ slug: 'thanks', value: 0 },
		])
	})

	it('does not match a path goal from a custom event on that path', () => {
		expect(matchGoals(ev({ type: 'event', name: 'x', path: '/thank-you' }), goals)).toEqual([])
	})

	it('returns every goal a single event completes', () => {
		const both: Goal[] = [
			paths,
			{ slug: 'any-page', name: 'Any', match: { kind: 'path', pattern: '/**' } },
		]
		expect(matchGoals(ev({ path: '/thank-you' }), both).map((m) => m.slug)).toEqual([
			'thanks',
			'any-page',
		])
	})

	it('returns nothing when there are no goals', () => {
		expect(matchGoals(ev({ type: 'goal', name: 'signup' }), [])).toEqual([])
	})
})

describe('matchGoals path globs', () => {
	const goal = (pattern: string): Goal[] => [
		{ slug: 'g', name: 'G', match: { kind: 'path', pattern } },
	]
	const hits = (pattern: string, path: string): boolean =>
		matchGoals(ev({ path }), goal(pattern)).length > 0

	it('matches an exact path', () => {
		expect(hits('/thank-you', '/thank-you')).toBe(true)
	})

	it('ignores a trailing slash on either side', () => {
		expect(hits('/thank-you', '/thank-you/')).toBe(true)
		expect(hits('/thank-you/', '/thank-you')).toBe(true)
	})

	it('is anchored: a prefix or suffix alone does not match', () => {
		expect(hits('/thank-you', '/thank-you/receipt')).toBe(false)
		expect(hits('/thank-you', '/order/thank-you')).toBe(false)
	})

	it('is case-sensitive', () => {
		expect(hits('/thank-you', '/Thank-You')).toBe(false)
	})

	it('ignores a query string and a hash on the event path', () => {
		expect(hits('/thank-you', '/thank-you?utm_source=x')).toBe(true)
		expect(hits('/thank-you', '/thank-you#top')).toBe(true)
	})

	it('* spans exactly one segment', () => {
		expect(hits('/checkout/*/done', '/checkout/abc/done')).toBe(true)
		expect(hits('/checkout/*/done', '/checkout/a/b/done')).toBe(false)
		expect(hits('/checkout/*/done', '/checkout//done')).toBe(false)
		expect(hits('/checkout/*/done', '/checkout/done')).toBe(false)
	})

	it('** spans any depth below the prefix, not the prefix itself', () => {
		expect(hits('/docs/**', '/docs/intro')).toBe(true)
		expect(hits('/docs/**', '/docs/guide/fields/text')).toBe(true)
		expect(hits('/docs/**', '/docs')).toBe(false)
		expect(hits('/docs/**', '/blog/intro')).toBe(false)
	})

	it('treats regex metacharacters in a pattern as literals', () => {
		expect(hits('/pricing.html', '/pricingxhtml')).toBe(false)
		expect(hits('/pricing.html', '/pricing.html')).toBe(true)
	})

	it('matches the root path', () => {
		expect(hits('/', '/')).toBe(true)
		expect(hits('/', '/about')).toBe(false)
	})
})

describe('matchGoals value precedence', () => {
	const withValue = (value?: { fixed?: number; prop?: string }): Goal[] => [
		{ slug: 'buy', name: 'Buy', match: { kind: 'goal' }, ...(value ? { value } : {}) },
	]
	const goalEvent = (over: Partial<MatchableEvent>): MatchableEvent =>
		ev({ type: 'goal', name: 'buy', ...over })

	it('prefers the event value over a fixed goal value', () => {
		expect(matchGoals(goalEvent({ value: 42 }), withValue({ fixed: 10 }))).toEqual([
			{ slug: 'buy', value: 42 },
		])
	})

	it('honors an explicit zero event value', () => {
		expect(matchGoals(goalEvent({ value: 0 }), withValue({ fixed: 10 }))).toEqual([
			{ slug: 'buy', value: 0 },
		])
	})

	it('falls back to the fixed goal value', () => {
		expect(matchGoals(goalEvent({}), withValue({ fixed: 10 }))).toEqual([
			{ slug: 'buy', value: 10 },
		])
	})

	it('reads a numeric prop when there is no event or fixed value', () => {
		expect(matchGoals(goalEvent({ props: { total: 19.5 } }), withValue({ prop: 'total' }))).toEqual(
			[{ slug: 'buy', value: 19.5 }]
		)
	})

	it('coerces a numeric string prop', () => {
		expect(
			matchGoals(goalEvent({ props: { total: '19.5' } }), withValue({ prop: 'total' }))
		).toEqual([{ slug: 'buy', value: 19.5 }])
	})

	it('falls back to 0 for a non-numeric, missing, or non-finite prop', () => {
		expect(
			matchGoals(goalEvent({ props: { total: 'free' } }), withValue({ prop: 'total' }))
		).toEqual([{ slug: 'buy', value: 0 }])
		expect(matchGoals(goalEvent({}), withValue({ prop: 'total' }))).toEqual([
			{ slug: 'buy', value: 0 },
		])
		expect(
			matchGoals(
				goalEvent({ props: { total: Number.POSITIVE_INFINITY } }),
				withValue({ prop: 'total' })
			)
		).toEqual([{ slug: 'buy', value: 0 }])
	})

	it('prefers a fixed value over a prop when both are configured', () => {
		expect(
			matchGoals(goalEvent({ props: { total: 5 } }), withValue({ fixed: 10, prop: 'total' }))
		).toEqual([{ slug: 'buy', value: 10 }])
	})

	it('is 0 when the goal declares no value at all', () => {
		expect(matchGoals(goalEvent({}), withValue())).toEqual([{ slug: 'buy', value: 0 }])
	})

	it('ignores a non-finite event value and falls through', () => {
		expect(matchGoals(goalEvent({ value: Number.NaN }), withValue({ fixed: 7 }))).toEqual([
			{ slug: 'buy', value: 7 },
		])
	})
})
