import { describe, expect, it } from 'vitest'
import { consentDisplayOf, effectiveConsentStatement } from './effectiveStatement'

const rich = (text: string) => ({
	root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text }] }] },
})
const empty = { root: { type: 'root', children: [] } }

describe('consentDisplayOf', () => {
	it('is notice only for an explicit notice, checkbox for everything else', () => {
		expect(consentDisplayOf({ display: 'notice' })).toBe('notice')
		expect(consentDisplayOf({ display: 'checkbox' })).toBe('checkbox')
		expect(consentDisplayOf({})).toBe('checkbox')
		expect(consentDisplayOf({ display: 'bogus' })).toBe('checkbox')
	})
})

describe('effectiveConsentStatement', () => {
	const entry = { statement: rich('I accept'), noticeStatement: rich('By subscribing you agree') }

	it('serves the notice wording to a notice display', () => {
		expect(effectiveConsentStatement(entry, 'notice')).toBe(entry.noticeStatement)
	})

	it('serves the checkbox wording to a checkbox display, never the notice wording', () => {
		expect(effectiveConsentStatement(entry, 'checkbox')).toBe(entry.statement)
	})

	it('falls back to the statement when the notice wording is absent or empty', () => {
		expect(effectiveConsentStatement({ statement: entry.statement }, 'notice')).toBe(
			entry.statement
		)
		expect(
			effectiveConsentStatement({ statement: entry.statement, noticeStatement: empty }, 'notice')
		).toBe(entry.statement)
	})
})
