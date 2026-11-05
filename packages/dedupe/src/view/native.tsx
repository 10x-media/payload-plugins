'use client'

import { getTranslation, type I18nClient } from '@payloadcms/translations'
import { Button, ListSearchFilter, PageControlsComponent } from '@payloadcms/ui'
import type { ClientCollectionConfig, ClientField, Column } from 'payload'
import { fieldAffectsData, flattenTopLevelFields } from 'payload/shared'
import type React from 'react'

/**
 * Admin markup for list pieces `@payloadcms/ui` does not hand out whole: the controls band
 * around the search, the "All / Trash" tabs, a table column and a single radio; and the page
 * controls wired to the plugin's own navigation. The admin loads that package's whole
 * stylesheet, so the class names alone reproduce the appearance; only the behaviour is the
 * plugin's own.
 */

/**
 * The list view's controls band: the search on the left, the triggers on the right, a line
 * under it, full bleed as the list view draws it.
 */
export const ListControls = ({
	actions,
	label,
	onSearchChange,
	search,
}: {
	actions?: React.ReactNode
	label: string
	onSearchChange: (search: string) => void
	search: string
}) => (
	<div className="list-controls">
		<div className="list-controls__search-row">
			<div className="list-controls__left">
				<ListSearchFilter label={label} onSearchChange={onSearchChange} searchQueryParam={search} />
			</div>
			<div className="list-controls__spacer" />
			{actions ? <div className="list-controls__actions">{actions}</div> : null}
		</div>
	</div>
)

/**
 * The placeholder of the list view's search, worded as the list view words it for one
 * collection, over the fields of each of these: those `listSearchableFields` names, or else the
 * `useAsTitle` one.
 */
export const searchPlaceholder = (
	collections: ClientCollectionConfig[],
	i18n: I18nClient
): string => {
	const labels = new Set<string>()
	for (const config of collections) {
		const searchable = config.admin.listSearchableFields
		let named = false
		for (const field of flattenTopLevelFields(config.fields, { i18n, moveSubFieldsToTop: true })) {
			if (!fieldAffectsData(field)) continue
			const { name, label } = field as { name: string; label?: unknown }
			if (searchable?.length ? !searchable.includes(name) : name !== config.admin.useAsTitle) {
				continue
			}
			named = true
			labels.add(
				getTranslation(
					typeof label === 'string' || (typeof label === 'object' && label)
						? (label as Record<string, string> | string)
						: name,
					i18n
				)
			)
		}
		if (!named) labels.add('ID')
	}
	const [first = 'ID', ...rest] = [...labels]
	const last = rest.pop()
	const searchBy = i18n.t('general:searchBy', { label: [first, ...rest].join(', ') })
	return last ? `${searchBy} ${i18n.t('general:or')} ${last}` : searchBy
}

/**
 * The list view's "All / Trash" switch: the current tab a pill, the others ghost buttons, each
 * with its count.
 */
export const ListTabs = <T extends string>({
	onChange,
	tabs,
	value,
}: {
	onChange: (value: T) => void
	tabs: { count?: number; label: string; value: T }[]
	value: T
}) => (
	<div className="default-list-view-tabs">
		{tabs.map((tab) => (
			<Button
				buttonStyle={tab.value === value ? 'pill' : 'ghost'}
				className={[
					'default-list-view-tabs__button',
					tab.value === value && 'default-list-view-tabs__button--active',
				]
					.filter(Boolean)
					.join(' ')}
				disabled={tab.value === value}
				el="button"
				key={tab.value}
				margin={false}
				onClick={() => onChange(tab.value)}
			>
				{tab.label}
				{tab.count === undefined ? null : <span className="pill-version-count">{tab.count}</span>}
			</Button>
		))}
	</div>
)

/**
 * The list view's page controls on the plugin's own pages, sticky at the bottom of the view.
 */
export const ListPages = ({
	limit,
	onLimit,
	onPage,
	page,
	totalDocs,
	totalPages,
}: {
	limit: number
	onLimit: (limit: number) => void
	onPage: (page: number) => void
	page: number
	totalDocs: number
	totalPages: number
}) => (
	<PageControlsComponent
		data={{
			docs: [],
			hasNextPage: page < totalPages,
			hasPrevPage: page > 1,
			limit,
			nextPage: page + 1,
			page,
			pagingCounter: (page - 1) * limit + 1,
			prevPage: page - 1,
			totalDocs,
			totalPages,
		}}
		handlePageChange={async (next) => onPage(next)}
		handlePerPageChange={async (next) => onLimit(next)}
		limit={limit}
		limits={[10, 25, 50, 100]}
	/>
)

/**
 * A column for the admin's own table. It expects a field behind every column, because a
 * collection list is built from one; these columns come from the plugin's rows, not a
 * schema, so the field is a stand-in that only carries the name.
 */
export const column = (
	accessor: string,
	Heading: React.ReactNode,
	renderedCells: React.ReactNode[]
): Column => ({
	accessor,
	active: true,
	field: { name: accessor, type: 'text' } as ClientField,
	Heading,
	renderedCells,
})

type RadioProps = {
	checked: boolean
	children: React.ReactNode
	className?: string
	/** Shown as it is, not changed by a click. */
	disabled?: boolean
	id: string
	/** Read out by assistive tech; the visible label is whatever the children draw. */
	label: string
	name: string
	onChange: () => void
}

/**
 * One option as `RadioGroupField` draws it. The label slot takes any content rather than a
 * string, because here it holds the value the option stands for.
 */
export const Radio = ({
	checked,
	children,
	className,
	disabled,
	id,
	label,
	name,
	onChange,
}: RadioProps) => (
	<label className={className} htmlFor={id}>
		<div
			className={['radio-input', checked && 'radio-input--is-selected'].filter(Boolean).join(' ')}
		>
			<input
				aria-label={label}
				checked={checked}
				disabled={disabled}
				id={id}
				name={name}
				onChange={onChange}
				type="radio"
			/>
			<span className="radio-input__styled-radio" />
			<div className="radio-input__label">{children}</div>
		</div>
	</label>
)
