import { describe, expect, it } from 'vitest'
import {
	completionAmounts,
	type GoalCompletion,
	type MatchableEvent,
	type MatchOptions,
} from './match'
import type { Goal } from './types'

const ev = (over: Partial<MatchableEvent> = {}): MatchableEvent => ({
	type: 'pageview',
	path: '/',
	...over,
})

const completions = (event: MatchableEvent, goals: Goal[], opts?: MatchOptions): GoalCompletion[] =>
	completionAmounts(event, goals, opts).map(({ goal, amount }) => ({
		slug: goal.slug,
		value: amount,
	}))

describe('goal matching kinds', () => {
	const explicit: Goal = { slug: 'signup', name: 'Signup', match: { kind: 'goal' } }
	const named: Goal = { slug: 'cta', name: 'CTA', match: { kind: 'event', name: 'cta_click' } }
	const paths: Goal = {
		slug: 'thanks',
		name: 'Thanks',
		match: { kind: 'path', pattern: '/thank-you' },
	}
	const goals = [explicit, named, paths]

	it('matches an explicit goal event by slug', () => {
		expect(completions(ev({ type: 'goal', name: 'signup' }), goals)).toEqual([
			{ slug: 'signup', value: 0 },
		])
	})

	it('does not match an explicit goal whose slug differs', () => {
		expect(completions(ev({ type: 'goal', name: 'other' }), goals)).toEqual([])
	})

	it('does not match a kind:goal target from a custom event of the same name', () => {
		expect(completions(ev({ type: 'event', name: 'signup' }), goals)).toEqual([])
	})

	it('matches a custom event by name', () => {
		expect(completions(ev({ type: 'event', name: 'cta_click' }), goals)).toEqual([
			{ slug: 'cta', value: 0 },
		])
	})

	it('does not match a custom-event goal from a goal event of the same name', () => {
		expect(completions(ev({ type: 'goal', name: 'cta_click' }), goals)).toEqual([])
	})

	it('matches a path goal on a pageview', () => {
		expect(completions(ev({ type: 'pageview', path: '/thank-you' }), goals)).toEqual([
			{ slug: 'thanks', value: 0 },
		])
	})

	it('does not match a path goal from a custom event on that path', () => {
		expect(completions(ev({ type: 'event', name: 'x', path: '/thank-you' }), goals)).toEqual([])
	})

	it('returns every goal a single event completes', () => {
		const both: Goal[] = [
			paths,
			{ slug: 'any-page', name: 'Any', match: { kind: 'path', pattern: '/**' } },
		]
		expect(completions(ev({ path: '/thank-you' }), both).map((m) => m.slug)).toEqual([
			'thanks',
			'any-page',
		])
	})

	it('returns nothing when there are no goals', () => {
		expect(completions(ev({ type: 'goal', name: 'signup' }), [])).toEqual([])
	})
})

describe('goal matching path globs', () => {
	const goal = (pattern: string): Goal[] => [
		{ slug: 'g', name: 'G', match: { kind: 'path', pattern } },
	]
	const hits = (pattern: string, path: string): boolean =>
		completions(ev({ path }), goal(pattern)).length > 0

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
		expect(hits('/a+b', '/ab')).toBe(false)
		expect(hits('/a+b', '/a+b')).toBe(true)
		expect(hits('/plans(new)', '/plansnew')).toBe(false)
		expect(hits('/plans(new)', '/plans(new)')).toBe(true)
		expect(hits('/a{2}', '/aa')).toBe(false)
		expect(hits('/a|b', '/a')).toBe(false)
		expect(hits('/a[b]', '/ab')).toBe(false)
		expect(hits('/a^b$', '/a^b$')).toBe(true)
	})

	it('cuts a query string and a hash off the pattern too', () => {
		// A pattern authored by pasting a URL keeps working: `?` must never survive into the
		// regex as an optional-quantifier, which would make '/fo' match '/foo?'.
		expect(hits('/thank-you?ref=x', '/thank-you')).toBe(true)
		expect(hits('/thank-you?ref=x', '/thank-you?ref=y')).toBe(true)
		expect(hits('/foo?', '/fo')).toBe(false)
		expect(hits('/foo?', '/foo')).toBe(true)
		expect(hits('/docs#intro', '/docs')).toBe(true)
	})

	it('matches the root path', () => {
		expect(hits('/', '/')).toBe(true)
		expect(hits('/', '/about')).toBe(false)
	})
})

