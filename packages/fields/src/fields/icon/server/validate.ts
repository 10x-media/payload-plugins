import type { TextFieldValidation } from 'payload'
import { text } from 'payload/shared'
import { getFieldsRegistry } from '../../../plugin/registry'
import { keys } from '../../../translations/keys'
import { asTranslate } from '../../../translations/server'
import type { IconAdapter } from '../../../types'
import { resolveIconValue } from '../shared/value'
import { loadManifestNames } from './manifestCache'

export type CreateIconValidateArgs = {
	adapters?: IconAdapter[]
	defaultLibrary?: string
	required: boolean
}

/**
 * Unregistered library: always an error. Unknown name in a known library:
 * error only for changed values, so stored docs stay saveable after an icon
 * set upgrade drops a glyph.
 */
export const createIconValidate =
	(args: CreateIconValidateArgs): TextFieldValidation =>
	async (value, options) => {
		// The sanitized field is spread into the options, so a `required` added
		// through `overrides` wins over the flag captured when the factory ran.
		const required = options.required ?? args.required
		if (value != null && value !== '') {
			const registry = getFieldsRegistry(options.req.payload.config)
			const registered = args.adapters ?? registry?.icon?.adapters ?? []
			const defaultLibrary =
				args.defaultLibrary ?? registry?.icon?.defaultLibrary ?? registered[0]?.slug ?? ''
			const { library, name } = resolveIconValue(value, defaultLibrary)
			const adapter = registered.find((candidate) => candidate.slug === library)
			const t = asTranslate(options.req.t)
			if (!adapter) {
				return t(keys.invalidIconLibrary, { library })
			}
			if (value !== options.previousValue) {
				const names = await loadManifestNames(adapter)
				if (!names.has(name)) {
					return t(keys.invalidIconName, { library, name })
				}
			}
		}
		return text(value, { ...options, required })
	}
