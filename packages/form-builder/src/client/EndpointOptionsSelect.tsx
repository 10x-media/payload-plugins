'use client'

import {
	FieldDescription,
	FieldLabel,
	ReactSelect,
	type ReactSelectOption,
	useConfig,
	useDocumentInfo,
	useField,
} from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import {
	buildEndpointOptionsUrl,
	type EndpointOption,
	parseEndpointOptions,
} from './endpointOptions'
import { toStaticLabel } from './toStaticLabel'

/** Standard text-field client props plus this component's `clientProps`. */
export type EndpointOptionsSelectProps = {
	/** The field path within the document (Payload-injected, not the endpoint path). */
	path?: string
	field?: { label?: unknown; admin?: { description?: unknown } }
	label?: unknown
	/**
	 * Endpoint subpath under the current document's collection API route; `'poll-options'` fetches
	 * `GET {routes.api}/{collectionSlug}/{id}/poll-options`. The endpoint must return
	 * `{ options: { label, value }[] }`.
	 */
	endpoint: string
	/**
	 * Field description as a translation key, resolved client-side. Payload drops `admin.description`
	 * functions from client fields, so a translated description must travel as a key; a static
	 * `admin.description` string still renders when this is unset.
	 */
	descriptionKey?: TranslationKey
	/** Mirrors ReactSelect's `isClearable`; defaults to true. */
	isClearable?: boolean
	/**
	 * Render a multi-value select bound to a `string[]`, for a `hasMany` field (e.g. a poll outcome
	 * with tied winners). Default false: a single-value select bound to a `string`.
	 */
	isMulti?: boolean
}

type FetchState =
	| { status: 'error' | 'idle' | 'loading'; options?: never }
	| { status: 'loaded'; options: EndpointOption[] }

/**
 * A select whose options load from a document-scoped plugin endpoint, for stored values whose
 * valid choices only the server knows (e.g. a poll's source-resolved options). The pattern: pass
 * `endpoint` via `clientProps`, the component reads the document id from `useDocumentInfo` and the
 * API route from `useConfig`, fetches once per document with the admin cookie, and renders
 * translated loading/error states. The stored value stays selectable even when it is missing from
 * the fetched options (or the fetch failed), so opening an old document never silently drops data;
 * unsaved documents skip the fetch since the server cannot resolve options for them yet.
 */
export const EndpointOptionsSelect = (props: EndpointOptionsSelectProps) => {
	const isMulti = props.isMulti === true
	const { path, setValue, value } = useField<string | string[]>({ path: props.path })
	const label = toStaticLabel(props.field?.label ?? props.label)
	const { t } = useTranslation()
	const description = props.descriptionKey
		? t(props.descriptionKey)
		: toStaticLabel(props.field?.admin?.description)
	const { id, collectionSlug } = useDocumentInfo()
	const { config } = useConfig()
	const apiRoute = config.routes.api
	const [state, setState] = useState<FetchState>({ status: 'idle' })

	useEffect(() => {
		if (id == null || !collectionSlug) {
			return
		}
		const controller = new AbortController()
		const url = buildEndpointOptionsUrl({
			apiRoute,
			collectionSlug,
			id,
			endpoint: props.endpoint,
		})
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

	// A missing fetched option (or a failed fetch) must never silently drop a stored value, so every
	// selected value the options don't cover is kept selectable by its own label.
	const selectedValues: string[] = isMulti
		? Array.isArray(value)
			? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
			: []
		: typeof value === 'string' && value.length > 0
			? [value]
			: []
	const options: ReactSelectOption[] = state.status === 'loaded' ? state.options : []
	const missing = selectedValues
		.filter((selected) => !options.some((option) => option.value === selected))
		.map((selected) => ({ label: selected, value: selected }))
	const allOptions = missing.length > 0 ? [...options, ...missing] : options
	const selectedOptions = selectedValues
		.map((selected) => allOptions.find((option) => option.value === selected))
		.filter((option): option is ReactSelectOption => option !== undefined)

	const handleChange = (selected: ReactSelectOption | ReactSelectOption[] | null) => {
		if (isMulti) {
			const chosen = Array.isArray(selected) ? selected : selected ? [selected] : []
			setValue(chosen.map((option) => option.value as string))
			return
		}
		const chosen = Array.isArray(selected) ? selected[0] : selected
		setValue(chosen ? (chosen.value as string) : '')
	}

	return (
		<div className="field-type" style={{ marginBlockEnd: '1rem' }}>
			<FieldLabel label={label} path={path} />
			<ReactSelect
				options={allOptions}
				value={isMulti ? selectedOptions : (selectedOptions[0] ?? undefined)}
				isMulti={isMulti}
				isClearable={props.isClearable !== false}
				isLoading={state.status === 'loading'}
				placeholder={state.status === 'loading' ? t(keys.endpointOptionsLoading) : undefined}
				showError={state.status === 'error'}
				onChange={handleChange}
			/>
			<FieldDescription
				description={state.status === 'error' ? t(keys.endpointOptionsError) : description}
				path={path}
			/>
		</div>
	)
}
