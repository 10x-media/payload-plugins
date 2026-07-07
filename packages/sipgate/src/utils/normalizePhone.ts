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
	try {
		const phone = parsePhoneNumber(raw)
		const e164 = phone.format('E.164')
		const intlDigits = e164.replace(/\D/g, '')
		const nationalDigits = phone.format('NATIONAL').replace(/\D/g, '')
		return [...new Set([raw, e164, intlDigits, `00${intlDigits}`, nationalDigits])]
	} catch {
		return [raw]
	}
}
