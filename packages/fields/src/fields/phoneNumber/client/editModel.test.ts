import { describe, expect, it } from 'vitest'
import { loadMetadata } from '../engine/metadata'
import {
	displayFor,
	dropCallingCode,
	formatDraft,
	type PhoneEntry,
	resolveCommit,
} from './editModel'

const metadata = await loadMetadata('max')

/** A Canadian number under a US row: shared calling code, so the read country is visible. */
const CA_NUMBER = '+1 416 555 0199'
const CA_E164 = '+14165550199'
const DE_MOBILE = '+4915112345678'

describe('displayFor', () => {
	it('paints nothing for an entry with no number', () => {
		expect(displayFor({ country: 'DE', number: null }, metadata)).toBe('')
	})

	it('paints the stored number verbatim before metadata lands', () => {
		expect(displayFor({ country: 'DE', number: DE_MOBILE }, null)).toBe(DE_MOBILE)
	})

	it('paints the national part once metadata lands', () => {
		expect(displayFor({ country: 'DE', number: DE_MOBILE }, metadata)).toBe('1511 2345678')
	})

	it('paints a stored number it cannot parse unchanged', () => {
		expect(displayFor({ country: 'DE', number: 'not a phone number' }, metadata)).toBe(
			'not a phone number'
		)
	})
})

describe('formatDraft', () => {
	const draft = (args: Partial<Parameters<typeof formatDraft>[0]> & { raw: string }) =>
		formatDraft({
			atEnd: true,
			callingCode: '1',
			country: 'US',
			metadata,
			previous: '',
			...args,
		})

	it('refuses a character no phone number can carry', () => {
		expect(draft({ raw: '212555abc' })).toBeNull()
	})

	it('hands the draft straight back before metadata lands', () => {
		expect(draft({ metadata: null, raw: '212 555 0123' })).toBe('212 555 0123')
	})

	it('refuses one more digit past anything the number could still become', () => {
		expect(draft({ previous: '2125550123', raw: '21255501234' })).toBeNull()
	})

	it('lets a paste through the ceiling, so the blur salvage can still read it', () => {
		expect(draft({ previous: '', raw: '21255501232125550123' })).not.toBeNull()
	})

	it('leaves a mid-string edit exactly as typed, so the caret stays put', () => {
		expect(draft({ atEnd: false, previous: '212550123', raw: '2125550123' })).toBe('2125550123')
	})

	it('leaves a deletion exactly as typed', () => {
		expect(draft({ previous: '212 555 0123', raw: '212 555 012' })).toBe('212 555 012')
	})

	it('formats an international draft as it is typed', () => {
		expect(
			draft({ callingCode: undefined, country: undefined, previous: '+4915', raw: '+49151' })
		).toBe('+49 151')
	})

	it('formats a national draft under its calling code, and hands back only the national part', () => {
		expect(
			draft({ callingCode: '49', country: 'DE', previous: '015112345', raw: '0151123456' })
		).toBe('01511 23456')
	})

	it('returns the draft untouched when no calling code lends it a shape', () => {
		expect(draft({ callingCode: undefined, previous: '21255', raw: '212555' })).toBe('212555')
	})
})

describe('dropCallingCode', () => {
	it('leaves a national draft alone', () => {
		expect(dropCallingCode('0151 12345678', metadata)).toBe('0151 12345678')
	})

	it('leaves an international draft alone before metadata lands', () => {
		expect(dropCallingCode('+49 1511 2345678', null)).toBe('+49 1511 2345678')
	})

	it('strips the calling code off a parseable international draft', () => {
		expect(dropCallingCode('+49 1511 2345678', metadata)).toBe('1511 2345678')
	})

	it('strips the calling code off a draft still too short to parse', () => {
		expect(dropCallingCode('+49151', metadata)).toBe('151')
	})

	it('leaves a draft whose digits name no calling code at all', () => {
		expect(dropCallingCode('+0000', metadata)).toBe('+0000')
	})
})

// resolveCommit has seven outcomes behind six arguments, three of them booleans, and used to
// be reachable only by rendering the field. Each outcome gets its own case here.
describe('resolveCommit', () => {
	const LAST_VALID: PhoneEntry = { country: 'FR', number: '+33612345678' }

	const commit = (args: Partial<Parameters<typeof resolveCommit>[0]> & { draft: string }) =>
		resolveCommit({
			country: 'US',
			isClearable: true,
			lastValid: null,
			metadata,
			picked: false,
			salvage: false,
			...args,
		})

	it('stores the trimmed draft as typed before metadata lands', () => {
		expect(commit({ draft: '  212 555 0123  ', metadata: null })).toEqual({
			country: 'US',
			derived: false,
			number: '212 555 0123',
		})
	})

	it('stores null for a draft that is blank before metadata lands', () => {
		expect(commit({ draft: '   ', metadata: null })).toEqual({
			country: 'US',
			derived: false,
			number: null,
		})
	})

	it('stores E.164 and takes the country off the number itself', () => {
		expect(commit({ draft: CA_NUMBER })).toEqual({
			country: 'CA',
			derived: true,
			number: CA_E164,
		})
	})

	it('keeps a picked country rather than reading one back off a shared calling code', () => {
		expect(commit({ draft: CA_NUMBER, picked: true })).toEqual({
			country: 'US',
			derived: false,
			number: CA_E164,
		})
	})

	it('keeps the row country when a valid number belongs to no country', () => {
		// A freephone number is valid and has a calling code, but no country owns it.
		expect(commit({ draft: '+800 1234 5678' })).toEqual({
			country: 'US',
			derived: false,
			number: '+80012345678',
		})
	})

	it('salvages a number out of a doubled paste when asked to', () => {
		expect(commit({ draft: `${DE_MOBILE}${DE_MOBILE}`, salvage: true })).toEqual({
			country: 'DE',
			derived: true,
			number: DE_MOBILE,
		})
	})

	it('leaves that same paste as typed when salvage is off', () => {
		expect(commit({ draft: `${DE_MOBILE}${DE_MOBILE}` })).toEqual({
			country: 'US',
			derived: false,
			number: `${DE_MOBILE}${DE_MOBILE}`,
		})
	})

	it('reverts to the last valid entry when the field cannot be cleared', () => {
		expect(commit({ draft: '', isClearable: false, lastValid: LAST_VALID })).toEqual({
			country: 'FR',
			derived: true,
			number: '+33612345678',
		})
	})

	it('clears anyway when there is no last valid entry to revert to', () => {
		expect(commit({ draft: '', isClearable: false })).toEqual({
			country: 'US',
			derived: false,
			number: null,
		})
	})

	it('clears a clearable field even with a last valid entry behind it', () => {
		expect(commit({ draft: '', lastValid: LAST_VALID })).toEqual({
			country: 'US',
			derived: false,
			number: null,
		})
	})
})
