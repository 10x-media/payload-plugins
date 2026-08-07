import { describe, expect, it } from 'vitest'

import { createPathMatcher, matchesPattern } from './pathPatterns'

describe('matchesPattern', () => {
	it('matches an exact path', () => {
		expect(matchesPattern('title', 'title')).toBe(true)
		expect(matchesPattern('seo.title', 'seo.title')).toBe(true)
		expect(matchesPattern('seo.title', 'title')).toBe(false)
	})

	it('matches ancestors, so a container ignores its subtree', () => {
		expect(matchesPattern('named.deep.value', 'named')).toBe(true)
		expect(matchesPattern('named.deep.value', 'named.deep')).toBe(true)
		expect(matchesPattern('named', 'named.deep')).toBe(false)
	})

	it('does not match a partial segment', () => {
		expect(matchesPattern('titles', 'title')).toBe(false)
		expect(matchesPattern('seotitle', 'seo')).toBe(false)
	})

	it('treats * as exactly one segment', () => {
		expect(matchesPattern('list.0.title', 'list.*.title')).toBe(true)
		expect(matchesPattern('list.12.title', 'list.*.title')).toBe(true)
		expect(matchesPattern('list.0.meta.title', 'list.*.title')).toBe(false)
		expect(matchesPattern('list.title', 'list.*.title')).toBe(false)
	})

	it('matches the subtree under a wildcard match', () => {
		expect(matchesPattern('layout.0.body.root.children', 'layout.*.body')).toBe(true)
	})

	it('supports wildcards at several depths', () => {
		expect(matchesPattern('list.0.nested.3.value', 'list.*.nested.*.value')).toBe(true)
		expect(matchesPattern('list.0.nested.3.other', 'list.*.nested.*.value')).toBe(false)
	})

	it('matches a leading wildcard against any first segment', () => {
		expect(matchesPattern('anything.id', '*.id')).toBe(true)
	})
})

describe('createPathMatcher', () => {
	it('returns false for every path when given no patterns', () => {
		const matcher = createPathMatcher([])
		expect(matcher('title')).toBe(false)
		expect(matcher('')).toBe(false)
	})

	it('ignores empty patterns rather than matching everything', () => {
		const matcher = createPathMatcher([''])
		expect(matcher('title')).toBe(false)
	})

	it('matches when any pattern matches', () => {
		const matcher = createPathMatcher(['updatedAt', 'list.*.rowRich'])
		expect(matcher('updatedAt')).toBe(true)
		expect(matcher('list.2.rowRich')).toBe(true)
		expect(matcher('list.2.title')).toBe(false)
	})

	it('returns a stable verdict for a repeated path', () => {
		const matcher = createPathMatcher(['seo'])
		expect(matcher('seo.title')).toBe(true)
		expect(matcher('seo.title')).toBe(true)
		expect(matcher('title')).toBe(false)
		expect(matcher('title')).toBe(false)
	})

	it('deduplicates repeated patterns', () => {
		const matcher = createPathMatcher(['seo', 'seo', 'seo.title'])
		expect(matcher('seo.description')).toBe(true)
	})
})
