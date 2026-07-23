'use client'

import { createElement, useId } from 'react'
import { calcExpressionOf } from '../calc/computeCalcFields'
import { fieldKey, isNamedField, type NamedFormFieldInstance } from '../fields/fieldKey'
import type { RecallResolver } from '../recall/resolver'
import type { FormFieldInstance } from '../submissions/types'
import type { FieldRenderer, RendererTranslate } from './contract'
import { useFormContext } from './FormContext'
import { type FieldWidth, FormLayout, widthProps } from './FormLayout'
import { applyRecall } from './recall'
import { useField } from './useField'

const FIELD_WIDTHS = new Set<string>(['full', 'half', 'third', 'twoThirds'])

/** Fallback when no recall resolver is on the context (a hand-built provider); returns the token name unchanged. */
const identityRecall: RecallResolver = (name) => name

type FieldHostProps = {
	field: NamedFormFieldInstance
	renderer: FieldRenderer
	locale: string
	t: RendererTranslate
}

const FieldHost = ({ field, renderer, locale, t }: FieldHostProps) => {
	const id = useId()
	const { value, errors, setValue, onBlur } = useField(field.name)
	return createElement(renderer, {
		field,
		id,
		name: field.name,
		value,
		onChange: setValue,
		onBlur,
		errors,
		required: Boolean(field.required),
		locale,
		t,
	})
}

type CalcFieldHostProps = FieldHostProps & { value: unknown }

/** Hosts a derived (calc) field: read-only, value supplied from `effectiveValues`, never bound via `useField`. */
const CalcFieldHost = ({ field, renderer, value, locale, t }: CalcFieldHostProps) => {
	const id = useId()
	return createElement(renderer, {
		field,
		id,
		name: field.name,
		value,
		onChange: () => {},
		onBlur: () => {},
		errors: [],
		required: false,
		disabled: true,
		locale,
		t,
	})
}

type StaticFieldHostProps = Omit<FieldHostProps, 'field'> & { field: FormFieldInstance }

/**
 * Hosts a nameless (bare) display block, e.g. a message: no `useField` binding at all. The
 * renderer reads only the instance and the form context; `name` is the row key for consistency.
 */
const StaticFieldHost = ({ field, renderer, locale, t }: StaticFieldHostProps) => {
	const id = useId()
	return createElement(renderer, {
		field,
		id,
		name: fieldKey(field),
		value: undefined,
		onChange: () => {},
		onBlur: () => {},
		errors: [],
		required: false,
		locale,
		t,
	})
}

export type FormFieldsProps = {
	/** When false, render the fields in document order with no grid class. Defaults to the grid. */
	layout?: boolean
	/** Extra class names merged onto the layout container. */
	className?: string
}

/**
 * The standard field loop, driven entirely by `useFormContext()`. Rendered by `<Form>` in default
 * mode and exported so a custom `children` layout can drop the same loop in without reimplementing
 * visibility, calc, recall, and step filtering. In `children` mode the host owns the success-state
 * swap (via `useFormState`); this component only ever renders the fields.
 */
export const FormFields = ({ layout, className }: FormFieldsProps) => {
	const ctx = useFormContext()
	const { rendererRegistry, effectiveValues, locale, t } = ctx
	const recall = ctx.recall ?? identityRecall
	const renderedFields = ctx.renderedFields ?? []
	return (
		<FormLayout enabled={layout !== false} className={className}>
			{renderedFields.map((field) => {
				const renderer = rendererRegistry.get(field.blockType)
				if (!renderer) {
					return null
				}
				const width: FieldWidth | undefined =
					typeof field.width === 'string' && FIELD_WIDTHS.has(field.width)
						? (field.width as FieldWidth)
						: undefined
				const recalledField = applyRecall(field, recall)
				return (
					<div key={fieldKey(field)} {...widthProps(width)}>
						{!isNamedField(recalledField) ? (
							<StaticFieldHost field={recalledField} renderer={renderer} locale={locale} t={t} />
						) : calcExpressionOf(recalledField) ? (
							<CalcFieldHost
								field={recalledField}
								renderer={renderer}
								value={effectiveValues?.[recalledField.name]}
								locale={locale}
								t={t}
							/>
						) : (
							<FieldHost field={recalledField} renderer={renderer} locale={locale} t={t} />
						)}
					</div>
				)
			})}
		</FormLayout>
	)
}
