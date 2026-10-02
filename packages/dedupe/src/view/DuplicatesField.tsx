'use client'

import {
	Button,
	FieldLabel,
	Link,
	Pill,
	useConfig,
	useDocumentDrawer,
	useDocumentInfo,
	useModal,
} from '@payloadcms/ui'
import { usePathname, useSearchParams } from 'next/navigation'
import { formatAdminURL } from 'payload/shared'

import './index.css'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { mergeUrl } from './api'
import { MergeIcon } from './native'
import { Signals } from './Signals'
import { type DuplicateCandidate, useDuplicateCheck } from './useDuplicateCheck'

const baseClass = 'dedupe-duplicates'

/** One look-alike: its page in a new tab, the admin's document drawer in place, and the merge. */
const Candidate = ({
	candidate,
	collection,
	mergeHref,
}: {
	candidate: DuplicateCandidate
	collection: string
	mergeHref: null | string
}) => {
	const { t } = useTranslation()
	const {
		config: {
			routes: { admin: adminRoute },
		},
	} = useConfig()
	const [DocumentDrawer, , { openDrawer }] = useDocumentDrawer({
		id: candidate.id,
		collectionSlug: collection,
	})
	const { closeAllModals } = useModal()
	return (
		<li className={`${baseClass}__item`}>
			<div className={`${baseClass}__head`}>
				<Link
					href={formatAdminURL({ adminRoute, path: `/collections/${collection}/${candidate.id}` })}
					target="_blank"
				>
					{candidate.title}
				</Link>
				<Pill size="small">{Math.round(candidate.score * 100)}%</Pill>
				<div className={`${baseClass}__actions`}>
					<Button
						aria-label={t(keys.openDrawer)}
						buttonStyle="icon-label"
						icon="edit"
						iconStyle="none"
						margin={false}
						onClick={openDrawer}
					/>
					{mergeHref ? (
						<Button
							aria-label={t(keys.merge)}
							buttonStyle="icon-label"
							el="link"
							icon={<MergeIcon />}
							iconStyle="none"
							margin={false}
							// This panel also sits in a drawer, over a merge screen among others; the drawer
							// would stay open over the merge it leads to.
							onClick={closeAllModals}
							to={mergeHref}
						/>
					) : null}
				</div>
			</div>
			<Signals signals={candidate.signals} />
			<DocumentDrawer />
		</li>
	)
}

type DuplicatesFieldProps = {
	collection: string
	paths: string[]
	/** The plugin merges published states only, so a document never published has none to merge. */
	publishedOnly?: boolean
	/** Null when the plugin's views are off: the panel then only links to the documents. */
	mergePath: null | string
}

/**
 * A sidebar field listing saved documents that resemble the values being typed. On a saved
 * document each one can be merged into this one; on a new one there is nothing to merge yet.
 */
export function DuplicatesField({
	collection,
	mergePath,
	paths,
	publishedOnly = false,
}: DuplicatesFieldProps) {
	const { t } = useTranslation()
	const { id, hasPublishedDoc, data } = useDocumentInfo()
	// A status cleared to nothing counts as published, as the server merges it.
	const mergeable = !publishedOnly || hasPublishedDoc || (data !== undefined && !data._status)
	const { candidates } = useDuplicateCheck({ collection, paths })
	const pathname = usePathname()
	const searchParams = useSearchParams()
	// In a drawer over the merge screen, the documents of that merge are in view already.
	const merging = pathname === mergePath ? (searchParams.get('docs')?.split(',') ?? []) : []
	const shown = candidates.filter((candidate) => !merging.includes(candidate.id))

	// Most documents have no look-alike, so the panel appears only once one is found.
	if (shown.length === 0) return null

	return (
		<div className={`field-type ${baseClass}`}>
			{/* The heading a group field gives its fields, so the panel reads like a section of the form. */}
			<h3 className="group-field__title">
				<FieldLabel as="span" label={t(keys.possibleDuplicates)} />
			</h3>
			<ul className={`${baseClass}__list`}>
				{shown.map((candidate) => (
					<Candidate
						candidate={candidate}
						collection={collection}
						key={candidate.id}
						mergeHref={
							id && mergePath && mergeable
								? mergeUrl({ mergePath, collection, docs: [String(id), candidate.id] })
								: null
						}
					/>
				))}
			</ul>
		</div>
	)
}
