'use client'

import { CheckboxInput, Pill } from '@payloadcms/ui'
import { type CSSProperties, memo, useRef } from 'react'

import { isEmpty, listOf, normalize, sameValue } from '../merge/compare'
import { choosable, pickedItems, withChoice } from '../merge/plan'
import type { DecisionView, DocRef } from '../merge/planResponse'
import type { MergeChoice } from '../schema/types'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { ColumnHeader } from './ColumnHeader'
import { Radio } from './native'
import {
	Drawn,
	drawsForm,
	type FormStates,
	formStateKey,
	isRows,
	Rows,
	useFormStates,
} from './Rows'
import { diffOf, groupLabel, Plain, useFormat } from './Value'

const baseClass = 'dedupe-merge'

type Item = { doc: string; index: number }

const docList = (decision: DecisionView, doc: string): unknown[] =>
	listOf(decision.values.find((entry) => entry.doc === doc)?.value)

const itemKey = ({ doc, index }: Item) => `${doc}:${index}`

type RowProps = {
	choice: MergeChoice | undefined
	collection: string
	decision: DecisionView
	docs: DocRef[]
	/** Takes the key rather than closing over the decision, so the handler stays stable. */
	onChoose: (key: string, choice: MergeChoice | undefined) => void
	/** The form state each document's rows are drawn from; only for arrays and blocks. */
	rowStates: FormStates | undefined
	showDiff: boolean
	survivor: string
}

/**
 * One field across the documents: its label, then one cell per document. With `showDiff`
 * every cell other than the survivor's marks what its value has that the survivor's does not.
 */
