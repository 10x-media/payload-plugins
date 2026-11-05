import { describe, expect, it } from 'vitest'
import { jsLiteral, LINE_SEPARATOR, PARAGRAPH_SEPARATOR } from './jsLiteral'

describe('jsLiteral', () => {
	it('escapes a closing script tag so it cannot end the element', () => {
		const out = jsLiteral('</script><script>alert(1)</script>')

		expect(out).not.toContain('</script>')
		expect(out).not.toContain('<')
		expect(out).toContain('\\u003c')
	})

	it('escapes the JavaScript line terminators JSON leaves alone', () => {
		expect(jsLiteral(`a${LINE_SEPARATOR}b${PARAGRAPH_SEPARATOR}c`)).toBe('"a\\u2028b\\u2029c"')
	})

	it('escapes an ampersand, so an HTML-escaping context cannot rewrite the literal', () => {
		expect(jsLiteral('a&b')).toBe('"a\\u0026b"')
	})

	it('round-trips through JSON.parse unchanged', () => {
		const value = `</script>${LINE_SEPARATOR}&<>`

		expect(JSON.parse(jsLiteral(value))).toBe(value)
	})

	it('answers null for a value JSON cannot represent', () => {
		expect(jsLiteral(undefined)).toBe('null')
	})
})
