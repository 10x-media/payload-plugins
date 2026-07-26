import type { Field, PayloadRequest } from 'payload'
import { fieldNamesOfType } from '../../fields/fieldNamesOfType'
import { keys } from '../../translations/keys'
import { asTranslate, labelFor } from '../../translations/server'
import { firstAddress } from '../emailRecipients'
import { buildEmailAction, type EmailActionConfig, type EmailActionOptions } from './emailAction'

type ConfirmationConfig = EmailActionConfig & { toField?: string }

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
 * The `confirmation` action: its target is `toField`, naming the form's own email field the
 * confirmation is sent to (a `FieldNameSelect`, not a recipient list). The resolved address is
 * sanitized to a single one (dropping CR/LF header injection and any smuggled extra addresses); an
 * unset field or an unresolvable value is a silent skip. Everything else (from/cc/bcc/replyTo,
 * subject, body, localization) is the shared email-action skeleton.
 */
export const buildConfirmation = (options: EmailActionOptions) => {
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
	return buildEmailAction<ConfirmationConfig>(options, {
		type: 'confirmation',
		label: keys.actionConfirmation,
		target: () => toField,
		resolveTo: ({ config, resolve }) =>
			config.toField ? firstAddress(resolve(config.toField)) : '',
		hasTarget: (config) => Boolean(config.toField),
		onMissingTo: 'skip',
	})
}

export const confirmation = buildConfirmation({ localize: true })
