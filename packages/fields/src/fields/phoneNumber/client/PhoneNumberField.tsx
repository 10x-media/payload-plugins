'use client'

import {
	FieldDescription,
	FieldError,
	FieldLabel,
	fieldBaseClass,
	RenderCustomComponent,
	useField,
	useForm,
	useFormFields,
	XIcon,
} from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type { GroupFieldClientProps, StaticLabel, TextFieldClientProps } from 'payload'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keys } from '../../../translations/keys'
import { useTranslation } from '../../../translations/useTranslation'
import { resolveStaticLabel } from '../../../utils/resolveStaticLabel'
import { callingCodeFor, countryOptions } from '../engine/countries'
import { loadMetadata, type PhoneMetadata } from '../engine/metadata'
import {
	type CountryCode,
	callingCodeOf,
	detectCountry,
	digitCount,
	exceedsPhoneLength,
	formatAsYouType,
	isInternational,
	isPhoneInput,
	nationalPart,
	type PhoneSeed,
	parsePhone,
	provisionalCountry,
	salvagePhone,
} from '../engine/phone'
import type { PhoneClientOptions } from '../options'
import { type CountryOptionGroups, CountryPicker } from './CountryPicker'
import './phoneNumberField.css'

const baseClass = 'fields-phone'
const COMMIT_DELAY = 250
const NO_COUNTRIES: CountryOptionGroups = { preferred: [], rest: [] }

/** What one commit boundary stores: the E.164 number and the country it was read under. */
type PhoneEntry = { country: CountryCode | undefined; number: null | string }

/**
 * Payload copies `required` and `admin.placeholder` onto the client field at runtime, but
 * `GroupFieldClient` types neither; the e164 variant is a `TextFieldClient` and types both.
 */
type PhonePassthrough = {
	admin?: { placeholder?: StaticLabel; readOnly?: boolean }
	required?: boolean
}

