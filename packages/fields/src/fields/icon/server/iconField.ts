import type { TextField } from 'payload'
import { keys } from '../../../translations/keys'
import { labelForKey } from '../../../translations/server'
import type { IconAdapter, IconAvailabilityResolver } from '../../../types'
import { createIconValidate } from './validate'

export type IconFieldOptions = {
	name?: string
	label?: TextField['label']
	required?: boolean
	localized?: boolean
	/** Inline adapters; omit to use the plugin-registered set at runtime. */
	adapters?: IconAdapter[]
	defaultLibrary?: string
	/** Restricts selection only; stored values keep rendering through any registered adapter. */
	resolveAvailable?: IconAvailabilityResolver
	/** Show a free-text input next to the trigger for typing `library:icon-name` directly. Default false. */
	showTextInput?: boolean
	overrides?: (args: { field: TextField }) => TextField
}

/**
 * Text-backed icon field storing `<library>:<icon-name>`. Bare legacy names read
 * as the default library. Without the plugin, pass `adapters` inline; the admin
 * then also needs the adapters' components in `admin.dependencies` to render
 * glyphs (the plugin writes those itself).
 */
export const iconField = (options: IconFieldOptions = {}): TextField => {
	const field: TextField = {
		name: options.name ?? 'icon',
		type: 'text',
		label: options.label ?? labelForKey(keys.fieldIconLabel),
		...(options.localized === true ? { localized: true } : {}),
		...(options.required === true ? { required: true } : {}),
		validate: createIconValidate({
			adapters: options.adapters,
			defaultLibrary: options.defaultLibrary,
			required: options.required === true,
		}),
		admin: {
			components: {
				Cell: {
					path: '@10x-media/fields/rsc#IconCell',
					serverProps: {
						adapters: options.adapters,
						defaultLibrary: options.defaultLibrary,
					},
				},
				Field: {
					path: '@10x-media/fields/rsc#IconFieldServer',
					serverProps: {
						adapters: options.adapters,
						defaultLibrary: options.defaultLibrary,
						resolveAvailable: options.resolveAvailable,
						showTextInput: options.showTextInput === true,
					},
				},
			},
		},
	}
	return options.overrides ? options.overrides({ field }) : field
}
