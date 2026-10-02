'use client'

import { ListViewIcon, ReactSelect, useListDrawer } from '@payloadcms/ui'
import { useEffect } from 'react'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { splitRef } from '../filterQuery'
import type { SelectOption } from '../types'

type Props = {
	/** Collections the drawer offers, the way a polymorphic relationship field does. */
	collections: string[]
	label: string
	/** Titles known so far, keyed by reference. */
	labels: Record<string, string>
	onChange: (refs: string[] | undefined) => void
	onLabel: (ref: string, label: string) => void
	refs: string[]
	/** `useAsTitle` per collection, to name a document picked in the drawer. */
	titleFields: Record<string, string>
}

/**
 * Documents or users as pills, picked from the list drawer a relationship field
 * with `appearance: 'drawer'` opens. A typed id is accepted too, for a document
 * that no longer exists and so cannot be picked.
 */
export function RefPicker({
	collections,
	label,
	labels,
	onChange,
	onLabel,
	refs,
	titleFields,
}: Props) {
	const { t } = useTranslation()
	const [ListDrawer, , { closeDrawer, openDrawer, setCollectionSlugs }] = useListDrawer({
		collectionSlugs: collections,
	})

	const collectionsKey = collections.join(',')
	// biome-ignore lint/correctness/useExhaustiveDependencies: the joined key is the dependency; the array is rebuilt every render
	useEffect(() => {
		setCollectionSlugs(collections)
	}, [collectionsKey, setCollectionSlugs])

	const value: SelectOption[] = refs.map((ref) => ({
		label: labels[ref] ?? splitRef(ref).id,
		value: ref,
	}))

	return (
		<div className="al-ref-picker">
			<div className="al-filterpopover__editor-label">{label}</div>
			{/* The row is the input: it carries the one border, so the drawer button sits
			    inside the field rather than beside it. */}
			<div className="al-attached">
				<div className="al-attached__control">
					<ReactSelect
						isClearable
						isCreatable
						isMulti
						noOptionsMessage={() => t(keys.refPlaceholder)}
						onChange={(selected) => {
							const next = (Array.isArray(selected) ? selected : selected ? [selected] : []).map(
								(o) => String(o.value)
							)
							onChange(next.length ? next : undefined)
						}}
						options={[]}
						placeholder={t(keys.refPlaceholder)}
						value={value}
					/>
				</div>
				<button
					aria-label={t(keys.choose)}
					className="al-attached__action"
					onClick={openDrawer}
					title={t(keys.choose)}
					type="button"
				>
					<ListViewIcon />
				</button>
			</div>
			<ListDrawer
				onSelect={({ collectionSlug, doc }) => {
					const ref = `${collectionSlug}:${String(doc.id)}`
					const titleField = titleFields[collectionSlug]
					const title = titleField ? doc[titleField] : undefined
					if (title) onLabel(ref, String(title))
					if (!refs.includes(ref)) onChange([...refs, ref])
					closeDrawer()
				}}
			/>
		</div>
	)
}

type ValuesProps = {
	label: string
	/** Suggestions, optionally grouped; anything else can still be typed in. */
	options?: SelectOption[] | { label: string; options: SelectOption[] }[]
	onChange: (values: string[] | undefined) => void
	placeholder: string
	values: string[]
}

/** Free values as pills inside the input, the way a `hasMany` text field takes them. */
export function ValuesInput({ label, onChange, options = [], placeholder, values }: ValuesProps) {
	const flat = (options as (SelectOption | { options: SelectOption[] })[]).flatMap((o) =>
		'options' in o ? o.options : [o]
	)
	return (
		<div className="al-ref-picker">
			<div className="al-filterpopover__editor-label">{label}</div>
			<ReactSelect
				isClearable
				isCreatable
				isMulti
				noOptionsMessage={() => placeholder}
				onChange={(selected) => {
					const next = (Array.isArray(selected) ? selected : selected ? [selected] : []).map((o) =>
						String(o.value)
					)
					onChange(next.length ? next : undefined)
				}}
				options={options}
				placeholder={placeholder}
				value={values.map((v) => flat.find((o) => o.value === v) ?? { label: v, value: v })}
			/>
		</div>
	)
}
