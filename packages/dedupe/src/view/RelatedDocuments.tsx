'use client'

import {
	Banner,
	Collapsible,
	EditIcon,
	FieldLabel,
	Link,
	Pill,
	Table,
	useConfig,
	useDocumentDrawer,
	useTranslation as usePayloadTranslation,
} from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import type { RepointDocRef, RepointPreview } from '../merge/repoint'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { column } from './native'

const baseClass = 'dedupe-related'

type Row = { doc: RepointDocRef; note?: ReactNode }

/**
 * The rows of one field's table: a document pointing at several merged-in documents is one
 * row naming them all.
 */
export const rowsByDoc = (
	group: { docs: RepointDocRef[]; from: string }[],
	titleOf: (id: string) => string
): Row[] => {
	const byDoc = new Map<string, { doc: RepointDocRef; from: string[] }>()
	for (const entry of group) {
		for (const doc of entry.docs) {
			const row = byDoc.get(doc.id) ?? { doc, from: [] }
			row.from.push(titleOf(entry.from))
			byDoc.set(doc.id, row)
		}
	}
	return [...byDoc.values()].map(({ doc, from }) => ({ doc, note: from.join(', ') }))
}

/**
 * The documents that move, each once: one pointing at several merged-in documents through a
 * field is listed under each of them. Past the listed ones, the counts are added up.
 */
export const movingCount = (entries: RepointPreview['entries']): number => {
	const listed = new Set(
		entries.flatMap((entry) => entry.docs.map((doc) => `${fieldKey(entry)}|${doc.id}`))
	)
	return listed.size + entries.reduce((sum, entry) => sum + entry.total - entry.docs.length, 0)
}

/** One field's place in the app; a global and a collection may share a slug. */
export const fieldKey = (entry: { collection: string; global?: boolean; path: string }): string =>
	`${entry.global ? 'global:' : ''}${entry.collection}.${entry.path}`

/**
 * Documents of one collection, as the admin lists a join field: a heading with a summary
 * beside it, and a compact table whose first cell opens the document in a new tab or in the
 * one drawer the table shares. `note` is the second column when `noteHeading` is given:
 * which document of the merge each one points at. A global opens on its own page only.
 */
export const RelatedTable = ({
	collection,
	global = false,
	heading,
	more = 0,
	noteHeading,
	onChanged,
	rows,
	summary,
}: {
	collection: string
	/** `collection` is a global's slug. */
	global?: boolean
	/** Absent inside a block that already names the collection. */
	heading?: string
	/** Documents beyond the ones listed. */
	more?: number
	noteHeading?: string
	onChanged: () => void
	rows: Row[]
	summary?: ReactNode
}) => {
	const { t } = useTranslation()
	const { t: payloadT } = usePayloadTranslation()
	const {
		config: {
			routes: { admin: adminRoute },
		},
	} = useConfig()
	const [current, setCurrent] = useState<string | undefined>()
	const opening = useRef(false)
	const [DocumentDrawer, , { closeDrawer, openDrawer }] = useDocumentDrawer({
		id: current,
		collectionSlug: collection,
	})
	// The drawer is bound to the id it was made with, so it opens once the new id is in.
	useEffect(() => {
		if (!opening.current) return
		opening.current = false
		openDrawer()
	}, [openDrawer])
	const open = useCallback(
		(id: string) => {
			// The same id makes no new drawer, so nothing would open it.
			if (id === current) return openDrawer()
			opening.current = true
			setCurrent(id)
		},
		[current, openDrawer]
	)
	// Closed before the plan is asked again: a document the edit took off the list unmounts
	// with its drawer, and one unmounted open leaves the admin's modal layer over the page.
	const changed = () => {
		closeDrawer()
		onChanged()
	}

	return (
		<div className={`field-type join ${baseClass}__table`}>
			<div className="relationship-table">
				{heading ? (
					<div className="relationship-table__header">
						<h4 className={`${baseClass}__heading`}>
							<FieldLabel as="span" label={heading} />
						</h4>
						{summary ? <div className="relationship-table__actions">{summary}</div> : null}
					</div>
				) : null}
				<Table
					appearance="condensed"
					columns={[
						column(
							'document',
							payloadT('general:document'),
							rows.map(({ doc }) => (
								<div className="drawer-link" key={doc.id}>
									<Link
										href={formatAdminURL({
											adminRoute,
											path: global
												? `/globals/${collection}`
												: `/collections/${collection}/${doc.id}`,
										})}
										target="_blank"
									>
										{doc.title}
									</Link>
									{global ? null : (
										<button
											aria-label={t(keys.openDrawer)}
											className="drawer-link__doc-drawer-toggler"
											onClick={() => open(doc.id)}
											title={t(keys.openDrawer)}
											type="button"
										>
											<EditIcon />
										</button>
									)}
								</div>
							))
						),
						...(noteHeading
							? [
									column(
										'note',
										noteHeading,
										rows.map(({ doc, note }) => <span key={doc.id}>{note}</span>)
									),
								]
							: []),
					]}
					data={rows.map(({ doc }) => doc)}
				/>
				{more > 0 ? (
					<p className={`${baseClass}__more`}>{t(keys.moreDocs, { count: String(more) })}</p>
				) : null}
			</div>
			{global ? null : <DocumentDrawer onDelete={changed} onSave={changed} />}
		</div>
	)
}

