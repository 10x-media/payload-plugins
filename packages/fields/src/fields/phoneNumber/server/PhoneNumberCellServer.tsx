import type { ClientField, DefaultServerCellComponentProps } from 'payload'
import { emojiFlag } from '../engine/countries'
import { loadMetadata } from '../engine/metadata'
import { type CountryCode, type ParsedPhone, type PhoneFormat, parsePhone } from '../engine/phone'
import { countryFlagSrc, type PhoneFlagMode, type ResolvablePhoneFieldOptions } from '../options'
import { readPhoneOptions } from './readPhoneOptions'
import { resolvePhoneOptionsSafe } from './resolvePhoneOptionsSafe'

type PhoneNumberCellRawValue = { country?: string; number?: string } | null | string | undefined

type PhoneNumberCellServerComponentProps = {
	phoneOptions?: ResolvablePhoneFieldOptions
} & DefaultServerCellComponentProps<ClientField, PhoneNumberCellRawValue>

const formatText = (parsed: null | ParsedPhone, raw: string, format: PhoneFormat): string => {
	if (!parsed) return raw
	if (format === 'e164') return parsed.e164
	return format === 'national' ? parsed.national : parsed.international
}

const renderFlag = (args: {
	code: CountryCode | undefined
	flags: PhoneFlagMode
	serverURL: string
	apiRoute: string
}) => {
	const { apiRoute, code, flags, serverURL } = args
	if (flags === 'none' || code === undefined) return null
	if (flags === 'emoji') return <span aria-hidden="true">{emojiFlag(code)}</span>
	return (
		<img
			alt=""
			aria-hidden="true"
			height={15}
			src={countryFlagSrc(serverURL, apiRoute, code)}
			width={20}
		/>
	)
}

/**
 * Formats entirely server-side: unlike measurement's cell, phone has no viewer
 * preference to react to, so this ships zero client JS for the list column.
 */
export const PhoneNumberCellServer = async (props: PhoneNumberCellServerComponentProps) => {
	const { cellData, field, payload } = props
	const phoneOptions = readPhoneOptions({
		component: 'PhoneNumberCellServer',
		field,
		propOptions: props.phoneOptions,
	})
	const resolved = resolvePhoneOptionsSafe({ fieldOptions: phoneOptions, payload })

	const raw = typeof cellData === 'string' ? cellData : (cellData?.number ?? '')
	if (raw === '') return null

	const storedCountry =
		typeof cellData === 'object' && cellData?.country
			? (cellData.country as CountryCode)
			: undefined
	// An async server component that throws has no error boundary of its own here; a rejected
	// chunk degrades this one cell to the raw value instead of failing the whole list page.
	let parsed: ParsedPhone | null = null
	try {
		const metadata = await loadMetadata(resolved.metadata)
		parsed = parsePhone(raw, { defaultCountry: storedCountry, metadata })
	} catch (error) {
		payload.logger.error(
			{ err: error },
			'[fields] phoneNumber metadata failed to load for a list cell'
		)
	}
	const country = parsed?.country ?? storedCountry

	return (
		<span style={{ alignItems: 'center', display: 'inline-flex', gap: 6 }}>
			{renderFlag({
				apiRoute: payload.config.routes.api,
				code: country,
				flags: resolved.flags,
				serverURL: payload.config.serverURL,
			})}
			<span>{formatText(parsed, raw, resolved.cellFormat)}</span>
		</span>
	)
}
