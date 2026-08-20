import { describe, expect, it } from 'vitest'
import { applyBlur, applyClear, applyInput, applySave, applyUndo } from './writeOnlyIntent'

const text = { cleared: false, isNumber: false }
const number = { cleared: false, isNumber: true }

describe('applyInput (typing into the write-only input)', () => {
	it('stages typed text as a replacement', () => {
		expect(applyInput('sk-new-secret', text)).toEqual({ cleared: false, value: 'sk-new-secret' })
	})

	it('type then backspace-to-empty returns to KEEPING the stored value', () => {
		// The reported scenario: populated stripe key, user types, erases it all,
		// presses save. The staged value must be undefined (keep), never '' or null.
		const typed = applyInput('oops', text)
		expect(typed.value).toBe('oops')
		expect(applyInput('', { cleared: typed.cleared, isNumber: false })).toEqual({
			cleared: false,
			value: undefined,
		})
	})

	it('typing after an explicit clear keeps the clear as the erase-return lineage', () => {
		// clear (×) -> type -> erase must land back on CLEARED, not silently
		// cancel the user's explicit removal.
		const afterClear = applyClear({ cleared: false, clearable: true, isSet: true, typed: false })
		expect(afterClear).toEqual({ cleared: true, value: null })
		const typed = applyInput('replacement', { cleared: true, isNumber: false })
		expect(typed).toEqual({ cleared: true, value: 'replacement' })
		expect(applyInput('', { cleared: true, isNumber: false })).toEqual({
			cleared: true,
			value: null,
		})
	})

	it('parses numbers and treats unparseable text as emptied', () => {
		expect(applyInput('42.5', number)).toEqual({ cleared: false, value: 42.5 })
		expect(applyInput('e', number)).toEqual({ cleared: false, value: undefined })
		expect(applyInput('e', { cleared: true, isNumber: true })).toEqual({
			cleared: true,
			value: null,
		})
	})
})

describe('applyClear (the × action)', () => {
	it('discards staged text back to keep when nothing was cleared', () => {
		expect(applyClear({ cleared: false, clearable: true, isSet: true, typed: true })).toEqual({
			cleared: false,
			value: undefined,
		})
	})

	it('discards staged text back to CLEARED when the clear came first', () => {
		expect(applyClear({ cleared: true, clearable: true, isSet: true, typed: true })).toEqual({
			cleared: true,
			value: null,
		})
	})

	it('clears the stored value into the undoable cleared state', () => {
		expect(applyClear({ cleared: false, clearable: true, isSet: true, typed: false })).toEqual({
			cleared: true,
			value: null,
		})
	})

	it('does nothing when not clearable, not set, or already cleared', () => {
		expect(applyClear({ cleared: false, clearable: false, isSet: true, typed: false })).toBeNull()
		expect(applyClear({ cleared: false, clearable: true, isSet: false, typed: false })).toBeNull()
		expect(applyClear({ cleared: true, clearable: true, isSet: true, typed: false })).toBeNull()
	})

	it('still discards typed text on a non-clearable (required) field', () => {
		expect(applyClear({ cleared: false, clearable: false, isSet: true, typed: true })).toEqual({
			cleared: false,
			value: undefined,
		})
	})
})

describe('applyUndo / applySave', () => {
	it('undo returns from cleared to keeping the stored value', () => {
		expect(applyUndo()).toEqual({ cleared: false, value: undefined })
	})

	it('save resolves every staged intent back to the concealed face', () => {
		expect(applySave()).toEqual({ cleared: false, value: undefined })
	})
})

describe('applyBlur (whitespace hygiene for pasted credentials)', () => {
	it('trims a pasted trailing newline or space', () => {
		expect(applyBlur('sk-key-with-newline\n', text)).toEqual({
			cleared: false,
			value: 'sk-key-with-newline',
		})
		expect(applyBlur('  padded  ', text)).toEqual({ cleared: false, value: 'padded' })
	})

	it('treats whitespace-only input as emptied, honouring the lineage', () => {
		expect(applyBlur('   ', text)).toEqual({ cleared: false, value: undefined })
		expect(applyBlur('   ', { cleared: true, isNumber: false })).toEqual({
			cleared: true,
			value: null,
		})
	})

	it('changes nothing for clean text, numbers, or untyped states', () => {
		expect(applyBlur('already-clean', text)).toBeNull()
		expect(applyBlur('inner spaces stay', text)).toBeNull()
		expect(applyBlur(42.5, number)).toBeNull()
		expect(applyBlur(undefined, text)).toBeNull()
		expect(applyBlur(null, text)).toBeNull()
	})
})
