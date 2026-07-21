'use client'

import {
	FieldDescription,
	FieldError,
	FieldLabel,
	ReactSelect,
	type ReactSelectOption,
	RenderCustomComponent,
	useConfig,
	useDocumentInfo,
	useField,
	useFormFields,
} from '@payloadcms/ui'
import { reduceFieldsToValues } from 'payload/shared'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { isPlausibleEmail } from '../actions/emailRecipients'
import { fieldNames, fieldNamesOfType } from '../fields/fieldNamesOfType'
import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import {
	buildEndpointOptionsUrl,
	type EndpointOption,
	parseEndpointOptions,
} from './endpointOptions'
import type { FieldRow } from './synthesizeClientField'
import { toStaticLabel } from './toStaticLabel'

export type RecipientsSelectProps = {
	path?: string
	field?: { label?: unknown; required?: boolean; admin?: { description?: unknown; width?: string } }
	label?: unknown
	readOnly?: boolean
	/** Endpoint subpath supplying preset address options (e.g. `'departments'`); omit for none. */
	endpoint?: string
	/** Allow free-typed emails (default true). */
	allowCustom?: boolean
	/** Offer the form's own fields as recipient tokens (default true). */
	fieldTokens?: boolean
	/** Field types eligible as tokens (default `['email']`). */
	tokenFieldTypes?: string[]
	descriptionKey?: TranslationKey
}

type FetchState =
	| { status: 'error' | 'idle' | 'loading' }
	| { status: 'loaded'; options: EndpointOption[] }

const tokenOptionsFromData = (
	data: Record<string, unknown>,
	types?: string[]
): ReactSelectOption[] => {
	const rows = Array.isArray(data.fields) ? (data.fields as unknown[]) : []
	const labels = new Map<string, string>()
	for (const row of rows) {
		if (!row || typeof row !== 'object') {
			continue
		}
		const { name, label } = row as FieldRow
		if (typeof name === 'string' && typeof label === 'string' && label.length > 0) {
			labels.set(name.trim(), label)
		}
	}
	const names =
		types && types.length > 0 ? fieldNamesOfType(data.fields, types) : fieldNames(data.fields)
	return names.map((name) => ({ label: labels.get(name) ?? name, value: `{{${name}}}` }))
}

/**
 * A creatable, multi-value recipient field: pick a department (preset options from `endpoint`), pick a
 * form-field token (`{{field}}`, offered when `fieldTokens`), or type any email and press Enter
 * (`allowCustom`). Renders as native Payload badges (drag-reorderable), stores a `string[]`, honors
 * `admin.width` and the standard field props. Unknown or legacy stored values stay selectable.
 */
export const RecipientsSelect = (props: RecipientsSelectProps) => {
	const allowCustom = props.allowCustom !== false
	const fieldTokens = props.fieldTokens !== false
	const {
		customComponents: { Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<string[] | string>({ path: props.path })
	const { t } = useTranslation()
	const label = toStaticLabel(props.field?.label ?? props.label)
	const description = props.descriptionKey
		? t(props.descriptionKey)
		: toStaticLabel(props.field?.admin?.description)
	const { id, collectionSlug } = useDocumentInfo()
	const { config } = useConfig()
	const apiRoute = config.routes.api
	const readOnly = props.readOnly === true || disabled === true
	const [state, setState] = useState<FetchState>({ status: 'idle' })

	useEffect(() => {
		if (!props.endpoint || id == null || !collectionSlug) {
			return
		}
		const controller = new AbortController()
		const url = buildEndpointOptionsUrl({ apiRoute, collectionSlug, id, endpoint: props.endpoint })
		setState({ status: 'loading' })
		fetch(url, {
			credentials: 'include',
			headers: { Accept: 'application/json' },
			signal: controller.signal,
		})
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`Options request failed with ${response.status}`)
				}
				setState({ status: 'loaded', options: parseEndpointOptions(await response.json()) })
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					setState({ status: 'error' })
				}
			})
		return () => controller.abort()
	}, [apiRoute, collectionSlug, id, props.endpoint])

	const presetOptions: ReactSelectOption[] = state.status === 'loaded' ? state.options : []

	const tokenJson = useFormFields(([fields]) =>
		fieldTokens
			? JSON.stringify(
					tokenOptionsFromData(reduceFieldsToValues(fields, true), props.tokenFieldTypes)
				)
			: '[]'
	)
	const tokenOptions = useMemo(() => JSON.parse(tokenJson) as ReactSelectOption[], [tokenJson])

	const stored: string[] = Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
		: typeof value === 'string' && value.length > 0
			? [value]
			: []

	const byValue = useMemo(() => {
		const map = new Map<string, ReactSelectOption>()
		for (const option of [...presetOptions, ...tokenOptions]) {
			map.set(option.value as string, option)
		}
		return map
	}, [presetOptions, tokenOptions])

	const selected = stored.map((entry) => byValue.get(entry) ?? { label: entry, value: entry })

	const groupedOptions = useMemo(() => {
		const groups: { label: string; options: ReactSelectOption[] }[] = []
		if (presetOptions.length > 0) {
			groups.push({ label: t(keys.recipientsGroupDepartments), options: presetOptions })
		}
		if (tokenOptions.length > 0) {
			groups.push({ label: t(keys.recipientsGroupFields), options: tokenOptions })
		}
		return groups
	}, [presetOptions, tokenOptions, t])

	const handleChange = (selection: ReactSelectOption | ReactSelectOption[] | null) => {
		if (readOnly) {
			return
		}
		const chosen = Array.isArray(selection) ? selection : selection ? [selection] : []
		const entries = chosen
			.map((option) => String(option.value).trim())
			.filter((entry) => entry.length > 0 && (isPlausibleEmail(entry) || byValue.has(entry)))
		const deduped = new Map<string, string>()
		for (const entry of entries) {
			const key = entry.toLowerCase()
			if (!deduped.has(key)) {
				deduped.set(key, entry)
			}
		}
		setValue(Array.from(deduped.values()))
	}

	const fieldStyle = props.field?.admin?.width
		? ({ '--field-width': props.field.admin.width } as CSSProperties)
		: undefined

	return (
		<div
			className={['field-type', showError && 'error', readOnly && 'read-only']
				.filter(Boolean)
				.join(' ')}
			id={path ? `field-${path.replace(/\./g, '__')}` : undefined}
			style={{ marginBlockEnd: '1rem', ...fieldStyle }}
		>
			<RenderCustomComponent
				CustomComponent={Label}
				Fallback={<FieldLabel label={label} path={path} required={props.field?.required} />}
			/>
			<div className="field-type__wrap">
				<RenderCustomComponent
					CustomComponent={ErrorComponent}
					Fallback={<FieldError path={path} showError={showError} />}
				/>
				<ReactSelect
					options={groupedOptions}
					value={selected}
					isMulti
					isSortable
					isCreatable={allowCustom}
					isClearable={!readOnly}
					disabled={readOnly}
					isLoading={state.status === 'loading'}
					showError={showError}
					placeholder={state.status === 'loading' ? t(keys.endpointOptionsLoading) : undefined}
					onChange={handleChange}
					filterOption={(option, rawInput) => {
						if (!option) {
							return allowCustom && isPlausibleEmail(rawInput)
						}
						const query = rawInput.toLowerCase()
						return `${option.label} ${option.value}`.toLowerCase().includes(query)
					}}
				/>
			</div>
			<RenderCustomComponent
				CustomComponent={Description}
				Fallback={
					<FieldDescription
						description={state.status === 'error' ? t(keys.endpointOptionsError) : description}
						path={path}
					/>
				}
			/>
		</div>
	)
}
