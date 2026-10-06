'use client'

import { Button, PageControlsComponent } from '@payloadcms/ui'
import type { ClientCollectionConfig, ClientField, Column } from 'payload'
import type React from 'react'

/**
 * Copies of admin markup for pieces `@payloadcms/ui` keeps internal: the list header and
 * tabs, the empty-list notice, a table column and a single radio; and the page controls wired
 * to the plugin's own navigation. The
 * admin loads that package's whole stylesheet, so the class names alone reproduce the
 * appearance; only the behaviour is the plugin's own. The same approach as folder-picker's
 * `native.tsx`.
 */

const listHeaderClass = 'list-header'

/** The list view's header: title, the pill actions beside it, the tabs on the right, and a line under it. */
export const ListHeader = ({
	actions,
	title,
	titleActions,
}: {
	actions?: React.ReactNode
	title: string
	titleActions?: React.ReactNode
}) => (
	<header className={listHeaderClass}>
		<div className={`${listHeaderClass}__content`}>
			<div className={`${listHeaderClass}__title-and-actions`}>
				<h1 className={`${listHeaderClass}__title`}>{title}</h1>
				{titleActions ? (
					<div className={`${listHeaderClass}__title-actions`}>{titleActions}</div>
				) : null}
			</div>
			{actions ? <div className={`${listHeaderClass}__actions`}>{actions}</div> : null}
		</div>
	</header>
)

/** The list view's "All / Trash" switch, with a count beside each tab as the Versions tab shows one. */
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
				buttonStyle="tab"
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
 * The list view's page controls on the plugin's own pages. The admin's component takes a
 * collection config only for its page sizes, so the plugin's are passed in that shape.
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
		collectionConfig={
			{ admin: { pagination: { limits: [10, 25, 50, 100] } } } as ClientCollectionConfig
		}
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
	/>
)

export const NoListResults = ({ children }: { children: React.ReactNode }) => (
	<div className="no-results">{children}</div>
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
export const Radio = ({ checked, children, className, id, label, name, onChange }: RadioProps) => (
	<label className={className} htmlFor={id}>
		<div
			className={['radio-input', checked && 'radio-input--is-selected'].filter(Boolean).join(' ')}
		>
			<input
				aria-label={label}
				checked={checked}
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