const FieldRow = ({
	choice,
	collection,
	decision: planned,
	docs,
	onChoose,
	rowStates,
	showDiff,
	survivor,
}: RowProps) => {
	const { t } = useTranslation()
	const { entry, markup } = useFormat(collection)
	const decision = withChoice(planned, choice)
	const canPick = choosable(decision)
	// A field waiting for the reviewer shows nothing picked, so every cell, the primary's
	// included, answers a click.
	// The document whose value the field ends up with; none for a merged list.
	const picked =
		decision.requiresChoice || decision.source === 'union'
			? null
			: decision.source === 'same'
				? survivor
				: decision.source
	const items =
		decision.list && !decision.requiresChoice ? pickedItems(planned, choice, survivor) : []
	const checked = new Set(items.map(itemKey))
	// A required list keeps at least one item.
	const last = (item: Item) => decision.required && checked.size === 1 && checked.has(itemKey(item))
	// Back to no choice when the checks match the plan's own, so the column heads count it untouched.
	const toggle = (item: Item) => {
		const next = checked.has(itemKey(item))
			? items.filter((entry) => itemKey(entry) !== itemKey(item))
			: [...items, item]
		const byDefault = new Set(pickedItems(planned, undefined, survivor).map(itemKey))
		const untouched =
			!planned.requiresChoice &&
			next.length === byDefault.size &&
			next.every((entry) => byDefault.has(itemKey(entry)))
		onChoose(decision.key, untouched ? undefined : { items: next })
	}
	// A value is taken once, from the first document that has it checked, the primary before
	// the rest; its twins show as taken and stay locked until that one is unchecked. Rows are
	// not compared: two rows alike to the eye may still differ, so each is the reviewer's to take.
	const holders = new Map<string, Item>()
	const ordered = [survivor, ...docs.map(({ id }) => id).filter((id) => id !== survivor)]
	for (const doc of isRows(planned) ? [] : ordered) {
		docList(planned, doc).forEach((value, index) => {
			const same = normalize(value, { list: false, type: planned.type })
			if (checked.has(itemKey({ doc, index })) && !holders.has(same)) {
				holders.set(same, { doc, index })
			}
		})
	}
	const valueFor = (doc: string) => decision.values.find((entry) => entry.doc === doc)?.value
	const base = markup(decision, valueFor(survivor), { doc: survivor })

	const group = groupLabel(decision.path)

	return (
		<>
			<div className={`${baseClass}__label`}>
				{group ? <span className={`${baseClass}__label-group`}>{group}</span> : null}
				<span className={`${baseClass}__label-name`}>
					{decision.locale ? (
						<span className="field-diff__locale-label">{decision.locale}</span>
					) : null}
					<span className={`${baseClass}__label-text`}>{decision.label}</span>
				</span>
				{decision.requiresChoice ? (
					<Pill pillStyle="error" size="small">
						{t(keys.needsChoice)}
					</Pill>
				) : null}
			</div>
			{docs.map((doc) => {
				const own = markup(decision, valueFor(doc.id), { doc: doc.id })
				const shown =
					showDiff && doc.id !== survivor && own.html ? diffOf(base, own) : <Plain markup={own} />
				if (isRows(planned) && !isEmpty(valueFor(doc.id))) {
					return (
						<Rows
							collection={collection}
							decision={planned}
							key={doc.id}
							picks={{
								entries: docList(planned, doc.id).map((value, index) =>
									entry(decision, value, index)
								),
								checked: canPick
									? (index) => checked.has(itemKey({ doc: doc.id, index }))
									: undefined,
								locked: (index) => last({ doc: doc.id, index }),
								id: (index) => `dedupe-${decision.key}-${doc.id}-${index}`,
								toggle: (index) => toggle({ doc: doc.id, index }),
							}}
							state={rowStates?.[formStateKey(doc.id, decision.locale)]}
						/>
					)
				}
				// A field drawn by its own component is shown with it, and has no diff inside: a cell
				// that differs from the primary is marked instead.
				const drawn = planned.component && !isEmpty(valueFor(doc.id))
				const content = drawn ? (
					<Drawn
						collection={collection}
						decision={planned}
						state={rowStates?.[formStateKey(doc.id, decision.locale)]}
					/>
				) : (
					shown
				)
				const marks = [
					drawn ? `${baseClass}__field--drawn` : '',
					drawn &&
					showDiff &&
					doc.id !== survivor &&
					!sameValue(valueFor(doc.id), valueFor(survivor), planned)
						? `${baseClass}__cell--differs`
						: '',
				]
				const richText = decision.type === 'richText' ? `${baseClass}__rich-text` : ''
				// A required field cannot be emptied, so its empty cells offer no pick.
				if (!canPick || (decision.required && isEmpty(valueFor(doc.id)))) {
					return (
						<div
							className={[
								`${baseClass}__cell`,
								`${baseClass}__field`,
								`${baseClass}__field--read-only`,
								richText,
								...marks,
							]
								.filter(Boolean)
								.join(' ')}
							key={doc.id}
						>
							{content}
						</div>
					)
				}
				// A list is one input per document; with nothing in it, it offers no check.
				if (decision.list && isEmpty(valueFor(doc.id))) {
					return (
						<div
							className={`${baseClass}__cell ${baseClass}__list${isRows(planned) ? ` ${baseClass}__list--rows` : ''}`}
							key={doc.id}
						>
							{shown}
						</div>
					)
				}
				if (decision.list) {
					return (
						<ul className={`${baseClass}__cell ${baseClass}__list`} key={doc.id}>
							{docList(planned, doc.id).map((value, index) => {
								const item = { doc: doc.id, index }
								const holder = holders.get(normalize(value, { list: false, type: planned.type }))
								const kept = holder !== undefined && itemKey(holder) !== itemKey(item)
								return (
									<li
										className={`${baseClass}__item`}
										key={itemKey(item)}
										title={
											kept
												? t(keys.takenFrom, {
														title: docs.find(({ id }) => id === holder.doc)?.title ?? '',
													})
												: undefined
										}
									>
										<CheckboxInput
											checked={kept || checked.has(itemKey(item))}
											className={`${baseClass}__line`}
											id={`dedupe-${decision.key}-${doc.id}-${index}`}
											label={entry(decision, value, index).title}
											onToggle={() => toggle(item)}
											readOnly={kept || last(item)}
										/>
									</li>
								)
							})}
						</ul>
					)
				}
				return (
					<Radio
						checked={picked === doc.id}
						className={[
							`${baseClass}__cell`,
							`${baseClass}__field`,
							picked === doc.id ? `${baseClass}__cell--picked` : '',
							richText,
							...marks,
						]
							.filter(Boolean)
							.join(' ')}
						id={`dedupe-${decision.key}-${doc.id}`}
						key={doc.id}
						label={doc.title}
						name={decision.key}
						onChange={() => onChoose(decision.key, { doc: doc.id })}
					>
						{content}
					</Radio>
				)
			})}
		</>
	)
}

