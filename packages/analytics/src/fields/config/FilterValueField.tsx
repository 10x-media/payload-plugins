'use client'

import { TextInput, useConfig, useField, withCondition } from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type { TextFieldClientProps } from 'payload'
import {
	type ChangeEvent,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import { isDimensionKey } from '../../core/guards'
import { siblingPath } from '../../goals/amountField'
import { apiPath } from '../../plugin/apiPath'
import { analyticsRoutes } from '../../plugin/routes'
import { useTranslation } from '../../translations/useTranslation'
import { useRequestScope } from '../../ui/data/useRequestScope'
import { viewerNow } from '../../ui/viewerClock'
import { DIMENSION_LABELS, valueLabel } from '../../view/labels'
import {
	FILTER_HINT_KEYS,
	FILTER_VALUE_EXAMPLES,
	fetchFilterValues,
	suggestionMetric,
} from './filterValues'
import { useAnalyticsSources } from './useAnalyticsSources'
import { useFormString } from './useFormString'
import '../../ui/analytics.css'

/** @beta */
export type FilterValueFieldProps = TextFieldClientProps & {
	/**
	 * Path of the sibling source select this field reads its suggestions through, for custom
	 * widgets whose source field is named differently. Defaults to `'dataSource'`.
	 */
	sourceFieldPath?: string
	/** Path of the sibling dimension field. Defaults to the filter group's own `dimension`. */
	dimensionFieldPath?: string
	/** Path of the sibling operator field. Defaults to the filter group's own `operator`. */
	operatorFieldPath?: string
}

/**
 * Filter value input labelled by its dimension. Only `eq` gets top values as a datalist (typing
 * stays free); `contains` stays plain text, since a fragment is never one of the listed values.
 */
const FilterValueFieldComponent = (props: FilterValueFieldProps) => {
	const {
		field,
		path: pathFromProps,
		readOnly,
		sourceFieldPath = 'dataSource',
		dimensionFieldPath,
		operatorFieldPath,
	} = props
	const { t, i18n } = useTranslation()
	const { config } = useConfig()
	const queryEndpoint = apiPath(config, analyticsRoutes(config).query)
	const {
		customComponents: { AfterInput, BeforeInput, Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<string>({ potentiallyStalePath: pathFromProps })

	// Relative to this field, so a filter group nested in a custom widget finds its own siblings.
	const picked = useFormString(dimensionFieldPath ?? siblingPath(path, 'dimension'))
	const dimension = isDimensionKey(picked) ? picked : undefined
	const operator = useFormString(operatorFieldPath ?? siblingPath(path, 'operator'))
	const sourceId = useFormString(sourceFieldPath)
	const { sources } = useAnalyticsSources()
	const scope = useRequestScope()

	const source = useMemo(
		() =>
			sourceId === undefined ? undefined : sources?.find((candidate) => candidate.id === sourceId),
		[sources, sourceId]
	)
	const metric = dimension === undefined ? null : suggestionMetric({ dimension, source })
	const [suggestions, setSuggestions] = useState<string[]>([])
	const listId = useId()
	const wrapper = useRef<HTMLDivElement | null>(null)

	// Only `eq` matches a whole stored value, so only `eq` has a list of them to offer.
	const offers = dimension !== undefined && metric !== null && operator === 'eq'

	useEffect(() => {
		if (!offers || dimension === undefined || metric === null || scope === '') {
			setSuggestions([])
			return
		}
		const controller = new AbortController()
		fetchFilterValues({
			endpoint: queryEndpoint,
			scope,
			dimension,
			metric,
			...(sourceId ? { source: sourceId } : {}),
			now: viewerNow(),
		})
			.then((values) => {
				if (!controller.signal.aborted) setSuggestions(values)
			})
			.catch(() => {
				// A source that cannot answer leaves the plain input behind rather than an error:
				// the field still takes any value the reader types.
				if (!controller.signal.aborted) setSuggestions([])
			})
		return () => {
			controller.abort()
		}
	}, [dimension, metric, offers, queryEndpoint, scope, sourceId])

	// Payload's text field passes no `list`, so it is set here, unkeyed on purpose: a custom
	// Label or Error can mount the input a commit later, which a mount-once effect would miss.
	useLayoutEffect(() => {
		const element = wrapper.current?.querySelector('input')
		if (!element) {
			return
		}
		if (suggestions.length === 0) {
			element.removeAttribute('list')
			return
		}
		element.setAttribute('list', listId)
		return () => {
			element.removeAttribute('list')
		}
	})

	const style = useMemo(() => mergeFieldStyles(field), [field])
	const label = dimension === undefined ? field.label : t(DIMENSION_LABELS[dimension])
	const placeholder = dimension === undefined ? undefined : FILTER_VALUE_EXAMPLES[dimension]
	const description =
		dimension === undefined ? field.admin?.description : t(FILTER_HINT_KEYS[dimension])

	return (
		// The wrapper is what a row lays out, so it carries the field's width and style.
		<div className="analytics-filter-value" ref={wrapper} style={style}>
			<TextInput
				AfterInput={AfterInput}
				BeforeInput={BeforeInput}
				className={field.admin?.className}
				Description={Description}
				description={description}
				Error={ErrorComponent}
				Label={Label}
				label={label}
				localized={field.localized}
				onChange={(event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value)}
				path={path}
				{...(placeholder === undefined ? {} : { placeholder })}
				readOnly={readOnly || disabled || field.admin?.readOnly}
				required={field.required}
				showError={showError}
				value={value ?? ''}
			/>
			{suggestions.length > 0 && dimension !== undefined ? (
				<datalist id={listId}>
					{suggestions.map((suggestion) => (
						<option
							key={suggestion}
							label={valueLabel({
								dimension,
								value: suggestion,
								// The adapter id doubles as the provider name for the built-in sources,
								// which is what decides whether a `channel` value names a known bucket.
								provider: source?.id ?? '',
								t,
								locale: i18n.language,
							})}
							value={suggestion}
						/>
					))}
				</datalist>
			) : null}
		</div>
	)
}

/** @beta */
export const FilterValueField = withCondition(FilterValueFieldComponent)