/**
 * What the merge does to documents elsewhere that point at the merged-in ones: which move to
 * the primary, and what stops them. A collision or a pending draft blocks the merge until it
 * is fixed in the drawer; the plan is asked again once it is saved.
 */
export function RelatedDocuments({
	onChanged,
	references,
	survivor,
	titleOf,
}: {
	onChanged: () => void
	references: RepointPreview
	survivor: string
	titleOf: (id: string) => string
}) {
	const { t } = useTranslation()
	const { blockers, conflicts, entries } = references
	if (entries.length === 0 && blockers.length === 0 && conflicts.length === 0) return null
	const blocking = conflicts.length + blockers.length
	// One table per field, whichever merged-in document its documents come from.
	const byField = new Map<string, RepointPreview['entries']>()
	for (const entry of entries) {
		const key = fieldKey(entry)
		byField.set(key, [...(byField.get(key) ?? []), entry])
	}

	return (
		<section className={`field-type group-field group-field--top-level ${baseClass}`}>
			<div className="group-field__wrap">
				<div className={`group-field__header ${baseClass}__header`}>
					<h3 className="group-field__title">
						<FieldLabel as="span" label={t(keys.relatedDocuments)} />
					</h3>
					{blocking > 0 ? (
						<Pill pillStyle="error" size="small">
							{t(keys.blocksMerge, { count: String(blocking) })}
						</Pill>
					) : null}
				</div>

				{conflicts.map((conflict) => (
					<Collapsible
						collapsibleStyle="error"
						header={
							<span className={`${baseClass}__conflict`}>
								{conflict.collectionLabel} ·{' '}
								{t(keys.referenceConflict, { fields: conflict.fields.join(' + ') })}
							</span>
						}
						key={conflict.docs.map(({ doc }) => doc.id).join(':')}
					>
						<RelatedTable
							collection={conflict.collection}
							noteHeading={t(keys.pointsAt)}
							onChanged={onChanged}
							rows={conflict.docs.map(({ doc, owner }) => ({ doc, note: titleOf(owner) }))}
						/>
					</Collapsible>
				))}

				{blockers.map((blocker) =>
					blocker.reason === 'pendingDraft' ? (
						<RelatedTable
							collection={blocker.collection}
							global={blocker.global}
							heading={blocker.collectionLabel}
							key={`${blocker.reason}:${blocker.global ? 'global:' : ''}${blocker.collection}:${blocker.doc.id}`}
							onChanged={onChanged}
							rows={[{ doc: blocker.doc }]}
							summary={
								<Pill pillStyle="error" size="small">
									{t(keys.pendingDraft)}
								</Pill>
							}
						/>
					) : (
						<Banner key={blocker.reason} type="error">
							{t(keys.tooManyReferences, { count: String(blocker.count) })}
						</Banner>
					)
				)}

				{[...byField.values()].map((group) => {
					const [first] = group as [RepointPreview['entries'][number]]
					const total = movingCount(group)
					return (
						<RelatedTable
							collection={first.collection}
							global={first.global}
							heading={`${first.collectionLabel} · ${first.label}`}
							key={fieldKey(first)}
							more={group.reduce((sum, entry) => sum + entry.total - entry.docs.length, 0)}
							noteHeading={t(keys.pointsAt)}
							onChanged={onChanged}
							rows={rowsByDoc(group, titleOf)}
							summary={
								<Pill size="small">
									{t(keys.movesTo, { count: String(total), title: titleOf(survivor) })}
								</Pill>
							}
						/>
					)
				})}
			</div>
		</section>
	)
}
