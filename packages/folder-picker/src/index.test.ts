import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { folderPicker } from './index'
import { keys } from './translations'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

describe('folderPicker factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof folderPicker({})).toBe('function')
	})

	it('returns the incoming config when disabled', () => {
		const cfg = fakeConfig()
		expect(folderPicker({ disabled: true })(cfg)).toBe(cfg)
	})

	it('applies the translations option', () => {
		const out = folderPicker({ translations: { de: { [keys.pluginName]: 'Beispiel' } } })(
			fakeConfig()
		) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.folderPicker?.pluginName).toBe('Beispiel')
		expect(i18n.en?.folderPicker?.pluginName).toBe('Folder Picker')
	})
})
