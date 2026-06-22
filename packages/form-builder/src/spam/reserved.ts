import type { SubmissionValue } from '../submissions/types'
import { CAPTCHA_TOKEN_KEY } from './constants'

export type ExtractedReserved = {
	/** Real field values with reserved entries removed. */
	cleaned: SubmissionValue[]
	/** The honeypot decoy value, if a honeypot field name was active and present. */
	honeypot?: unknown
	/** A captcha token carried by the client. */
	captchaToken?: string
}

/**
 * Split reserved entries (honeypot decoy, captcha token) out of the submitted `values`. The honeypot
 * rides a configurable, innocuous field name; the captcha token rides a fixed reserved key. Real field
 * values pass through unchanged. `runSubmission` would already ignore unknown field names, but stripping
 * here keeps them out of storage and out of the validation pass.
 */
export const extractReservedValues = (
	values: SubmissionValue[],
	honeypotField: string | null
): ExtractedReserved => {
	const cleaned: SubmissionValue[] = []
	const result: ExtractedReserved = { cleaned }
	for (const entry of values) {
		if (entry.field === CAPTCHA_TOKEN_KEY) {
			if (typeof entry.value === 'string') {
				result.captchaToken = entry.value
			}
			continue
		}
		if (honeypotField !== null && entry.field === honeypotField) {
			result.honeypot = entry.value
			continue
		}
		cleaned.push(entry)
	}
	return result
}

/** A honeypot is tripped when the decoy carries any non-empty value (a real user never fills it). */
export const isHoneypotTripped = (value: unknown): boolean =>
	value != null && value !== '' && !(Array.isArray(value) && value.length === 0)
