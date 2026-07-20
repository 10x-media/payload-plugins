import { parsePhoneNumber } from 'libphonenumber-js'

/**
 * Formats a phone number for sipgate Neo dial endpoints: E.164 digits only,
 * no leading `+` (e.g. `4915112345678`). Returns `undefined` when the input
 * cannot be parsed as a phone number (device IDs like `e4` fail here).
 */
export function toSipgateE164(raw: string | undefined | null): string | undefined {
	if (!raw) return undefined
	const trimmed = raw.trim()
	if (!trimmed) return undefined

	const attempts: Array<{ value: string; defaultCountry?: 'DE' }> = trimmed.startsWith('+')
		? [{ value: trimmed }]
		: [
				// Prefer treating digit-only input as already-international (sipgate form).
				{ value: `+${trimmed}` },
				{ value: trimmed, defaultCountry: 'DE' },
			]

	for (const { value, defaultCountry } of attempts) {
		try {
			const phone = defaultCountry
				? parsePhoneNumber(value, defaultCountry)
				: parsePhoneNumber(value)
			if (phone.isValid()) return phone.format('E.164').replace(/\D/g, '')
		} catch {
			// try next
		}
	}
	return undefined
}
