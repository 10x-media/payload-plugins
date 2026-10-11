import type { GroupFieldServerProps, TextFieldServerProps } from 'payload'
import { PhoneNumberField } from '../client/PhoneNumberField'
import { type PhoneSeed, phoneSeed } from '../engine/draft'
import { loadMetadata } from '../engine/metadata'
import type { ResolvablePhoneFieldOptions } from '../options'
import { readPhoneOptions } from './readPhoneOptions'
import { resolvePhoneOptionsSafe } from './resolvePhoneOptionsSafe'

type PhoneNumberFieldServerComponentProps = {
	phoneOptions?: ResolvablePhoneFieldOptions
} & (GroupFieldServerProps | TextFieldServerProps)

/** The stored E.164 string, under either storage shape, or '' when the field is empty. */
const storedNumber = (sibling: unknown, name: string): string => {
	if (typeof sibling !== 'object' || sibling === null) return ''
	const own = (sibling as Record<string, unknown>)[name]
	if (typeof own === 'string') return own
	if (typeof own !== 'object' || own === null) return ''
	const inner = (own as Record<string, unknown>).number
	return typeof inner === 'string' ? inner : ''
}

/**
 * The factory stamps only the field's own, unresolved option layer (see options.ts),
 * so this is the one place a registry default and a field override are both visible
 * together: resolution has to happen here, per request, not at config-build time.
 */
export const PhoneNumberFieldServer = async (props: PhoneNumberFieldServerComponentProps) => {
	const { clientField, field, path, permissions, readOnly, req, siblingData } = props
	const phoneOptions = readPhoneOptions({
		component: 'PhoneNumberFieldServer',
		field,
		propOptions: props.phoneOptions,
	})
	const resolved = resolvePhoneOptionsSafe({ fieldOptions: phoneOptions, payload: req.payload })
	// cellFormat belongs to the list cell and validation is decided server-side; shipping
	// either would put a value in every field's clientProps that nothing there may read.
	const { cellFormat, validation, ...clientOptions } = resolved

	// Metadata is free here and lazy on the client, so the split row is derived once on the
	// server and handed over: without it the first client frame paints the raw E.164 and reflows.
	const raw = 'name' in field ? storedNumber(siblingData, String(field.name)) : ''
	let seed: null | PhoneSeed = null
	if (raw !== '') {
		try {
			const metadata = await loadMetadata(resolved.metadata)
			seed = phoneSeed(raw, { defaultCountry: resolved.defaultCountry, metadata })
		} catch (error) {
			req.payload.logger.error(
				{ err: error },
				'[fields] phoneNumber metadata failed to load for a field seed'
			)
			// The seed is an optimization; a failed load degrades the first frame, never the view
			seed = null
		}
	}

	return (
		<PhoneNumberField
			field={clientField}
			path={path}
			permissions={permissions}
			phoneOptions={clientOptions}
			readOnly={readOnly}
			seed={seed}
		/>
	)
}