/**
 * Memoised so a choice in one row leaves the others alone: the parent's list is rebuilt on
 * every choice, but a row whose decision, choice and handler did not change has nothing to
 * redraw.
 */
const Row = memo(FieldRow)

/**
 * The merge as a table, the layout of a merge tool's matrix: fields down the side, one
 * column per document. The field labels stay in view while the columns scroll sideways.
 */
export const Matrix = ({
	choices,
	collection,
	decisions,
	docs,
	onChoose,
	onMakeSurvivor,
	onRemove,
	onSaved,
	onTakeAll,
	onlyDifferences,
	showDiff,
	survivor,
}: {
	choices: Record<string, MergeChoice>
	collection: string
	decisions: DecisionView[]
	docs: DocRef[]
	onChoose: (key: string, choice: MergeChoice | undefined) => void
	onMakeSurvivor: (doc: string) => void
	/** Takes a document out of this merge; absent when only two are left. */
	onRemove?: (doc: string) => void
	onSaved: () => void
	onTakeAll: (doc: string) => void
	onlyDifferences: boolean
	showDiff: boolean
	survivor: string
}) => {
	const rowStates = useFormStates(collection, decisions, docs)
	const heads = useRef<HTMLDivElement>(null)
	const body = useRef<HTMLDivElement>(null)
	const shown = decisions.filter(
		(decision) => !decision.hidden && !(onlyDifferences && decision.source === 'same')
	)
	return (
		<div
			className={`${baseClass}__matrix${docs.length > 2 ? ` ${baseClass}__matrix--scroll` : ''}`}
			style={{ '--dedupe-docs': docs.length } as CSSProperties}
		>
			{/* The heads sit apart from the rows so they can stick to the top of the page, which a
			    child of a sideways scroller cannot; the rows' scroll moves them along. */}
			<div
				className={`${baseClass}__heads`}
				onWheel={(event) => {
					if (body.current && event.deltaX) body.current.scrollLeft += event.deltaX
				}}
				ref={heads}
			>
				{docs.map((doc) => (
					<ColumnHeader
						collection={collection}
						doc={doc}
						key={doc.id}
						onMakeSurvivor={() => onMakeSurvivor(doc.id)}
						onRemove={onRemove ? () => onRemove(doc.id) : undefined}
						onSaved={onSaved}
						onTakeAll={() => onTakeAll(doc.id)}
						survivor={doc.id === survivor}
					/>
				))}
			</div>
			<div
				className={`${baseClass}__grid`}
				onScroll={(event) => {
					if (heads.current) heads.current.scrollLeft = event.currentTarget.scrollLeft
				}}
				ref={body}
			>
				{shown.map((decision) => (
					<Row
						choice={choices[decision.key]}
						collection={collection}
						decision={decision}
						docs={docs}
						key={decision.key}
						onChoose={onChoose}
						rowStates={drawsForm(decision) ? rowStates : undefined}
						showDiff={showDiff}
						survivor={survivor}
					/>
				))}
			</div>
		</div>
	)
}
