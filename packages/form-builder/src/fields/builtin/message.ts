import type { RichTextField } from 'payload'
import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineFormField } from '../defineFormField'
import { localizedIf } from '../localizedIf'

/**
 * Display-only inline rich text rendered between fields. Bare: the block is just the `content`
 * richText, no name/label/width/validation chrome, and instances are identified by their block
 * row id (see `fieldKey`). Value kind `'none'`: the engine never validates it and never writes it
 * to submissions. `content` is authored copy and follows `localize`; `editor`, when given,
 * overrides the host config's default richText editor (from the plugin's `richText.editor`).
 */
export const buildMessageField = (localize: boolean, editor?: RichTextField['editor']) =>
	defineFormField<'none'>({
		type: 'message',
		label: keys.fieldTypeMessage,
		value: 'none',
		bare: true,
		config: [
			{
				name: 'content',
				type: 'richText',
				label: labelFor(keys.configContent),
				...(editor ? { editor } : {}),
				...localizedIf(localize),
			},
		],
	})

export const messageField = buildMessageField(true)
