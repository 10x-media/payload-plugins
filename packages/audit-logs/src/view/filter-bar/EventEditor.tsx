'use client'

import { PillSelector } from '@payloadcms/ui'
import type React from 'react'
import { useState } from 'react'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import type { Filters, SelectOption } from '../types'
import { OPERATION_LABELS } from '../utils'
import type { EditorProps } from './types'
import { toggled } from './utils'

export const AUTH_EVENT_TYPES = ['login', 'failed_login', 'forgot_password'] as const

type Translate = (key: (typeof keys)[keyof typeof keys]) => string

type Props = EditorProps & {
	customEventTypes: SelectOption[]
	eventTypeLabels: Record<string, string>
}

/**
 * Every event in three columns, each a toggle. A whole operation ("All custom
 * events") and single types mix freely; the list matches any of them.
 */
export function EventEditor({ customEventTypes, eventTypeLabels, setStaged, staged }: Props) {
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

	const column = (
		label: string,
		pills: { name: string; label: string; selected: boolean; onToggle: () => void }[],
		after?: React.ReactNode
	) => (
		<div className="al-event-editor__column">
			<div className="al-filterpopover__editor-label">{label}</div>
			<PillSelector
				onClick={({ pill }) => pills.find((p) => p.name === pill.name)?.onToggle()}
				pills={pills.map(({ label: pillLabel, name, selected }) => ({
					Label: pillLabel,
					name,
					selected,
				}))}
			/>
			{after}
		</div>
	)

	const addOther = () => {
		const value = other.trim()
		if (value && !types.includes(value)) toggleType(value)
		setOther('')
	}

	return (
		<div className="al-event-editor">
			{column(
				t(keys.eventGroupWrites),
				(['create', 'update', 'delete'] as const).map((op) => ({
					label: OPERATION_LABELS[op] ?? op,
					name: op,
					onToggle: () => toggleOp(op),
					selected: ops.includes(op),
				}))
			)}
			{column(t(keys.eventGroupAuth), [
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
			{column(
				t(keys.eventGroupCustom),
				[
					{
						label: t(keys.eventAllCustom),
						name: 'custom',
						onToggle: () => toggleOp('custom'),
						selected: ops.includes('custom'),
					},
					...customOptions.map(({ label, value }) => ({
						label,
						name: value,
						onToggle: () => toggleType(value),
						selected: types.includes(value),
					})),
				],
				<div className="al-event-editor__other field-type text">
					<div className="field-type__wrap">
						<input
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
				</div>
			)}
		</div>
	)
}

/** What the Event pill reads when closed. */
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
