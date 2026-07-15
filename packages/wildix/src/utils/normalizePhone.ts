import { parsePhoneNumber } from 'libphonenumber-js'

/**
 * Generates common display/storage variants of a phone number so that a single
 * Wildix number can match however a contact collection stored it: with plus,
 * without, with 00 IDD prefix, or in national local format with trunk prefix.
 *
 * Falls back to `[raw]` (plus the `+` variant) if the number cannot be parsed.
 */
export function normalizePhoneVariants(raw: string): string[] {
	const candidates = raw.startsWith('+') ? [raw] : [raw, `+${raw}`]

	for (const candidate of candidates) {
		try {
			const phone = parsePhoneNumber(candidate)
			const e164 = phone.format('E.164')
			const intlDigits = e164.replace(/\D/g, '')
			const nationalDigits = phone.format('NATIONAL').replace(/\D/g, '')
			return [...new Set([raw, e164, intlDigits, `00${intlDigits}`, nationalDigits])]
		} catch {
			// try next candidate
		}
	}

	return raw.startsWith('+') ? [raw] : [...new Set([raw, `+${raw}`])]
}