const displayFor = (entry: PhoneEntry, metadata: null | PhoneMetadata): string => {
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
const formatDraft = (args: {
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
const dropCallingCode = (draft: string, metadata: null | PhoneMetadata): string => {
	if (!metadata || !isInternational(draft)) return draft
	const parsed = parsePhone(draft, { metadata })
	if (parsed) return nationalPart(parsed)
	const callingCode = callingCodeOf(draft, { metadata })
	if (callingCode === undefined) return draft
	const digits = draft.replace(/\D/g, '')
	return digits.startsWith(callingCode) ? digits.slice(callingCode.length) : draft
}

/** `derived` marks a commit whose country came out of the number rather than off the row. */
type PhoneCommit = PhoneEntry & { derived: boolean }

const resolveCommit = (args: {
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

/** A group under object storage, a text field under e164; the row is identical either way. */
export type PhoneNumberFieldProps = {
	field: GroupFieldClientProps['field'] | TextFieldClientProps['field']
	phoneOptions: PhoneClientOptions
	/** The stored row as the server already split it, painted until metadata lands. */
	seed?: null | PhoneSeed
} & Omit<GroupFieldClientProps, 'field'>

/**
 * One 40px row holding the country trigger, the calling-code prefix, a borderless entry and
 * a clear affordance. `phoneOptions` must already be resolved through `resolvePhoneOptionsSafe`:
 * the field's own stamped layer carries no defaults and would render the wrong chrome.
 */
export const PhoneNumberField: React.FC<PhoneNumberFieldProps> = (props) => {
	const { field, path, phoneOptions, readOnly: readOnlyFromProps, seed } = props
	const { admin: { className, description } = {}, label, localized } = field
	const passthrough: PhonePassthrough = field
	const { placeholder, readOnly: readOnlyFromAdmin } = passthrough.admin ?? {}
	const required = passthrough.required ?? false
	const {
		countries,
		defaultCountry,
		flags,
		isClearable,
		metadata: metadataSet,
		preferredCountries,
		storage,
	} = phoneOptions

	const { i18n, t } = useTranslation()
	const { dispatchFields, setModified } = useForm()
	const {
		customComponents: { AfterInput, BeforeInput, Description, Error: ErrorComponent, Label } = {},
		disabled,
		errorPaths,
		formSubmitted,
		setValue,
		showError,
		value,
	} = useField<null | string>({ path })

	// Form state is flat by path: the group entry carries no value, so each subfield is read
	// at its own path and written there too.
	const numberPath = `${path}.number`
	const countryPath = `${path}.country`
	const numberState = useFormFields(([fields]) => fields?.[numberPath]?.value)
	const countryState = useFormFields(([fields]) => fields?.[countryPath]?.value)

	const [metadata, setMetadata] = useState<null | PhoneMetadata>(null)
	useEffect(() => {
		let active = true
		loadMetadata(metadataSet)
			.then((loaded) => {
				if (active) setMetadata(loaded)
			})
			// A failed load degrades to unformatted entry; loadMetadata retries on a later mount
			.catch(() => undefined)
		return () => {
			active = false
		}
	}, [metadataSet])

	const isE164 = storage === 'e164'
	const [pickedCountry, setPickedCountry] = useState<CountryCode | undefined>(undefined)

	const rawStored = isE164 ? value : numberState
	const storedNumber = typeof rawStored === 'string' ? rawStored : ''

	// e164 storage has no country subfield, so the country is read back out of the number
	const storedCountry = useMemo<CountryCode | undefined>(() => {
		if (!isE164) return typeof countryState === 'string' ? (countryState as CountryCode) : undefined
		if (!metadata || storedNumber === '') return undefined
		return parsePhone(storedNumber, { defaultCountry: pickedCountry ?? defaultCountry, metadata })
			?.country
	}, [countryState, defaultCountry, isE164, metadata, pickedCountry, storedNumber])

	// The server's own derivation of the row, painted until the lazy metadata import lands so the
	// prefix and the entry never reflow. It describes one stored number, hence the match.
	const seeded = metadata === null && seed?.number === storedNumber ? seed : null

	const display = useMemo(
		() =>
			seeded?.national ??
			displayFor({ country: storedCountry, number: storedNumber || null }, metadata),
		[metadata, seeded, storedCountry, storedNumber]
	)
	const [draft, setDraft] = useState(display)
	const editingRef = useRef(false)
	useEffect(() => {
		if (!editingRef.current) setDraft(display)
	}, [display])

	// The validated read refines the provisional one: `+1` is the United States on sight, and
	// stays so until enough digits arrive for libphonenumber to name Canada instead.
	const draftCountry = useMemo(
		() =>
			metadata && isInternational(draft)
				? (detectCountry(draft, { metadata }) ?? provisionalCountry(draft, { metadata }))
				: undefined,
		[draft, metadata]
	)
	// The pick outranks the stored country because e164 storage has no country column to write
	// it to: there the stored country is re-read off the number, which cannot know about a pick.
	const country =
		draftCountry ?? pickedCountry ?? storedCountry ?? seeded?.country ?? defaultCountry

	const countriesKey = countries?.join()
	const preferredKey = preferredCountries?.join()
	// biome-ignore lint/correctness/useExhaustiveDependencies: a form-state round trip hands the same allowlist back as a new array, so the contents are the dependency, not the identity
	const options = useMemo(
		() =>
			metadata
				? countryOptions({ countries, locale: i18n.language, metadata, preferredCountries })
				: NO_COUNTRIES,
		[countriesKey, i18n.language, metadata, preferredKey]
	)
	// Off the country, not off `options`: an allowlist that does not offer the stored country
	// would otherwise drop the prefix once metadata lands, reflowing the row back.
	const callingCode = useMemo(
		() =>
			(country && metadata ? callingCodeFor(country, metadata) : undefined) ?? seeded?.callingCode,
		[country, metadata, seeded]
	)

	// The revert target for a non-clearable commit, tracked from stored values so a picked
	// country, a document load and a save response all count.
	const lastValidRef = useRef<null | PhoneEntry>(null)
	useEffect(() => {
		if (storedNumber === '' || !metadata) return
		if (parsePhone(storedNumber, { defaultCountry: storedCountry, metadata })?.valid) {
			lastValidRef.current = { country: storedCountry, number: storedNumber }
		}
	}, [metadata, storedCountry, storedNumber])

	const write = useCallback(
		(entry: PhoneEntry) => {
			if (isE164) {
				setValue(entry.number)
				return
			}
			dispatchFields({ type: 'UPDATE', path: numberPath, value: entry.number })
			dispatchFields({ type: 'UPDATE', path: countryPath, value: entry.country ?? null })
			// dispatchFields, unlike setValue, leaves the form unmodified
			setModified(true)
		},
		[countryPath, dispatchFields, isE164, numberPath, setModified, setValue]
	)

	const commit = useCallback(
		(raw: string, opts: { country?: CountryCode; salvage?: boolean } = {}): PhoneEntry => {
			const { derived, ...entry } = resolveCommit({
				country: opts.country ?? country,
				draft: raw,
				isClearable,
				lastValid: lastValidRef.current,
				metadata,
				picked: opts.country !== undefined,
				salvage: opts.salvage === true,
			})
			// A pick speaks for the country only until the value speaks for itself, or it would
			// keep overriding every number committed after it.
			if (derived) setPickedCountry(undefined)
			write(entry)
			return entry
		},
		[country, isClearable, metadata, write]
	)

	const debounceRef = useRef<null | ReturnType<typeof setTimeout>>(null)
	const cancelPending = useCallback(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current)
		debounceRef.current = null
	}, [])
	useEffect(() => cancelPending, [cancelPending])

	const onChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const input = event.target
			const raw = input.value
			const caret = input.selectionStart
			const next = formatDraft({
				atEnd: caret === null || caret === raw.length,
				callingCode,
				country,
				metadata,
				previous: draft,
				raw,
			})
			if (next === null) {
				// React re-renders nothing when the state is unchanged, so the refused line is put
				// back here, with the caret where the refused characters would have gone.
				const at = Math.max((caret ?? raw.length) - (raw.length - draft.length), 0)
				input.value = draft
				input.setSelectionRange(at, at)
				return
			}
			editingRef.current = true
			setDraft(next)
			cancelPending()
			debounceRef.current = setTimeout(() => commit(next), COMMIT_DELAY)
		},
		[callingCode, cancelPending, commit, country, draft, metadata]
	)

	const onBlur = useCallback(() => {
		cancelPending()
		if (!editingRef.current) return
		editingRef.current = false
		setDraft(displayFor(commit(draft, { salvage: true }), metadata))
	}, [cancelPending, commit, draft, metadata])

	const selectCountry = useCallback(
		(code: CountryCode) => {
			cancelPending()
			editingRef.current = false
			setPickedCountry(code)
			const entry = commit(dropCallingCode(draft, metadata), { country: code })
			setDraft(displayFor(entry, metadata))
		},
		[cancelPending, commit, draft, metadata]
	)

	// The clear control unmounts on the same commit that empties the field, so focus moves to
	// the input first; otherwise a keyboard viewer is dropped back to the document body.
	const inputRef = useRef<HTMLInputElement>(null)
	const onClear = useCallback(() => {
		cancelPending()
		editingRef.current = false
		setPickedCountry(undefined)
		setDraft('')
		write({ country: undefined, number: null })
		inputRef.current?.focus()
	}, [cancelPending, write])

	// renderField only maps permissions into the readOnly clientProp; admin.readOnly reaches
	// custom Field components solely via clientField.admin
	const isReadOnly = Boolean(readOnlyFromProps || disabled || readOnlyFromAdmin)
	// A child subfield's error marks the group invalid without giving it a message of its own
	const hasError = showError || (formSubmitted && (errorPaths?.length ?? 0) > 0)
	const showClear = isClearable && !required && !isReadOnly && (draft !== '' || storedNumber !== '')
	const showPrefix = callingCode !== undefined && !isInternational(draft)
	const styles = useMemo(() => mergeFieldStyles(field), [field])

	return (
		<div
			className={[
				fieldBaseClass,
				baseClass,
				className,
				hasError && 'error',
				isReadOnly && 'read-only',
			]
				.filter(Boolean)
				.join(' ')}
			style={styles}
		>
			<RenderCustomComponent
				CustomComponent={Label}
				Fallback={
					<FieldLabel label={label} localized={localized} path={path} required={required} />
				}
			/>
			<div className={`${fieldBaseClass}__wrap`}>
				<RenderCustomComponent
					CustomComponent={ErrorComponent}
					Fallback={<FieldError path={path} showError={hasError} />}
				/>
				{BeforeInput}
				<div className={`${baseClass}__container`}>
					<CountryPicker
						disabled={isReadOnly || metadata === null}
						flags={flags}
						onSelect={selectCountry}
						options={options}
						value={country}
					/>
					{showPrefix ? <span className={`${baseClass}__prefix`}>{`+${callingCode}`}</span> : null}
					<input
						className={`${baseClass}__input`}
						id={`field-${path.replace(/\./g, '__')}`}
						inputMode="tel"
						name={path}
						onBlur={onBlur}
						onChange={onChange}
						placeholder={resolveStaticLabel(placeholder, i18n.language)}
						readOnly={isReadOnly}
						ref={inputRef}
						type="tel"
						value={draft}
					/>
					{showClear ? (
						<button
							aria-label={t(keys.clearPhoneNumber)}
							className={`${baseClass}__clear`}
							onClick={onClear}
							type="button"
						>
							<XIcon />
						</button>
					) : null}
				</div>
				{AfterInput}
				<RenderCustomComponent
					CustomComponent={Description}
					Fallback={<FieldDescription description={description} path={path} />}
				/>
			</div>
		</div>
	)
}
