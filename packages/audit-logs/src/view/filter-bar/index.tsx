'use client'

import { AnimateHeight, Button, ReactSelect } from '@payloadcms/ui'
import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { splitRef } from '../filterQuery'
import type { Filters } from '../types'
import { CollectionEditor } from './CollectionEditor'
import { DateEditor, dateFilterValue } from './DateEditor'
import { EventEditor, eventFilterValue } from './EventEditor'
import { FilterChoice } from './FilterChoice'
import { MoreFilters } from './MoreFilters'
import { RefPicker } from './RefPicker'
import type { FilterBarProps } from './types'

const PANEL_ID = 'al-filterbar-panel'

type PillArgs = { id: string; label: string; value: string }

/**
 * One row: a fixed pill per common filter, each always showing its value, then
 * "More filters" for the rare ones. A pill opens its editor in a panel below the
 * bar, one at a time, the way the list view opens columns and filters. Changes
 * are staged and applied together, since every apply is a full server render.
 */
export function FilterBar({
	collectionOptions,
	customEventTypes,
	eventTypeLabels,
	filters,
	globalOptions,
	onFilter,
	payloadAPILabels,
	tenantGlobalOptions,
	refLabels,
	tenantOptions,
	titleFields,
	userCollections,
}: FilterBarProps) {
	const { t } = useTranslation()
	const [staged, setStaged] = useState<Filters>(filters)
	const [panel, setPanel] = useState<string>()
	// The panel that is collapsing keeps its content until the animation ends. Every
	// other panel is unmounted, so an editor's draft state starts fresh on reopen.
	const [closing, setClosing] = useState<string>()
	// Server-resolved titles, plus whatever the drawers pick before the next apply.
	const [labels, setLabels] = useState(refLabels)

	useEffect(() => {
		setStaged(filters)
	}, [filters])
	useEffect(() => {
		setLabels((current) => ({ ...current, ...refLabels }))
	}, [refLabels])

	const toggle = (id: string) => {
		setClosing(panel)
		setPanel(panel === id ? undefined : id)
	}
	const close = useCallback(() => {
		setClosing(panel)
		setPanel(undefined)
	}, [panel])
	const onLabel = useCallback(
		(ref: string, label: string) => setLabels((current) => ({ ...current, [ref]: label })),
		[]
	)

	const isDirty = JSON.stringify(staged) !== JSON.stringify(filters)
	const hasActiveFilters = Object.values(staged).some((value) =>
		Array.isArray(value) ? value.length > 0 : Boolean(value)
	)

	const labelOf = (options: { label: string; value: string }[], value: string) =>
		options.find((o) => o.value === value)?.label ?? value
	const refNames = (refs?: string[]) =>
		(refs ?? []).map((ref) => labels[ref] ?? splitRef(ref).id).join(', ')

	const scopeValue = [
		...(staged.collections ?? []).map((v) =>
			labelOf([...collectionOptions, ...tenantGlobalOptions], v)
		),
		...(staged.globals ?? []).map((v) => labelOf(globalOptions, v)),
	].join(', ')
	const userValue = refNames(staged.users)
	const tenantValue = (staged.tenants ?? []).map((v) => labelOf(tenantOptions ?? [], v)).join(', ')

	// The rare filters share one pill, which names the ones in use.
	const moreValue = [
		...(staged.documents?.length ? [t(keys.filterDocument)] : []),
		...(staged.changedPaths?.length ? [t(keys.filterChangedPath)] : []),
		...(staged.groups?.length ? [t(keys.filterGroup)] : []),
		...(staged.apis?.length ? [t(keys.filterApi)] : []),
	].join(', ')

	const handleApply = useCallback(() => {
		close()
		onFilter(staged)
	}, [close, onFilter, staged])

	const handleClear = useCallback(() => {
		close()
		setStaged({})
		onFilter({})
	}, [close, onFilter])

	const editorFor = (id: string): React.ReactNode => {
		const shared = { setStaged, staged }
		switch (id) {
			case 'event':
				return (
					<EventEditor
						{...shared}
						customEventTypes={customEventTypes}
						eventTypeLabels={eventTypeLabels}
					/>
				)
			case 'scope':
				return (
					<CollectionEditor
						{...shared}
						collectionOptions={collectionOptions}
						globalOptions={globalOptions}
						tenantGlobalOptions={tenantGlobalOptions}
					/>
				)
			case 'user':
				return (
					<div className="al-panel-grid">
						<RefPicker
							collections={userCollections}
							label={t(keys.filterUser)}
							labels={labels}
							onChange={(users) => setStaged((f): Filters => ({ ...f, users }))}
							onLabel={onLabel}
							refs={staged.users ?? []}
							titleFields={titleFields}
						/>
					</div>
				)
			case 'date':
				return <DateEditor {...shared} />
			case 'tenant':
				return (
					<div className="al-panel-grid">
						<div className="al-ref-picker">
							<div className="al-filterpopover__editor-label">{t(keys.filterTenant)}</div>
							<ReactSelect
								isClearable
								isMulti
								onChange={(selected) => {
									const tenants = (
										Array.isArray(selected) ? selected : selected ? [selected] : []
									).map((o) => String(o.value))
									setStaged(
										(f): Filters => ({ ...f, tenants: tenants.length ? tenants : undefined })
									)
								}}
								options={tenantOptions ?? []}
								value={(tenantOptions ?? []).filter((o) => staged.tenants?.includes(o.value))}
							/>
						</div>
					</div>
				)
			case 'more':
				return (
					<MoreFilters
						{...shared}
						documentCollections={(staged.collections?.length
							? staged.collections
							: collectionOptions.map((o) => o.value)
						).filter((slug) => !tenantGlobalOptions.some((o) => o.value === slug))}
						apiOptions={Object.entries(payloadAPILabels).map(([value, label]) => ({
							label,
							value,
						}))}
						labels={labels}
						onLabel={onLabel}
						titleFields={titleFields}
					/>
				)
			default:
				return null
		}
	}

	const panelIds = [
		'event',
		'scope',
		...(userCollections.length > 0 ? ['user'] : []),
		'date',
		...(tenantOptions && tenantOptions.length > 0 ? ['tenant'] : []),
		'more',
	]

	const choice = ({ active, id, label, value }: PillArgs & { active: boolean }) => (
		<FilterChoice
			active={active}
			controls={`${PANEL_ID}-${id}`}
			label={label}
			onToggle={() => toggle(id)}
			open={panel === id}
			value={value}
		/>
	)

	return (
		<div className="al-filterbar">
			<div className="al-filterbar__row">
				{choice({
					active: Boolean(staged.operations?.length || staged.eventTypes?.length),
					id: 'event',
					label: t(keys.filterEvent),
					value: eventFilterValue(staged, eventTypeLabels, t),
				})}
				{choice({
					active: Boolean(scopeValue),
					id: 'scope',
					label: t(keys.filterCollection),
					value: scopeValue || t(keys.filterAll),
				})}
				{userCollections.length > 0 &&
					choice({
						active: Boolean(userValue),
						id: 'user',
						label: t(keys.filterUser),
						value: userValue || t(keys.filterAll),
					})}
				{choice({
					active: Boolean(staged.dateFrom || staged.dateTo),
					id: 'date',
					label: t(keys.filterDate),
					value: dateFilterValue(staged, t),
				})}
				{tenantOptions &&
					tenantOptions.length > 0 &&
					choice({
						active: Boolean(tenantValue),
						id: 'tenant',
						label: t(keys.filterTenant),
						value: tenantValue || t(keys.filterAll),
					})}

				{choice({
					active: Boolean(moreValue),
					id: 'more',
					label: t(keys.moreFilters),
					value: moreValue,
				})}

				<span className="al-filterbar__spacer" />

				{isDirty && (
					<Button onClick={handleApply} margin={false} buttonStyle="primary" size="small">
						{t(keys.apply)}
					</Button>
				)}
				{hasActiveFilters && (
					<Button onClick={handleClear} margin={false} buttonStyle="subtle" size="small">
						{t(keys.clearAll)}
					</Button>
				)}
			</div>

			{/* One per pill, like the list view: the open one expands while the previous
			    one collapses. */}
			{panelIds.map((id) => (
				<AnimateHeight
					className="al-filterbar__panel"
					height={panel === id ? 'auto' : 0}
					id={`${PANEL_ID}-${id}`}
					key={id}
				>
					<div className="al-filterbar__panel-inner">
						{(panel === id || closing === id) && editorFor(id)}
					</div>
				</AnimateHeight>
			))}
		</div>
	)
}
