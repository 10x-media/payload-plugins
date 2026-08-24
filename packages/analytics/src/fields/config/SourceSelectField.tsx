'use client'

import { type ReactSelectOption, SelectInput, useAuth, useConfig, useField } from '@payloadcms/ui'
import type { SelectFieldClientProps } from 'payload'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../translations/useTranslation'
import { fetchSources, type WireSource } from './fetchSources'
import { toSelectOption } from './toSelectOption'

/**
 * Source picker for scoped widget config: starts from the field's static
 * option list and, once the caller-scope sources endpoint answers, replaces
 * it with the live adapter list so a tenant only ever sees sources it can
 * actually read from. A failed fetch keeps the static list rather than
 * emptying the picker. Fetched sources are held on their own (not mirrored
 * into a synced "options" state), so a later locale change re-derives labels
 * without reverting an already-successful fetch back to the static list.
 */
export const SourceSelectField = (props: SelectFieldClientProps) => {
	const { field, path, readOnly } = props
	const { i18n } = useTranslation()
	const locale = i18n.language
	const { setValue, showError, value } = useField<string>({ path })
	const { user } = useAuth()
	const {
		config: {
			routes: { api },
			serverURL,
		},
	} = useConfig()

	const staticOptions = useMemo(
		() => field.options.map((option) => toSelectOption(option, locale)),
		[field.options, locale]
	)
	const [sources, setSources] = useState<WireSource[] | null>(null)
	const userKey = String(user?.id ?? '')

	useEffect(() => {
		if (!userKey) return
		let cancelled = false
		fetchSources(serverURL ?? '', api, userKey)
			.then((fetched) => {
				if (!cancelled) setSources(fetched)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [api, serverURL, userKey])

	const options =
		sources && sources.length > 0
			? sources.map((source) => ({ value: source.id, label: source.label }))
			: staticOptions

	return (
		<SelectInput
			isClearable={false}
			label={field.label}
			name={field.name}
			onChange={(selected: ReactSelectOption | ReactSelectOption[]) => {
				const option = Array.isArray(selected) ? selected[0] : selected
				setValue(option ? String(option.value) : null)
			}}
			options={options}
			path={path}
			readOnly={readOnly}
			required={field.required}
			showError={showError}
			value={value}
		/>
	)
}
