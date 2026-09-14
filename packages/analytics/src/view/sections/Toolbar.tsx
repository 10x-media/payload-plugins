'use client'

import { Button, Pill, SelectInput } from '@payloadcms/ui'
import type { WireSource } from '../../fields/config/fetchSources'
import type { TimeframePreset } from '../../timeframe/presets'
import { keys } from '../../translations/keys'
import { TIMEFRAME_KEYS } from '../../translations/metricKeys'
import { useTranslation } from '../../translations/useTranslation'
import { clampDayRange, dayRangeCaption, dayRangeDays } from '../dayRange'
import type { DayRange, ViewGate } from '../gating'
import { rangeFor, VIEW_RANGE_PRESETS, type ViewState } from '../state'
import { FilterChips } from './FilterChips'

export interface ToolbarProps {
	sources: WireSource[]
	/** The source the reads actually resolved to, which may not be `state.source`. */
	sourceId: string | null
	gate: ViewGate
	state: ViewState
	range: DayRange
	timezone: string
	locale: string
	/** Any section was served from an expired cache. */
	stale: boolean
	/** Any section read a shorter window than the one that was asked for. */
	clamped: boolean
	now: Date
	onChange: (next: ViewState) => void
	/** Committed after a pause: the day inputs fire on every keystroke. */
	onChangeDeferred: (next: ViewState) => void
}

const CUSTOM = 'custom'

const single = (selected: unknown): string | undefined => {
	const option = Array.isArray(selected) ? selected[0] : selected
	const value = (option as { value?: unknown } | null)?.value
	return typeof value === 'string' ? value : undefined
}

/**
 * The view's one control surface: which source, which window, whether to compare, and the
 * filters the reads carry. Every control is gated by what the selected source serves, so a
 * provider that cannot compare or cannot look back a year never offers the control that
 * would fail at the endpoint.
 */
export function Toolbar({
	sources,
	sourceId,
	gate,
	state,
	range,
	timezone,
	locale,
	stale,
	clamped,
	now,
	onChange,
	onChangeDeferred,
}: ToolbarProps) {
	const { t } = useTranslation()

	const presets = VIEW_RANGE_PRESETS.filter((preset) => {
		if (gate.maxRangeDays === null) {
			return true
		}
		return dayRangeDays(rangeFor({ ...state, range: preset }, timezone, now)) <= gate.maxRangeDays
	})

	const rangeOptions = [
		...presets.map((preset) => ({ value: preset, label: t(TIMEFRAME_KEYS[preset]) })),
		{ value: CUSTOM, label: t(keys.widgetTimeframeCustom) },
	]

	const pickRange = (value: string | undefined): void => {
		if (value === undefined) {
			return
		}
		if (value === CUSTOM) {
			onChange({ ...state, range: CUSTOM, from: range.from, to: range.to })
			return
		}
		onChange({ ...state, range: value as TimeframePreset, from: undefined, to: undefined })
	}

	const pickDay = (edited: 'from' | 'to', value: string): void => {
		if (value === '') {
			return
		}
		const picked = clampDayRange(
			{
				from: edited === 'from' ? value : (state.from ?? range.from),
				to: edited === 'to' ? value : (state.to ?? range.to),
			},
			edited,
			gate.maxRangeDays
		)
		onChangeDeferred({ ...state, range: CUSTOM, from: picked.from, to: picked.to })
	}

	return (
		<div className="analytics-view__toolbar">
			<div className="analytics-view__controls">
				{sources.length > 1 ? (
					<div className="analytics-view__control">
						<SelectInput
							isClearable={false}
							label={t(keys.viewSourceLabel)}
							name="analytics-source"
							onChange={(selected) => {
								const value = single(selected)
								if (value !== undefined) {
									onChange({ ...state, source: value })
								}
							}}
							options={sources.map((source) => ({ value: source.id, label: source.label }))}
							path="analytics-source"
							value={sourceId ?? undefined}
						/>
					</div>
				) : null}
				<div className="analytics-view__control">
					<SelectInput
						isClearable={false}
						label={t(keys.widgetFieldRange)}
						name="analytics-range"
						onChange={(selected) => pickRange(single(selected))}
						options={rangeOptions}
						path="analytics-range"
						value={state.range}
					/>
				</div>
				{state.range === CUSTOM ? (
					<>
						<div className="analytics-view__control">
							<label className="analytics-view__field-label">
								{t(keys.viewFrom)}
								<input
									aria-label={t(keys.viewFrom)}
									className="analytics-view__date"
									onChange={(event) => pickDay('from', event.target.value)}
									type="date"
									value={state.from ?? range.from}
								/>
							</label>
						</div>
						<div className="analytics-view__control">
							<label className="analytics-view__field-label">
								{t(keys.viewTo)}
								<input
									aria-label={t(keys.viewTo)}
									className="analytics-view__date"
									onChange={(event) => pickDay('to', event.target.value)}
									type="date"
									value={state.to ?? range.to}
								/>
							</label>
						</div>
					</>
				) : null}
				{gate.canCompare ? (
					<Button
						buttonStyle={state.compare ? 'primary' : 'secondary'}
						className="analytics-view__toggle"
						extraButtonProps={{ 'aria-pressed': state.compare }}
						onClick={() => onChange({ ...state, compare: !state.compare })}
						size="medium"
					>
						{t(keys.viewCompare)}
					</Button>
				) : null}
				<div className="analytics-view__captions">
					<span>{dayRangeCaption(range, locale, timezone)}</span>
					<span title={t(keys.viewTimezone)}>{timezone}</span>
					{stale ? (
						<Pill pillStyle="warning" size="small">
							{t(keys.viewStale)}
						</Pill>
					) : null}
					{clamped ? <span>{t(keys.stateClamped)}</span> : null}
				</div>
			</div>
			<FilterChips
				filters={state.filters}
				onRemove={(index) =>
					onChange({ ...state, filters: state.filters.filter((_, at) => at !== index) })
				}
			/>
		</div>
	)
}
