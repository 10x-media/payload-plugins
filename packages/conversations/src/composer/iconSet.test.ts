import { describe, expect, it } from 'vitest'

import { composerIcon, defaultComposerIcons, resolveComposerIcons } from './iconSet'

describe('resolveComposerIcons', () => {
	it('keeps every default without icons', () => {
		expect(resolveComposerIcons()).toEqual(defaultComposerIcons)
	})

	it('lays given icons over the defaults and ignores undefined ones', () => {
		const Edit = () => null
		const icons = resolveComposerIcons({ linkEdit: Edit, more: undefined })
		expect(icons.linkEdit).toBe(Edit)
		expect(icons.more).toBe(defaultComposerIcons.more)
		expect(icons.bold).toBe(defaultComposerIcons.bold)
	})

	it('does not change the defaults', () => {
		resolveComposerIcons({ bold: () => null })
		expect(resolveComposerIcons().bold).toBe(defaultComposerIcons.bold)
	})
})

describe('composerIcon', () => {
	it('returns one stable component per role', () => {
		expect(composerIcon('bold')).toBe(composerIcon('bold'))
		expect(composerIcon('bold')).not.toBe(composerIcon('italic'))
	})
})
