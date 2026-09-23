import type { PhoneMetadata } from '../engine/metadata'
import {
	type CountryCode,
	callingCodeOf,
	digitCount,
	exceedsPhoneLength,
	formatAsYouType,
	isInternational,
	isPhoneInput,
	nationalPart,
	parsePhone,
	salvagePhone,
} from '../engine/phone'

/** What one commit boundary stores: the E.164 number and the country it was read under. */
export type PhoneEntry = { country: CountryCode | undefined; number: null | string }

/** `derived` marks a commit whose country came out of the number rather than off the row. */
export type PhoneCommit = PhoneEntry & { derived: boolean }

export const displayFor = (entry: PhoneEntry, metadata: null | PhoneMetadata): string => {
	if (!entry.number) return ''
	if (!metadata) return entry.number
	const parsed = parsePhone(entry.number, { defaultCountry: entry.country, metadata })
	return parsed ? nationalPart(parsed) : entry.number
}

/**
 * As-you-type only while appending at the end, where the caret already sits: a mid-string
 * edit or a deletion is stored exactly as typed, so the caret never moves under the viewer.
 * Null refuses the input outright, leaving the draft as it was.
 */
export const formatDraft = (args: {
	atEnd: boolean
	callingCode: string | undefined
	country: CountryCode | undefined
	metadata: null | PhoneMetadata
	previous: string
	raw: string
}): null | string => {
	const { atEnd, callingCode, country, metadata, previous, raw } = args
	if (!isPhoneInput(raw)) return null
	if (!metadata) return raw
	// The ceiling bounds typing. A bulk paste is let through so the blur salvage can still
	// recover a number out of a doubled or decorated one.
	const oneMore = raw.length === previous.length + 1 && digitCount(raw) > digitCount(previous)
	if (oneMore && exceedsPhoneLength(raw, { callingCode, defaultCountry: country, metadata })) {
		return null
	}
	if (!atEnd || raw.length <= previous.length) return raw
	if (isInternational(raw)) return formatAsYouType(raw, undefined, { metadata })
	if (callingCode === undefined) return raw
	const prefix = `+${callingCode}`
	const formatted = formatAsYouType(`${prefix}${raw}`, undefined, { metadata })
	return formatted.startsWith(prefix) ? formatted.slice(prefix.length).trimStart() : formatted
}

/**
 * An international draft carries its own calling code, which a picked country replaces. A draft
 * too short to parse still has to shed it, or the code left behind would name the country back.
 */
export const dropCallingCode = (draft: string, metadata: null | PhoneMetadata): string => {
	if (!metadata || !isInternational(draft)) return draft
	const parsed = parsePhone(draft, { metadata })
	if (parsed) return nationalPart(parsed)
	const callingCode = callingCodeOf(draft, { metadata })
	if (callingCode === undefined) return draft
	const digits = draft.replace(/\D/g, '')
	return digits.startsWith(callingCode) ? digits.slice(callingCode.length) : draft
}

export const resolveCommit = (args: {
	country: CountryCode | undefined
	draft: string
	isClearable: boolean
	lastValid: null | PhoneEntry
	metadata: null | PhoneMetadata
	picked: boolean
	salvage: boolean
}): PhoneCommit => {
	const { country, draft, isClearable, lastValid, metadata, picked, salvage } = args
	const trimmed = draft.trim()
	if (metadata === null) {
		return { country, derived: false, number: trimmed === '' ? null : trimmed }
	}
	const opts = { defaultCountry: country, metadata }
	const direct = parsePhone(trimmed, opts)
	const resolved = direct?.valid ? direct : salvage ? salvagePhone(trimmed, opts) : null
	if (resolved) {
		// A calling code several countries share reads back as whichever one owns the area code,
		// so re-reading it would undo the answer the viewer just gave the picker.
		const read = picked ? undefined : resolved.country
		return { country: read ?? country, derived: read !== undefined, number: resolved.e164 }
	}
	// isClearable false means the value cannot be removed, only replaced
	if (trimmed === '') {
		return !isClearable && lastValid
			? { ...lastValid, derived: true }
			: { country, derived: false, number: null }
	}
	return { country, derived: false, number: trimmed }
}
