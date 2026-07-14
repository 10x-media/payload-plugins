import type { PayloadRequest } from 'payload'
import { fieldNamesOfType } from '../../fields/fieldNamesOfType'
import { localizedIf } from '../../fields/localizedIf'
import { interpolate } from '../../recall/interpolate'
import { keys } from '../../translations/keys'
import { asTranslate, labelFor } from '../../translations/server'
import { resolverFor } from '../body/serializeBody'
import { defineAction } from '../defineAction'

type ConfirmationConfig = { toField?: string; subject?: string; body?: unknown }

const TO_FIELD_REF = '@10x-media/form-builder/client#FieldNameSelect'

/**
 * Validates the confirmation action's `toField`: unset is fine, otherwise it must name an
 * existing `email`-type field on the form. Exported for unit testing.
 */
export const validateToField = (
	value: unknown,
	{ data, req }: { data?: unknown; req: PayloadRequest }
): string | true => {
	if (typeof value !== 'string' || value.length === 0) {
		return true
	}
	const fields =
		data && typeof data === 'object' ? (data as Record<string, unknown>).fields : undefined
	return fieldNamesOfType(fields, ['email']).includes(value)
		? true
		: asTranslate(req.t)(keys.validationEmailFieldUnknown)
}

/** `subject` and `body` are email content and follow `localize`; `toField` is an identifier and never does. */
export const buildConfirmation = (localize: boolean) =>
	defineAction<ConfirmationConfig>({
		type: 'confirmation',
		label: keys.actionConfirmation,
		config: [
			{
				name: 'toField',
				type: 'text',
				label: labelFor(keys.actionConfigToField),
				admin: {
					description: labelFor(keys.actionConfigToFieldDescription),
					components: { Field: { path: TO_FIELD_REF, clientProps: { types: ['email'] } } },
				},
				validate: validateToField,
			},
			{
				name: 'subject',
				type: 'text',
				label: labelFor(keys.actionConfigSubject),
				...localizedIf(localize),
			},
			{
				name: 'body',
				type: 'richText',
				label: labelFor(keys.actionConfigBody),
				admin: { description: labelFor(keys.actionConfigBodyDescription) },
				...localizedIf(localize),
			},
		],
		run: async (args) => {
			const { config, values, payload, renderBody } = args

			if (!config.toField) {
				return
			}

			const resolve = resolverFor(values)
			const to = resolve(config.toField)

			if (!to) {
				return
			}

			if (typeof payload.sendEmail !== 'function') {
				throw new Error('confirmation: no email adapter configured')
			}

			const subject = interpolate(config.subject ?? '', resolve)
			const html = await renderBody(config.body)

			await payload.sendEmail({ to, subject, html })
		},
	})

export const confirmation = buildConfirmation(true)
