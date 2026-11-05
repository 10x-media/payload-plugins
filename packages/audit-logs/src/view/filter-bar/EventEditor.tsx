'use client'

import { Button, Popup, Switch, XIcon } from '@payloadcms/ui'
import { type ReactNode, useState } from 'react'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import type { Filters, SelectOption } from '../types'
import { OPERATION_LABELS } from '../utils'
import { FilterChoice } from './FilterChoice'
import type { EditorProps } from './types'
import { toggled } from './utils'

export const AUTH_EVENT_TYPES = ['login', 'failed_login', 'forgot_password'] as const

type Translate = (key: (typeof keys)[keyof typeof keys]) => string

type Props = EditorProps & {
	customEventTypes: SelectOption[]
	eventTypeLabels: Record<string, string>
}

type EventSwitch = { label: string; name: string; onToggle: () => void; selected: boolean }

/**
 * The Event filter: a set of on/off choices, so it opens as a popup in the shape of
 * the list view's Columns control (a titled panel, one `Switch` row per event,
 * grouped into changes, auth and custom). A whole operation ("All custom events")
 * and single types mix freely; the list matches any of them. Like every other
 * filter, a switch only stages its change until Apply.
 */
export function EventFilter({ customEventTypes, eventTypeLabels, setStaged, staged }: Props) {
	const { t } = useTranslation()
	const [other, setOther] = useState('')
	const ops = staged.operations ?? []
	const types = staged.eventTypes ?? []

	const isAuthType = (type: string) =>
		AUTH_EVENT_TYPES.includes(type as (typeof AUTH_EVENT_TYPES)[number])

	// "All auth events" and single auth types exclude each other, and the same for
	// custom: picking one side of a group drops the other.
	const toggleOp = (op: string) =>
		setStaged((f): Filters => {
			const on = !f.operations?.includes(op)
			const keep = (type: string) => (op === 'auth' ? !isAuthType(type) : isAuthType(type))
			const eventTypes =
				on && (op === 'auth' || op === 'custom') ? f.eventTypes?.filter(keep) : f.eventTypes
			return {
				...f,
				eventTypes: eventTypes?.length ? eventTypes : undefined,
				operations: toggled(f.operations, op),
			}
		})
	const toggleType = (type: string) =>
		setStaged((f): Filters => {
			const on = !f.eventTypes?.includes(type)
			const group = isAuthType(type) ? 'auth' : 'custom'
			const operations = on ? f.operations?.filter((op) => op !== group) : f.operations
			return {
				...f,
				eventTypes: toggled(f.eventTypes, type),
				operations: operations?.length ? operations : undefined,
			}
		})

	// A type typed in by hand stays listed while it is selected.
	const customOptions = [
		...customEventTypes,
		...types
			.filter((type) => !isAuthType(type) && !customEventTypes.some((o) => o.value === type))
			.map((type) => ({ label: type, value: type })),
	]

	const addOther = () => {
		const value = other.trim()
		if (value && !types.includes(value)) toggleType(value)
		setOther('')
	}

	const section = (label: string, switches: EventSwitch[], after?: ReactNode) => (
		<section aria-label={label} className="al-event-filter__section">
			<h3 className="al-event-filter__section-header">{label}</h3>
			<ul className="al-event-filter__list">
				{switches.map((option) => (
					<li
						className={[
							'al-event-filter__item',
							!option.selected && 'al-event-filter__item--inactive',
						]
							.filter(Boolean)
							.join(' ')}
						key={option.name}
					>
						<span className="al-event-filter__item-label">{option.label}</span>
						<Switch ariaLabel={option.label} checked={option.selected} onChange={option.onToggle} />
					</li>
				))}
			</ul>
			{after}
		</section>
	)

	const value = eventFilterValue(staged, eventTypeLabels, t)
	const active = ops.length > 0 || types.length > 0

	return (
		<Popup
			className="al-event-filter"
			horizontalAlign="left"
			id="al-filterbar-panel-event"
			popupAriaLabel={t(keys.filterEvent)}
			popupType="dialog"
			render={({ close }) => (
				<div className="al-event-filter__panel">
					<div className="al-event-filter__header">
						<h2 className="al-event-filter__title">{t(keys.filterEvent)}</h2>
						<Button
							aria-label={t('general:close')}
							buttonStyle="ghost"
							className="al-event-filter__close"
							icon={<XIcon size={24} />}
							margin={false}
							onClick={close}
						/>
					</div>
					<div className="al-event-filter__content">
						{section(
							t(keys.eventGroupWrites),
							(['create', 'update', 'delete'] as const).map((op) => ({
								label: OPERATION_LABELS[op] ?? op,
								name: op,
								onToggle: () => toggleOp(op),
								selected: ops.includes(op),
							}))
						)}
						{section(t(keys.eventGroupAuth), [
							{
								label: t(keys.eventAllAuth),
								name: 'auth',
								onToggle: () => toggleOp('auth'),
								selected: ops.includes('auth'),
							},
							...AUTH_EVENT_TYPES.map((type) => ({
								label: eventTypeLabels[type] ?? type,
								name: type,
								onToggle: () => toggleType(type),
								selected: types.includes(type),
							})),
						])}
						{section(
							t(keys.eventGroupCustom),
							[
								{
									label: t(keys.eventAllCustom),
									name: 'custom',
									onToggle: () => toggleOp('custom'),
									selected: ops.includes('custom'),
								},
								...customOptions.map(({ label, value: type }) => ({
									label,
									name: type,
									onToggle: () => toggleType(type),
									selected: types.includes(type),
								})),
							],
							<div className="al-event-filter__other">
								<input
									aria-label={t(keys.eventOther)}
									className="al-event-filter__other-input"
									onBlur={addOther}
									onChange={(e) => setOther(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === 'Enter') addOther()
									}}
									placeholder={t(keys.eventOther)}
									type="text"
									value={other}
								/>
							</div>
						)}
					</div>
				</div>
			)}
			renderButton={({ active: open, onClick, onKeyDown, ...aria }) => (
				<FilterChoice
					active={active}
					buttonProps={{ extraButtonProps: { ...aria, onKeyDown }, onClick }}
					label={t(keys.filterEvent)}
					open={open}
					value={value}
				/>
			)}
			theme="auto"
			verticalAlign="bottom"
		/>
	)
}

/** What the Event trigger reads. */
export const eventFilterValue = (
	staged: Filters,
	eventTypeLabels: Record<string, string>,
	t: Translate
): string => {
	const parts = [
		...(staged.operations ?? []).map((op) =>
			op === 'auth'
				? t(keys.eventAllAuth)
				: op === 'custom'
					? t(keys.eventAllCustom)
					: (OPERATION_LABELS[op] ?? op)
		),
		...(staged.eventTypes ?? []).map((type) => eventTypeLabels[type] ?? type),
	]
	return parts.length ? parts.join(', ') : t(keys.filterAll)
}
