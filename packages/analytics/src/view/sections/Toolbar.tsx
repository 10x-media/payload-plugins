'use client'

import { Banner, Button, FieldLabel, Pill } from '@payloadcms/ui'
import { useId, useState } from 'react'
import { PLATFORM_SCOPE } from '../../core/contract'
import { zonedCalendarDay } from '../../timeframe/tz'
import { keys } from '../../translations/keys'
import { TIMEFRAME_KEYS } from '../../translations/metricKeys'
import { useTranslation } from '../../translations/useTranslation'
import { calendarDay, pickerDate } from '../../ui/calendarDays'
import { LabeledSelect, type LabeledSelectOption } from '../../ui/components/LabeledSelect'
import { RangePicker } from '../../ui/RangePicker'
import { noticeTexts } from '../../widgets/notices'
import { clampDayRange, dayRangeCaption, dayRangeDays } from '../dayRange'
import { canCompareRange } from '../gating'
import { canToggleAggregate } from '../scopeLabel'
import {
	aggregateToken,
	isAggregateToken,
	rangeFor,
	VIEW_RANGE_PRESETS,
	type ViewState,
	withoutFilter,
} from '../state'
import { useViewFrame } from '../viewContext'
import { FilterChips } from './FilterChips'

const CUSTOM = 'custom'

/** The Site select's every-site option. A tenant id is never the wildcard, so they cannot clash. */
const ALL_SITES = PLATFORM_SCOPE

/**
 * The view's one control surface: site, source, window, comparison and filters. Each control is
 * gated by what the selected source serves, so none offers what the endpoint would reject.
 *
 * @beta
 */
