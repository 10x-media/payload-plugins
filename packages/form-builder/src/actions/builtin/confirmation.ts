import type { Field, PayloadRequest, RichTextField } from 'payload'
import type { DepartmentEmailsResolver } from '../../email/departments'
import { fieldNamesOfType } from '../../fields/fieldNamesOfType'
import { localizedIf } from '../../fields/localizedIf'
import { interpolate } from '../../recall/interpolate'
import { keys } from '../../translations/keys'
import { asTranslate, labelFor } from '../../translations/server'
import { resolverFor } from '../body/serializeBody'
import { defineAction } from '../defineAction'
import {
	buildRecipientField,
	firstAddress,
	type RecipientsConfig,
	resolveRecipients,
} from '../emailRecipients'
import { buildFromField, type FromAddressesResolver } from '../fromAddresses'

type ConfirmationConfig = {
	toField?: string
	from?: string
	cc?: string[]
	bcc?: string[]
	replyTo?: string[]
	subject?: string
	body?: unknown
}

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
 * `toField` names the form's own email field the confirmation is sent to (a `FieldNameSelect`, not a
 * recipient list). `replyTo`, `cc`, and `bcc` are recipient lists (`RecipientsSelect`, `string[]`):
 * literal emails, picked department addresses (when `departments` is set), or `{{field}}` tokens
 * resolved from the submission at send. `from` is a single address, added only when `fromAddresses`
 * is set. `subject`/`body` are content; `editor` overrides the body editor; `recipients` narrows the
 * recipient fields' behavior. Content and recipient fields carry `localized: true` when `localize`.
 */
// biome-ignore lint/complexity/useMaxParams: positional args thread plugin options (localize, editor, fromAddresses, departments, recipients)
export const buildConfirmation = (
	localize: boolean,
	editor?: RichTextField['editor'],
	fromAddresses?: FromAddressesResolver,
	departments?: DepartmentEmailsResolver,
	recipients?: RecipientsConfig
) => {
	const endpoint = departments ? 'departments' : undefined
	const recip = (name: string, labelKey: string) =>
		buildRecipientField(name, labelKey, localize, {
			endpoint,
			recipients,
			width: '50%',
			departments,
		})
	const toField: Field = {
		name: 'toField',
		type: 'text',
		label: labelFor(keys.actionConfigToField),
		admin: {
			width: '50%',
			components: {
				Field: {
					path: TO_FIELD_REF,
					clientProps: { types: ['email'], descriptionKey: keys.actionConfigToFieldDescription },
				},
			},
		},
		validate: validateToField,
	}
	return defineAction<ConfirmationConfig>({
		type: 'confirmation',
		label: keys.actionConfirmation,
		config: [
			{ type: 'row', fields: [toField, recip('replyTo', keys.actionConfigReplyTo)] },
			...(fromAddresses ? [buildFromField(fromAddresses)] : []),
			{
				type: 'row',
				fields: [recip('cc', keys.actionConfigCc), recip('bcc', keys.actionConfigBcc)],
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
				...(editor ? { editor } : {}),
			},
		],
		run: async (args) => {
			const { config, values, payload, renderBody } = args

			if (!config.toField) {
				return
			}

			const resolve = resolverFor(values)
			// Sanitize the visitor-resolved recipient to a single address (drops CR/LF header injection
			// and any extra addresses a crafted field value could smuggle in).
			const to = firstAddress(resolve(config.toField))

			if (!to) {
				return
			}

			if (typeof payload.sendEmail !== 'function') {
				throw new Error('confirmation: no email adapter configured')
			}

			const subject = interpolate(config.subject ?? '', resolve)
			const html = await renderBody(config.body)
			const cc = resolveRecipients(config.cc, resolve)
			const bcc = resolveRecipients(config.bcc, resolve)
			const replyTo = resolveRecipients(config.replyTo, resolve)

			// `from` was validated at save time against `fromAddresses(req)`; not re-checked here
			// (the job's `req` may differ from the authoring admin's, and the config is
			// admin-authored, not visitor-controlled), so the stored value is forwarded verbatim.
			await payload.sendEmail({
				to,
				subject,
				html,
				...(config.from ? { from: config.from } : {}),
				...(cc ? { cc } : {}),
				...(bcc ? { bcc } : {}),
				...(replyTo ? { replyTo } : {}),
			})
		},
	})
}

export const confirmation = buildConfirmation(true)
