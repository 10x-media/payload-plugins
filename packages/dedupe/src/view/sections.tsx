'use client'

import { CheckboxInput, Pill } from '@payloadcms/ui'
import { createContext, Fragment, type ReactNode, useContext } from 'react'

import type { DocRef } from '../merge/planResponse'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { Radio } from './native'

const baseClass = 'dedupe-merge'

/** A document of the merge as a section sees it: a column of the screen. */
export type MergeSectionDoc = DocRef & {
	/** The primary, which the others merge into. */
	survivor: boolean
}

export type MergeSectionState<T = unknown> = {
	collection: string
	/** The section's `key` in the plugin options. */
	sectionKey: string
	survivorId: string
	absorbedIds: string[]
	/** Every document of the merge in the order of the screen's columns. */
	docs: MergeSectionDoc[]
	/** What the section set, `null` until it sets something. */
	value: T | null
	/** The value `hooks.beforeRemove` receives under `sections[sectionKey]`; it must be JSON. */
	setValue: (next: T | null | ((current: T | null) => T | null)) => void
	/**
	 * `false` keeps the merge from applying, as a field waiting for a choice does, until the
	 * section says `true`. A section that never says is ready.
	 */
	setReady: (ready: boolean) => void
}

export const SectionContext = createContext<MergeSectionState | null>(null)

/**
 * The merge a section is drawn in, and the way to hand its value back. A section is drawn
 * again from nothing when the reviewer picks another primary or takes a document out, so what
 * it set before is gone and it starts over.
 */
export const useMergeSection = <T = unknown>(): MergeSectionState<T> => {
	const state = useContext(SectionContext)
	if (!state) throw new Error('useMergeSection is used outside a dedupe merge section')
	return state as MergeSectionState<T>
}

/**
 * One row of the merge screen, as a field is drawn there: the label across the columns, then
 * one cell per document. `cell` is asked for every document in column order, so the cells
 * stand under their documents' heads; a document with nothing to show returns
 * `<MergeCell />`, which keeps its place.
 */
export const MergeRow = ({
	cell,
	label,
	needsChoice = false,
}: {
	cell: (doc: MergeSectionDoc) => ReactNode
	label: ReactNode
	/** Marks the row as waiting for the reviewer, as a field the merge cannot decide is. */
	needsChoice?: boolean
}) => {
	const { t } = useTranslation()
	const { docs } = useMergeSection()
	return (
		<>
			<div className={`${baseClass}__label`}>
				<span className={`${baseClass}__label-name`}>
					<span className={`${baseClass}__label-text`}>{label}</span>
				</span>
				{needsChoice ? (
					<Pill pillStyle="error" size="small">
						{t(keys.needsChoice)}
					</Pill>
				) : null}
			</div>
			{docs.map((doc) => (
				<Fragment key={doc.id}>{cell(doc)}</Fragment>
			))}
		</>
	)
}

/** A cell the reviewer cannot pick: a value as the screen draws a read-only one, or nothing. */
export const MergeCell = ({ children }: { children?: ReactNode }) =>
	children === undefined || children === null ? (
		<div className={`${baseClass}__cell`} />
	) : (
		<div className={`${baseClass}__cell ${baseClass}__field ${baseClass}__field--read-only`}>
			{children}
		</div>
	)

/**
 * A cell the reviewer picks, one of a row: the radio and outline a field's cell has. Cells of
 * one row share a `name`. `readOnly` shows an outcome the reviewer has no say in, such as a
 * record that moves to the primary because nothing competes with it: picked, and fixed.
 */
export const MergePick = ({
	checked,
	children,
	id,
	label,
	name,
	onChange,
	readOnly = false,
}: {
	checked: boolean
	children: ReactNode
	/** Unique on the page. */
	id: string
	/** Read out by assistive tech, such as the document's title. */
	label: string
	name: string
	onChange?: () => void
	readOnly?: boolean
}) => (
	<Radio
		checked={checked}
		className={[
			`${baseClass}__cell`,
			`${baseClass}__field`,
			checked ? `${baseClass}__cell--picked` : '',
			readOnly ? `${baseClass}__field--fixed` : '',
		]
			.filter(Boolean)
			.join(' ')}
		disabled={readOnly}
		id={id}
		label={label}
		name={name}
		onChange={() => {
			if (!readOnly) onChange?.()
		}}
	>
		{children}
	</Radio>
)

/**
 * A cell of lines the reviewer checks one by one, as a `hasMany` field's cell: each line a
 * check and its text. An empty list keeps the cell's place.
 */
export const MergeChecks = ({
	items,
}: {
	items: {
		/** Unique on the page. */
		id: string
		label: string
		checked: boolean
		onToggle: () => void
		readOnly?: boolean
	}[]
}) =>
	items.length === 0 ? (
		<div className={`${baseClass}__cell`} />
	) : (
		<ul className={`${baseClass}__cell ${baseClass}__list`}>
			{items.map((item) => (
				<li className={`${baseClass}__item`} key={item.id}>
					<CheckboxInput
						checked={item.checked}
						className={`${baseClass}__line`}
						id={item.id}
						label={item.label}
						onToggle={item.onToggle}
						readOnly={item.readOnly}
					/>
				</li>
			))}
		</ul>
	)
