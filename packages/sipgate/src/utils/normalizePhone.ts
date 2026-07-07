import { parsePhoneNumber } from 'libphonenumber-js'

/**
 * Generates common display/storage variants of an E.164 phone number so that
 * a single Sipgate number (always E.164) can match however a contact collection
 * chose to store it: with plus, without, with 00 IDD prefix, or in national
 * local format with trunk prefix.
 *
 * Falls back to `[raw]` if the number cannot be parsed (e.g. anonymous/unknown).
 */
export function normalizePhoneVariants(raw: string): string[] {
	// Sipgate stores numbers without the + prefix (e.g. "4983317568833").
	// Try the raw value first, then with + prepended so that both forms are
	// attempted regardless of how the number arrived.
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

	// Couldn't parse at all - return raw plus the + variant so at least both
	// storage forms are queried.
	return raw.startsWith('+') ? [raw] : [...new Set([raw, `+${raw}`])]
}
