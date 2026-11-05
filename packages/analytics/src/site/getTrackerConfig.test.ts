import { describe, expect, it } from 'vitest'
import { draftModeCookie, NEXT_DRAFT_COOKIE } from './getTrackerConfig'

describe('draftModeCookie', () => {
	it("reads Next's draft mode cookie with a value, among others", () => {
		const cookie = (value: string) => new Headers({ cookie: value })
		expect(draftModeCookie(cookie(`theme=dark; ${NEXT_DRAFT_COOKIE}=a1b2c3`))).toBe(true)
		expect(draftModeCookie(cookie(`${NEXT_DRAFT_COOKIE}=a=b`))).toBe(true)
	})

	it('reads no draft from a cleared cookie, a lookalike or no cookie at all', () => {
		expect(draftModeCookie(new Headers({ cookie: `${NEXT_DRAFT_COOKIE}=` }))).toBe(false)
		expect(draftModeCookie(new Headers({ cookie: `x${NEXT_DRAFT_COOKIE}=1` }))).toBe(false)
		expect(draftModeCookie(new Headers())).toBe(false)
	})
})