export function Toolbar() {
	const view = useViewFrame()
	const { gate, state, range, now, stateKey, write: onChange } = view
	const { timezone, locale, goals, scopes, countryFlags } = view.props
	const sources = view.props.sources.sources
	const sourceId = view.source.id
	const { notices, provider, itemLabels } = view.answers
	const { run: onRefresh, pending: refreshing, failed: refreshFailed, done } = view.refresh
	const { t } = useTranslation()
	const datesId = useId()
	const [draft, setDraft] = useState<{ start: Date; key: string } | null>(null)
	// Goal states are the goal sections' own empty states, and a stale read gets the badge.
	const captions = noticeTexts(
		{ ...notices, stale: false, goalsUnresolved: false },
		{ t, locale, now, timeZone: timezone }
	)

	const presets = VIEW_RANGE_PRESETS.filter((preset) => {
		if (gate.maxRangeDays === null) {
			return true
		}
		return dayRangeDays(rangeFor({ ...state, range: preset }, timezone, now)) <= gate.maxRangeDays
	})

	const rangeOptions: Array<LabeledSelectOption<ViewState['range']>> = [
		...presets.map((preset) => ({ value: preset, label: t(TIMEFRAME_KEYS[preset]) })),
		{ value: CUSTOM, label: t(keys.widgetTimeframeCustom) },
	]

	const pickRange = (value: ViewState['range']): void => {
		if (value === CUSTOM) {
			onChange({ ...state, range: CUSTOM, from: range.from, to: range.to })
			return
		}
		onChange({ ...state, range: value, from: undefined, to: undefined })
	}

	// A start picked before anything else committed; any other commit retires it.
	const pendingStart = draft?.key === stateKey ? draft.start : null
	const today = pickerDate(zonedCalendarDay(now, timezone))

	/**
	 * A range commits once both ends are picked, as one step the reader can go Back over. The
	 * second pick is the bound kept when the window is longer than the source can serve.
	 */
	const pickDays = (start: Date | null, end: Date | null): void => {
		if (start === null) {
			setDraft(null)
			return
		}
		if (end === null) {
			setDraft({ start, key: stateKey })
			return
		}
		setDraft(null)
		const picked = clampDayRange(
			{ from: calendarDay(start), to: calendarDay(end) },
			'to',
			gate.maxRangeDays
		)
		onChange({ ...state, range: CUSTOM, from: picked.from, to: picked.to })
	}

	// The host owns the tenant; the view only chooses whether to aggregate. All sites is tagged
	// with the tenant it was picked from, so the server drops it once the host's selector moves.
	const aggregating = isAggregateToken(state.scope)
	return (
		<div className="analytics-view__toolbar">
			<div className="analytics-view__controls">
				{scopes && canToggleAggregate(scopes) ? (
					<div className="analytics-view__control">
						<LabeledSelect
							label={t(keys.viewScopeSite)}
							onChange={(value) => {
								if ((value === ALL_SITES) === aggregating) {
									return
								}
								onChange({
									...state,
									scope: value === ALL_SITES ? aggregateToken(scopes.own) : undefined,
								})
							}}
							options={[
								{ value: scopes.own, label: scopes.ownLabel ?? scopes.own },
								{ value: ALL_SITES, label: t(keys.viewScopeAll) },
							]}
							value={aggregating ? ALL_SITES : scopes.own}
						/>
					</div>
				) : null}
				{sources.length > 1 ? (
					<div className="analytics-view__control">
						<LabeledSelect
							label={t(keys.viewSourceLabel)}
							onChange={(value) => onChange({ ...state, source: value })}
							options={sources.map((source) => ({ value: source.id, label: source.label }))}
							value={sourceId}
						/>
					</div>
				) : null}
				<div className="analytics-view__control">
					<LabeledSelect
						label={t(keys.widgetFieldRange)}
						onChange={pickRange}
						options={rangeOptions}
						value={state.range}
					/>
				</div>
				{state.range === CUSTOM ? (
					<div className="analytics-view__control analytics-view__control--dates">
						<div className="field-type date-time-field analytics-date-range">
							<FieldLabel htmlFor={datesId} label={t(keys.viewDates)} />
							<RangePicker
								end={pendingStart ? null : pickerDate(state.to ?? range.to)}
								inputId={datesId}
								{...(today === null ? {} : { maxDate: today })}
								onCalendarClose={() => setDraft(null)}
								onChange={pickDays}
								start={pendingStart ?? pickerDate(state.from ?? range.from)}
							/>
						</div>
					</div>
				) : null}
				{canCompareRange(gate, range, { timezone, now }) ? (
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
				{/* aria-disabled rather than disabled: a keyboard user keeps focus on the button
				    they pressed instead of losing it to the body while the refresh runs. */}
				<Button
					buttonStyle="secondary"
					className="analytics-view__refresh"
					extraButtonProps={{ 'aria-disabled': refreshing }}
					onClick={() => {
						if (refreshing) {
							return
						}
						onRefresh()
					}}
					size="medium"
				>
					{t(refreshing ? keys.viewRefreshing : keys.viewRefresh)}
				</Button>
				<div className="analytics-view__captions">
					<span>{dayRangeCaption(range, locale, timezone)}</span>
					{/* The zone is not a display preference: it is the one each day is counted in,
					    which the title spells out. */}
					<span title={t(keys.viewTimezoneHelp)}>
						<bdi>{timezone}</bdi>
					</span>
					{/* A cached read is the normal case, so it is told in a neutral pill, not a warning. */}
					{notices.stale ? (
						<Pill pillStyle="light-gray" size="small">
							{t(keys.viewStale)}
						</Pill>
					) : null}
					{captions.map((caption) => (
						<span key={caption}>{caption}</span>
					))}
				</div>
			</div>
			{/* Mounted whether or not it has anything to say: a live region added at the same
			    moment as its text is not announced. A success is said once and never shown. */}
			<div role="status">
				{refreshFailed ? <Banner type="error">{t(keys.viewRefreshFailed)}</Banner> : null}
				{done === true && !refreshFailed ? (
					<span className="analytics-sr-only">{t(keys.viewRefreshed)}</span>
				) : null}
			</div>
			<FilterChips
				countryFlags={countryFlags}
				filters={state.filters}
				goals={goals}
				itemLabels={itemLabels}
				locale={locale}
				provider={provider}
				onRemove={(index) => onChange(withoutFilter(state, index))}
			/>
		</div>
	)
}
