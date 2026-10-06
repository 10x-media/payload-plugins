import { describe, expect, it } from 'vitest'
import { EXCLUSION_STORAGE_KEY } from '../../tracker/exclusion'
import { ga4DisableKey, ga4ExcludeGuard } from './disableKey'

describe('ga4ExcludeGuard', () => {
	it('reads the exclusion key and sets the switch for the id', () => {
		expect(ga4ExcludeGuard('G-AB12CD34')).toBe(
			`try{if(localStorage.getItem("${EXCLUSION_STORAGE_KEY}")==="1")window["${ga4DisableKey('G-AB12CD34')}"]=true}catch(e){}`
		)
	})

	// Same means as the `gtag("config", ...)` call the guard sits in front of: the id is a
	// JSON string literal, and the adapter refuses one that is not a bare token before either
	// reaches the page.
	it('quotes the id as a string literal', () => {
		expect(ga4ExcludeGuard('G-A"B')).toContain('window["ga-disable-G-A\\"B"]=true')
	})
})
