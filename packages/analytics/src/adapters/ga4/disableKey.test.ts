import { describe, expect, it } from 'vitest'
import { LINE_SEPARATOR } from '../../capture/jsLiteral'
import { EXCLUSION_STORAGE_KEY } from '../../tracker/exclusion'
import { ga4DisableKey, ga4ExcludeGuard } from './disableKey'

describe('ga4ExcludeGuard', () => {
	it('reads the exclusion key and sets the switch for the id', () => {
		expect(ga4ExcludeGuard('G-AB12CD34')).toBe(
			`try{if(localStorage.getItem("${EXCLUSION_STORAGE_KEY}")==="1")window["${ga4DisableKey('G-AB12CD34')}"]=true}catch(e){}`
		)
	})

	// Quoted like the `gtag("config", ...)` call it guards; the adapter refuses a non-token id earlier.
	it('quotes the id as a string literal', () => {
		expect(ga4ExcludeGuard('G-A"B')).toContain('window["ga-disable-G-A\\"B"]=true')
	})

	it('escapes an id that would otherwise break out of the inline script', () => {
		const guard = ga4ExcludeGuard(`G-</script><script>alert(1)</script>${LINE_SEPARATOR}`)

		expect(guard).not.toContain('</script>')
		expect(guard).not.toContain(LINE_SEPARATOR)
		expect(guard).toContain('\\u003c')
	})
})
