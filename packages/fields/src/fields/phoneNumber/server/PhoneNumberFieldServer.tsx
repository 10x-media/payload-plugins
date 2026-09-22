import type { GroupFieldServerProps, TextFieldServerProps } from 'payload'
import { PhoneNumberField } from '../client/PhoneNumberField'
import { PHONE_CUSTOM_KEY, type ResolvablePhoneFieldOptions } from '../options'
import { resolvePhoneOptionsSafe } from './resolvePhoneOptionsSafe'

type PhoneNumberFieldServerComponentProps = {
	phoneOptions?: ResolvablePhoneFieldOptions
} & (GroupFieldServerProps | TextFieldServerProps)

/**
 * The factory stamps only the field's own, unresolved option layer (see options.ts),
 * so this is the one place a registry default and a field override are both visible
 * together: resolution has to happen here, per request, not at config-build time.
 */
export const PhoneNumberFieldServer = (props: PhoneNumberFieldServerComponentProps) => {
	const { clientField, field, path, permissions, readOnly, req } = props
	const phoneOptions =
		props.phoneOptions ??
		(field.custom?.[PHONE_CUSTOM_KEY] as ResolvablePhoneFieldOptions | undefined)
	if (!phoneOptions) {
		const name = 'name' in field ? String(field.name) : ''
		throw new Error(
			`PhoneNumberFieldServer: field "${name}" has no phoneOptions clientProp and no custom['${PHONE_CUSTOM_KEY}']`
		)
	}
	const resolved = resolvePhoneOptionsSafe({ fieldOptions: phoneOptions, payload: req.payload })
	return (
		<PhoneNumberField
			field={clientField}
			path={path}
			permissions={permissions}
			phoneOptions={resolved}
			readOnly={readOnly}
		/>
	)
}
