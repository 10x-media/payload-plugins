import type { PayloadRequest, RichTextField } from 'payload'
import { fieldNamesOfType } from '../../fields/fieldNamesOfType'
import { localizedIf } from '../../fields/localizedIf'
import { interpolate } from '../../recall/interpolate'
import { keys } from '../../translations/keys'
import { asTranslate, labelFor } from '../../translations/server'
import { resolverFor } from '../body/serializeBody'
import { defineAction } from '../defineAction'
import { buildFromField, type FromAddressesResolver } from '../fromAddresses'

type ConfirmationConfig = { toField?: string; from?: string; subject?: string; body?: unknown }

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

/**
 * `subject` and `body` are email content and follow `localize`; `toField` is an identifier and
 * `from` an address, neither of which ever does. `editor` overrides the body field's
 * Lexical/richText editor (from the plugin's `richText.editor` option). `fromAddresses`, when
 * given (the plugin's `email.fromAddresses` option), adds a `from` select sourced from the host
 * resolver; absent, no `from` field exists and every send uses the email adapter's default sender.
 */
export const buildConfirmation = (
	localize: boolean,
	editor?: RichTextField['editor'],
	fromAddresses?: FromAddressesResolver
) =>
	defineAction<ConfirmationConfig>({
		type: 'confirmation',
		label: keys.actionConfirmation,
		config: [
			{
				name: 'toField',
				type: 'text',
				label: labelFor(keys.actionConfigToField),
				admin: {
					components: {
						Field: {
							path: TO_FIELD_REF,
							clientProps: {
								types: ['email'],
								descriptionKey: keys.actionConfigToFieldDescription,
							},
						},
					},
				},
				validate: validateToField,
			},
			...(fromAddresses ? [buildFromField(fromAddresses)] : []),
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
				...(editor ? { editor } : {}),
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

			// `from` was validated at save time against `fromAddresses(req)`; not re-checked here
			// (the job's `req` may differ from the authoring admin's, and the config is
			// admin-authored, not visitor-controlled), so the stored value is forwarded verbatim.
			await payload.sendEmail({
				to,
				subject,
				html,
				...(config.from ? { from: config.from } : {}),
			})
		},
	})

export const confirmation = buildConfirmation(true)
