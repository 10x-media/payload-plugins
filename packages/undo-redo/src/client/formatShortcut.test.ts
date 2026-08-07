import { describe, expect, it } from 'vitest'

import { formatShortcut } from './formatShortcut'

describe('formatShortcut', () => {
	it('resolves mod per platform', () => {
		expect(formatShortcut('mod+z', true)).toBe('⌘Z')
		expect(formatShortcut('mod+z', false)).toBe('Ctrl+Z')
	})

	it('orders modifiers consistently regardless of how the chord is written', () => {
		expect(formatShortcut('mod+shift+z', true)).toBe('⇧⌘Z')
		expect(formatShortcut('shift+mod+z', true)).toBe('⇧⌘Z')
		expect(formatShortcut('mod+shift+z', false)).toBe('Ctrl+Shift+Z')
	})

	it('draws every modifier in the platform notation', () => {
		expect(formatShortcut('ctrl+alt+shift+meta+k', true)).toBe('⌃⌥⇧⌘K')
		expect(formatShortcut('ctrl+alt+shift+meta+k', false)).toBe('Ctrl+Alt+Shift+Meta+K')
	})

	it('treats control as ctrl without drawing it twice', () => {
		expect(formatShortcut('control+z', false)).toBe('Ctrl+Z')
		expect(formatShortcut('control+ctrl+z', false)).toBe('Ctrl+Z')
	})

	it('collapses mod onto an explicitly written modifier', () => {
		expect(formatShortcut('mod+ctrl+z', false)).toBe('Ctrl+Z')
		expect(formatShortcut('mod+meta+z', true)).toBe('⌘Z')
	})

	it('applies the library key aliases', () => {
		expect(formatShortcut('mod+esc', false)).toBe('Ctrl+Esc')
		expect(formatShortcut('mod+left', false)).toBe('Ctrl+←')
		expect(formatShortcut('mod+return', false)).toBe('Ctrl+Enter')
	})

	it('applies the aliases regardless of how they are cased', () => {
		// The library lowercases the whole chord before mapping, so an alias
		// written in caps still binds the canonical key and has to be drawn as one.
		expect(formatShortcut('mod+LEFT', false)).toBe('Ctrl+←')
		expect(formatShortcut('mod+Return', false)).toBe('Ctrl+Enter')
		expect(formatShortcut('ESC', true)).toBe('⎋')
	})

	it('strips the key/digit/numpad code prefixes the library strips', () => {
		expect(formatShortcut('mod+KeyZ', false)).toBe('Ctrl+Z')
		expect(formatShortcut('mod+Digit1', false)).toBe('Ctrl+1')
	})

	it('prefers mac glyphs for keys that have one', () => {
		expect(formatShortcut('mod+backspace', true)).toBe('⌘⌫')
		expect(formatShortcut('mod+backspace', false)).toBe('Ctrl+Backspace')
		expect(formatShortcut('escape', true)).toBe('⎋')
		expect(formatShortcut('escape', false)).toBe('Esc')
	})

	it('capitalizes keys with no dedicated label', () => {
		expect(formatShortcut('f5', false)).toBe('F5')
		expect(formatShortcut('mod+space', false)).toBe('Ctrl+Space')
	})

	it('renders sequences as their steps in order', () => {
		expect(formatShortcut('g>h', false)).toBe('G H')
		expect(formatShortcut('mod+k>mod+s', false)).toBe('Ctrl+K Ctrl+S')
	})

	it('tolerates whitespace, casing and stray separators', () => {
		expect(formatShortcut(' MOD + Shift + Z ', false)).toBe('Ctrl+Shift+Z')
		expect(formatShortcut('mod++z', false)).toBe('Ctrl+Z')
	})

	it('returns an empty string for an empty chord', () => {
		expect(formatShortcut('', false)).toBe('')
	})
})
