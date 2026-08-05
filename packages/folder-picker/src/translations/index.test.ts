import { describe, expect, it } from 'vitest'

import { toNested } from './index'

describe('toNested', () => {
	it('nests a namespaced key under its namespace', () => {
		expect(toNested({ 'folderPicker:pluginName': 'Folder Picker' })).toEqual({
			folderPicker: { pluginName: 'Folder Picker' },
		})
	})

	it('keeps the rest of the key intact when it carries more colons', () => {
		expect(toNested({ 'folderPicker:a:b': 'x' })).toEqual({ folderPicker: { 'a:b': 'x' } })
	})

	it('skips undefined values so partial override maps pass through', () => {
		expect(toNested({ 'folderPicker:pluginName': undefined })).toEqual({})
	})

	it('drops a key that carries no namespace rather than mangling it', () => {
		expect(toNested({ pluginName: 'x' })).toEqual({})
		expect(toNested({ ':pluginName': 'x' })).toEqual({})
	})
})
