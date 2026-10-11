import { describe, expect, it } from 'vitest'

import { IMPERSONATION_SID_PREFIX } from './constants'
import { shouldLookupImpersonation } from './lookup'

const options = {
	hintCookieName: 'impersonation-hint',
	session: {},
}

describe('shouldLookupImpersonation', () => {
	it('skips ordinary sids with no hint cookie', () => {
		expect(
			shouldLookupImpersonation({
				headers: new Headers(),
				options,
				sid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
			})
		).toBe(false)
	})

	it('looks up a minted target sid', () => {
		expect(
			shouldLookupImpersonation({
				headers: new Headers(),
				options,
				sid: `${IMPERSONATION_SID_PREFIX}aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`,
			})
		).toBe(true)
	})

	it('looks up when the hint cookie is present', () => {
		expect(
			shouldLookupImpersonation({
				headers: new Headers({ cookie: 'impersonation-hint=row-1' }),
				options,
				sid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
			})
		).toBe(true)
	})

	it('always looks up when session.issue is custom', () => {
		expect(
			shouldLookupImpersonation({
				headers: new Headers(),
				options: { ...options, session: { issue: async () => ({}) as never } },
				sid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
			})
		).toBe(true)
	})
})
