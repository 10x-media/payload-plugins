import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineFormField } from '../defineFormField'
import { localizedIf } from '../localizedIf'

/**
 * Display-only inline rich text rendered between fields. Value kind `'none'`: the engine never
 * validates it and never writes it to submissions (its `name` exists only for block identity,
 * conditions targeting, and React keys). `content` is authored copy and follows `localize`.
 */
export const buildMessageField = (localize: boolean) =>
	defineFormField<'none'>({
		type: 'message',
		label: keys.fieldTypeMessage,
		value: 'none',
		config: [
			{
				name: 'content',
				type: 'richText',
				label: labelFor(keys.configContent),
				...localizedIf(localize),
			},
		],
	})

export const messageField = buildMessageField(true)
