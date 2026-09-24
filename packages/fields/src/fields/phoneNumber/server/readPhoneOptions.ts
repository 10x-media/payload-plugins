import { PHONE_CUSTOM_KEY, type ResolvablePhoneFieldOptions } from '../options'

/** Both phone server components read the same two places, so they read them the same way. */
type PhoneOptionsSource = { custom?: Record<string, unknown>; name?: unknown }

/**
 * The field's own stamped option layer: the clientProp the factory threads through, or the
 * `custom` key a hand-authored config carries instead. Still unresolved, so the caller has
 * to put it through `resolvePhoneOptionsSafe` before rendering any chrome from it.
 */
export const readPhoneOptions = (args: {
	component: string
	field: PhoneOptionsSource
	propOptions: ResolvablePhoneFieldOptions | undefined
}): ResolvablePhoneFieldOptions => {
	const { component, field, propOptions } = args
	const options =
		propOptions ?? (field.custom?.[PHONE_CUSTOM_KEY] as ResolvablePhoneFieldOptions | undefined)
	if (options) return options
	const name = field.name === undefined ? '' : String(field.name)
	throw new Error(
		`${component}: field "${name}" has no phoneOptions clientProp and no custom['${PHONE_CUSTOM_KEY}']`
	)
}