describe('goal matching value precedence', () => {
	const withValue = (value?: { fixed?: number; prop?: string }): Goal[] => [
		{ slug: 'buy', name: 'Buy', match: { kind: 'goal' }, ...(value ? { value } : {}) },
	]
	const goalEvent = (over: Partial<MatchableEvent>): MatchableEvent =>
		ev({ type: 'goal', name: 'buy', ...over })

	it('prefers the event value over a fixed goal value', () => {
		expect(completions(goalEvent({ value: 42 }), withValue({ fixed: 10 }))).toEqual([
			{ slug: 'buy', value: 42 },
		])
	})

	it('honors an explicit zero event value', () => {
		expect(completions(goalEvent({ value: 0 }), withValue({ fixed: 10 }))).toEqual([
			{ slug: 'buy', value: 0 },
		])
	})

	it('falls back to the fixed goal value', () => {
		expect(completions(goalEvent({}), withValue({ fixed: 10 }))).toEqual([
			{ slug: 'buy', value: 10 },
		])
	})

	it('reads a numeric prop when there is no event or fixed value', () => {
		expect(
			completions(goalEvent({ props: { total: 19.5 } }), withValue({ prop: 'total' }))
		).toEqual([{ slug: 'buy', value: 19.5 }])
	})

	it('coerces a numeric string prop', () => {
		expect(
			completions(goalEvent({ props: { total: '19.5' } }), withValue({ prop: 'total' }))
		).toEqual([{ slug: 'buy', value: 19.5 }])
	})

	it('refuses a negative value from any source and reports 0', () => {
		expect(
			completions(goalEvent({ props: { total: -1000 } }), withValue({ prop: 'total' }))
		).toEqual([{ slug: 'buy', value: 0 }])
		expect(completions(goalEvent({ value: -5 }), withValue())).toEqual([{ slug: 'buy', value: 0 }])
	})

	it('falls back to 0 for a non-numeric, missing, or non-finite prop', () => {
		expect(
			completions(goalEvent({ props: { total: 'free' } }), withValue({ prop: 'total' }))
		).toEqual([{ slug: 'buy', value: 0 }])
		expect(completions(goalEvent({}), withValue({ prop: 'total' }))).toEqual([
			{ slug: 'buy', value: 0 },
		])
		expect(
			completions(
				goalEvent({ props: { total: Number.POSITIVE_INFINITY } }),
				withValue({ prop: 'total' })
			)
		).toEqual([{ slug: 'buy', value: 0 }])
	})

	it('puts a fixed value before the event value with fixedFirst, per goal', () => {
		const goals: Goal[] = [
			{ slug: 'buy', name: 'Buy', match: { kind: 'goal' }, value: { fixed: 10 } },
			{ slug: 'any', name: 'Any', match: { kind: 'goal' } },
		]
		const event = ev({ type: 'goal', name: 'buy', value: 42 })
		const anyGoal = (slug: string): Goal[] =>
			goals.map((goal) => ({ ...goal, match: { kind: 'event', name: slug } }))
		expect(completions({ ...event, type: 'event' }, anyGoal('buy'), { fixedFirst: true })).toEqual([
			{ slug: 'buy', value: 10 },
			{ slug: 'any', value: 42 },
		])
		expect(completionAmounts({ ...event, type: 'event' }, anyGoal('buy'))).toEqual([
			{ goal: anyGoal('buy')[0], source: 'event', amount: 42 },
			{ goal: anyGoal('buy')[1], source: 'event', amount: 42 },
		])
		expect(
			completionAmounts(goalEvent({ props: { total: 5 } }), withValue({ prop: 'total' }), {
				props: false,
			})
		).toEqual([{ goal: withValue({ prop: 'total' })[0], source: 'none', amount: 0 }])
	})

	it('prefers a fixed value over a prop when both are configured', () => {
		expect(
			completions(goalEvent({ props: { total: 5 } }), withValue({ fixed: 10, prop: 'total' }))
		).toEqual([{ slug: 'buy', value: 10 }])
	})

	it('is 0 when the goal declares no value at all', () => {
		expect(completions(goalEvent({}), withValue())).toEqual([{ slug: 'buy', value: 0 }])
	})

	it('ignores a non-finite event value and falls through', () => {
		expect(completions(goalEvent({ value: Number.NaN }), withValue({ fixed: 7 }))).toEqual([
			{ slug: 'buy', value: 7 },
		])
	})
})
