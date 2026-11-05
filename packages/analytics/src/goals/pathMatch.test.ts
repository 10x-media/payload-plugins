import { describe, expect, it } from 'vitest'
import {
	compilePattern,
	MAX_PATH_SEGMENTS,
	MAX_PATTERN_GLOBSTARS,
	MAX_PATTERN_SEGMENTS,
	matchesSegments,
	pathMatches,
	pathSegments,
	patternProblem,
} from './pathMatch'

/** A regex glob over the whole path, the reference the segment matcher must agree with. */
const regexTrim = (path: string): string =>
	path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path

const regexPathOnly = (path: string): string => {
	const cut = path.search(/[?#]/)
	return regexTrim(cut === -1 ? path : path.slice(0, cut))
}

const REGEX_ESCAPE = /[.+?^${}()|[\]\\]/g

const regexMatches = (pattern: string, path: string): boolean => {
	const body = regexPathOnly(pattern)
		.replace(REGEX_ESCAPE, '\\$&')
		.split('**')
		.map((part) => part.replace(/\*/g, '[^/]+'))
		.join('.+')
	return new RegExp(`^${body}$`).test(regexPathOnly(path))
}

const PARITY: Array<[pattern: string, path: string, expected: boolean]> = [
	['/thank-you', '/thank-you', true],
	['/thank-you', '/thank-you/', true],
	['/thank-you/', '/thank-you', true],
	['/thank-you', '/thank-you/receipt', false],
	['/thank-you', '/order/thank-you', false],
	['/thank-you', '/Thank-You', false],
	['/thank-you', '/thank-you?utm_source=x', true],
	['/thank-you', '/thank-you#top', true],
	['/thank-you?ref=x', '/thank-you', true],
	['/thank-you?ref=x', '/thank-you?ref=y', true],
	['/a#x?y', '/a', true],
	['/docs#intro', '/docs', true],
	['/foo?', '/fo', false],
	['/foo?', '/foo', true],
	['/', '/', true],
	['/', '/about', false],
	['', '', true],
	['', '/', false],
	['docs', 'docs', true],
	['docs/**', '/docs/a', false],
	['/checkout/*/done', '/checkout/abc/done', true],
	['/checkout/*/done', '/checkout/a/b/done', false],
	['/checkout/*/done', '/checkout//done', false],
	['/checkout/*/done', '/checkout/done', false],
	['/*', '/a', true],
	['/*', '/', false],
	['/*', '/a/b', false],
	['/*/*', '/a/b', true],
	['/*/*', '/a', false],
	['/docs/*', '/docs/', false],
	['/docs/*', '/docs//', false],
	['/docs/**', '/docs/intro', true],
	['/docs/**', '/docs/guide/fields/text', true],
	['/docs/**', '/docs', false],
	['/docs/**', '/docs/', false],
	['/docs/**', '/docs//', false],
	['/docs/**', '/docs///', true],
	['/docs/**', '/blog/intro', false],
	['/Docs/**', '/docs/a', false],
	['/**', '/', false],
	['/**', '//', false],
	['/**', '/a', true],
	['/**', '/a/b/c', true],
	['/**/done', '/x/done', true],
	['/**/done', '/a/b/done', true],
	['/**/done', '/done', false],
	['/a/**/b', '/a//b', false],
	['/a/**/b', '/a///b', true],
	['/a/**/b', '/a/b', false],
	['/a/**/b', '/a/x/y/b', true],
	['/**/*', '/a', false],
	['/**/*', '/a/b', true],
	['/**/y/**', '/a/y/b', true],
	['/**/y/**', '/y/b', false],
	['/x/**/y/**/z', '/x/1/y/2/z', true],
	['/x/**/y/**/z', '/x/y/z', false],
	['/x/**/y/**/z', '/x/1/2/y/3/4/z', true],
	['/blog-*', '/blog-post', true],
	['/blog-*', '/blog-', false],
	['/blog-*', '/blog-a/b', false],
	['/blog-**', '/blog-a', true],
	['/*-post', '/my-post', true],
	['/*-post', '/-post', false],
	['/*.html', '/index.html', true],
	['/*.html', '/.html', false],
	['/*.html', '/a/b.html', false],
	['/**.html', '/b.html', true],
	['/a*b*c', '/axbyc', true],
	['/a*b*c', '/axxbyyc', true],
	['/a*b*c', '/abc', false],
	['/a*b*c', '/axbc', false],
	['/a**b', '/axb', true],
	['/***', '/ab', true],
	['/pricing.html', '/pricingxhtml', false],
	['/pricing.html', '/pricing.html', true],
	['/a+b', '/ab', false],
	['/a+b', '/a+b', true],
	['/plans(new)', '/plansnew', false],
	['/plans(new)', '/plans(new)', true],
	['/a{2}', '/aa', false],
	['/a|b', '/a', false],
	['/a[b]', '/ab', false],
	['/a^b$', '/a^b$', true],
	['/a\\b', '/a\\b', true],
]

describe('path matcher parity with the regex glob', () => {
	for (const [pattern, path, expected] of PARITY) {
		it(`"${pattern}" against "${path}" is ${expected}`, () => {
			expect(regexMatches(pattern, path)).toBe(expected)
			expect(pathMatches(pattern, path)).toBe(expected)
		})
	}
})

/**
 * Where the regex lets an in-segment `**` cross slashes: the matcher reads a run of stars inside a
 * segment as one wildcard, and a segment of three or more stars as a `**`.
 */
const DIFFERENCES: Array<[pattern: string, path: string, matcher: boolean, regex: boolean]> = [
	['/blog-**', '/blog-a/b', false, true],
	['/**.html', '/a/b.html', false, true],
	['/a**b', '/ax/yb', false, true],
	['/***', '/a', true, false],
]

describe('the deliberate differences from the regex glob', () => {
	for (const [pattern, path, matcher, regex] of DIFFERENCES) {
		it(`"${pattern}" against "${path}" is ${matcher}`, () => {
			expect(regexMatches(pattern, path)).toBe(regex)
			expect(pathMatches(pattern, path)).toBe(matcher)
		})
	}
})

const deepPattern = (segments: number): string => `/${Array(segments).fill('a').join('/')}`

describe('pattern caps', () => {
	it(`allows ${MAX_PATTERN_SEGMENTS} segments and refuses one more`, () => {
		expect(patternProblem(deepPattern(MAX_PATTERN_SEGMENTS))).toBeNull()
		expect(patternProblem(deepPattern(MAX_PATTERN_SEGMENTS + 1))).toBe('too-many-segments')
		expect(pathMatches(deepPattern(MAX_PATTERN_SEGMENTS), deepPattern(MAX_PATTERN_SEGMENTS))).toBe(
			true
		)
		expect(
			pathMatches(deepPattern(MAX_PATTERN_SEGMENTS + 1), deepPattern(MAX_PATTERN_SEGMENTS + 1))
		).toBe(false)
	})

	it(`allows ${MAX_PATTERN_GLOBSTARS} uses of ** and refuses one more`, () => {
		expect(patternProblem('/**/a/**/b/**/c/**')).toBeNull()
		expect(patternProblem('/**/a/**/b/**/c/**/d/**')).toBe('too-many-globstars')
		expect(compilePattern('/**/a/**/b/**/c/**/d/**')).toBeNull()
	})

	it('counts a ** inside a segment, and a longer run of stars once', () => {
		expect(patternProblem('/a**/b**/c**/d**')).toBeNull()
		expect(patternProblem('/a**/b**/c**/d**/e**')).toBe('too-many-globstars')
		expect(patternProblem('/****/a/****/b/****/c/****')).toBeNull()
	})

	it('ignores the query and hash a pasted pattern carries', () => {
		expect(patternProblem(`${deepPattern(MAX_PATTERN_SEGMENTS)}?a=/b/c/d#/e/f`)).toBeNull()
	})

	it(`matches a path of ${MAX_PATH_SEGMENTS} segments and never a deeper one`, () => {
		expect(pathMatches('/**', deepPattern(MAX_PATH_SEGMENTS))).toBe(true)
		expect(pathSegments(deepPattern(MAX_PATH_SEGMENTS + 1))).toBeNull()
		expect(pathMatches('/**', deepPattern(MAX_PATH_SEGMENTS + 1))).toBe(false)
	})

	it('matches one compiled pattern against many paths', () => {
		const compiled = compilePattern('/docs/**')
		expect(compiled).not.toBeNull()
		if (compiled === null) return
		expect(matchesSegments(compiled, pathSegments('/docs/a') ?? [])).toBe(true)
		expect(matchesSegments(compiled, pathSegments('/docs') ?? [])).toBe(false)
	})
})

const median = (samples: number[]): number => {
	const sorted = [...samples].sort((a, b) => a - b)
	return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY
}

/** Median wall time of a batch of matches, after a warm-up: long enough for the clock to resolve. */
const timeMatch = (pattern: string, path: string): number => {
	for (let i = 0; i < 20; i++) {
		pathMatches(pattern, path)
	}
	const samples: number[] = []
	for (let sample = 0; sample < 21; sample++) {
		const start = performance.now()
		for (let i = 0; i < 40; i++) {
			pathMatches(pattern, path)
		}
		samples.push(performance.now() - start)
	}
	return median(samples)
}

/** Each hostile path at a size, and at eight times that size, the larger one the most the wire sends. */
const HOSTILE_PATHS: Record<string, (size: 1 | 8) => string> = {
	deepest: (size) =>
		`/${Array((MAX_PATH_SEGMENTS / 8) * size)
			.fill('aaa')
			.join('/')}`,
	oneSegment: (size) => `/${'a'.repeat(64 * size - 1)}`,
	empties: (size) => `/${'/'.repeat(16 * size - 1)}${'a'.repeat(48 * size)}`,
}

const HOSTILE_PATTERNS = [
	'/**/**/**/**/x',
	'/**/a*a*a*a*a*b/**/**/**',
	`/${'a*'.repeat(200)}b`,
	`/${Array(MAX_PATTERN_SEGMENTS).fill('*a*').join('/')}`,
	`/**/${Array(MAX_PATTERN_SEGMENTS - 2)
		.fill('*')
		.join('/')}/**`,
]

/**
 * Allowed slowdown for an eightfold path: linear is about 8, quadratic 64. A ratio holds on any
 * runner, where a bound in milliseconds holds only on a fast one.
 */
const LINEAR_RATIO = 24

describe('a hostile path against a worst-case pattern', () => {
	for (const [name, pathOf] of Object.entries(HOSTILE_PATHS)) {
		it(`takes time linear in the size of the ${name} path`, () => {
			expect(pathOf(8).length).toBeLessThanOrEqual(512)
			for (const pattern of HOSTILE_PATTERNS) {
				const ratio = timeMatch(pattern, pathOf(8)) / Math.max(timeMatch(pattern, pathOf(1)), 1e-3)
				expect(ratio, pattern).toBeLessThan(LINEAR_RATIO)
			}
		})
	}

	it('refuses a path deeper than any pattern reaches without matching it', () => {
		const tooDeep = `/${'a/'.repeat(255)}b`
		expect(tooDeep.length).toBeLessThanOrEqual(512)
		for (const pattern of HOSTILE_PATTERNS) {
			expect(pathMatches(pattern, tooDeep)).toBe(false)
		}
	})
})
