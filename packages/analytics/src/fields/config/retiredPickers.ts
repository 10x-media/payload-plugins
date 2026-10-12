'use client'

import type { SelectFieldClientProps, TextFieldClientProps } from 'payload'
import type { FC, JSX } from 'react'
import { GoalSelectField as GoalPicker } from '../../goals/GoalSelectField'
import {
	FilterDimensionSelectField as FilterDimensionPicker,
	type FilterDimensionSelectFieldProps,
} from './FilterDimensionSelectField'
import {
	FilterOperatorSelectField as FilterOperatorPicker,
	type FilterOperatorSelectFieldProps,
} from './FilterOperatorSelectField'
import { MetricSelectField as MetricPicker, type MetricSelectFieldProps } from './MetricSelectField'
import { SourceSelectField as SourcePicker } from './SourceSelectField'

// The pickers' 1.0.0-beta.11 import-map paths under `/client`, kept so an import map generated
// before the `/rsc` wrappers keeps rendering; such a picker keys its list by the cookie's scope.

/**
 * Source picker under its 1.0.0-beta.11 path; regenerate the import map to move off it.
 * @deprecated Use `@10x-media/analytics/rsc#SourceSelectFieldServer`.
 *
 * @beta
 */
export const SourceSelectField: (props: SelectFieldClientProps) => JSX.Element = SourcePicker

/**
 * Metric picker under its 1.0.0-beta.11 path; regenerate the import map to move off it.
 * @deprecated Use `@10x-media/analytics/rsc#MetricSelectFieldServer`.
 *
 * @beta
 */
export const MetricSelectField: (props: MetricSelectFieldProps) => JSX.Element = MetricPicker

/**
 * Filter dimension picker under its 1.0.0-beta.11 path; regenerate the import map to move off it.
 * @deprecated Use `@10x-media/analytics/rsc#FilterDimensionSelectFieldServer`.
 *
 * @beta
 */
export const FilterDimensionSelectField: FC<FilterDimensionSelectFieldProps> = FilterDimensionPicker

/**
 * Filter operator picker under its 1.0.0-beta.11 path; regenerate the import map to move off it.
 * @deprecated Use `@10x-media/analytics/rsc#FilterOperatorSelectFieldServer`.
 *
 * @beta
 */
export const FilterOperatorSelectField: FC<FilterOperatorSelectFieldProps> = FilterOperatorPicker

/**
 * Goal picker under its 1.0.0-beta.11 path; regenerate the import map to move off it.
 * @deprecated Use `@10x-media/analytics/rsc#GoalSelectFieldServer`.
 *
 * @beta
 */
export const GoalSelectField: FC<TextFieldClientProps> = GoalPicker
