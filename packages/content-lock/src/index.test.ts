import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { contentLock } from './index'
import { keys } from './translations'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

describe('contentLock factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof contentLock({})).toBe('function')
	})

	it('returns the incoming config when disabled', () => {
		const cfg = fakeConfig()
		expect(contentLock({ disabled: true })(cfg)).toBe(cfg)
	})

	it('applies the translations option', () => {
		const out = contentLock({ translations: { de: { [keys.pluginName]: 'Beispiel' } } })(
			fakeConfig()
		) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.contentLock?.pluginName).toBe('Beispiel')
		expect(i18n.en?.contentLock?.pluginName).toBe('Content Lock')
	})

	it('lets a group name the folders collection only when a collection uses folders', () => {
		const plugin = contentLock({
			groups: [{ key: 'library', label: 'Library', collections: ['payload-folders'] }],
		})
		expect(() => plugin(fakeConfig())).toThrow('unknown collection "payload-folders"')
		const withFolders = {
			collections: [{ slug: 'documents', fields: [], folders: true }],
		} as unknown as Config
		expect(() => plugin(withFolders)).not.toThrow()
	})
})
