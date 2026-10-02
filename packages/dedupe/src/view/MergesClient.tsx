'use client'

import {
	Link,
	Pill,
	Table,
	useConfig,
	useTranslation as usePayloadTranslation,
	useStepNav,
} from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import { usePathname, useRouter } from 'next/navigation'
import type { Column } from 'payload'
import { formatAdminURL } from 'payload/shared'
import { useCallback, useEffect, useMemo, useTransition } from 'react'

import './index.css'

import { type MergeStatus, PAGE_SIZE } from '../collections/slugs'
import type { MergeDoc, MergesResponse } from '../merge/record'
import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { ChoicePill } from './ChoicePill'
import { column, ListHeader, ListPages, NoListResults } from './native'
import { SHORT_DATE } from './Value'

const baseClass = 'dedupe-merges'

export const MERGE_STATUS: Record<
	MergeStatus,
	{ key: TranslationKey; pill: 'error' | 'success' | 'warning' }
> = {
	applying: { key: keys.mergeApplying, pill: 'warning' },
	applied: { key: keys.mergeApplied, pill: 'success' },
	failed: { key: keys.mergeFailed, pill: 'error' },
}

/**
 * A document of a merge, linked where the admin can still open it: its edit view, its view
 * in the trash, or no link once it is deleted. A document that is not where the merge left
 * it carries the admin's word for where it is.
 */
export const MergeDocLink = ({ collection, doc }: { collection: string; doc: MergeDoc }) => {
	const { t } = usePayloadTranslation()
	const {
		config: {
			routes: { admin: adminRoute },
		},
	} = useConfig()
	const path: `/${string}` | null =
		doc.state === 'live'
			? `/collections/${collection}/${doc.id}`
			: doc.state === 'trash'
				? `/collections/${collection}/trash/${doc.id}`
				: null
	return (
		<span className={`${baseClass}__doc`}>
			{path ? <Link href={formatAdminURL({ adminRoute, path })}>{doc.title}</Link> : doc.title}
			{doc.state === 'live' ? null : (
				<Pill size="small">{t(doc.state === 'trash' ? 'general:trash' : 'general:deleted')}</Pill>
			)}
		</span>
	)
}

type MergesClientProps = {
	data: MergesResponse
	limit: number
}

/** Every merge applied, newest first, each opening its record. */
export function MergesClient({ data, limit }: MergesClientProps) {
	const { i18n, t } = useTranslation()
	const { t: payloadT } = usePayloadTranslation()
	const router = useRouter()
	const pathname = usePathname()
	const { setStepNav } = useStepNav()
	const [, startTransition] = useTransition()
	const { collection, collections } = data

	useEffect(() => {
		setStepNav([{ label: t(keys.historyTitle) }])
	}, [setStepNav, t])

	const navigate = useCallback(
		(next: { collection?: string | null; limit?: number; page?: number }) => {
			const target = { collection, limit, page: data.page, ...next }
			const query = new URLSearchParams()
			if (target.collection) query.set('collection', target.collection)
			if (target.page > 1) query.set('page', String(target.page))
			if (target.limit !== PAGE_SIZE) query.set('limit', String(target.limit))
			startTransition(() => router.replace(`${pathname}?${query}`, { scroll: false }))
		},
		[collection, limit, data.page, pathname, router]
	)

	const columns = useMemo<Column[]>(() => {
		const rows = data.docs
		const labels = new Map(collections.map((entry) => [entry.slug, entry.label]))
		return [
			column(
				'createdAt',
				payloadT('general:createdAt'),
				rows.map((merge) => {
					const date = formatDate({ date: merge.createdAt, i18n, pattern: SHORT_DATE })
					// A record the reader may not open is listed, as the queue lists what they may not read, but not linked.
					return merge.readable ? (
						<Link href={`${pathname}/${merge.id}`} key={merge.id}>
							{date}
						</Link>
					) : (
						<span key={merge.id}>{date}</span>
					)
				})
			),
			...(collection
				? []
				: [
						column(
							'collection',
							t(keys.collection),
							rows.map((merge) => (
								<span key={merge.id}>{labels.get(merge.collection) ?? merge.collection}</span>
							))
						),
					]),
			column(
				'survivor',
				t(keys.primaryRole),
				rows.map((merge) => (
					<MergeDocLink collection={merge.collection} doc={merge.survivor} key={merge.id} />
				))
			),
			column(
				'absorbed',
				t(keys.mergedIn),
				rows.map((merge) => (
					<span className={`${baseClass}__docs`} key={merge.id}>
						{merge.absorbed.map((doc) => (
							<MergeDocLink collection={merge.collection} doc={doc} key={doc.id} />
						))}
					</span>
				))
			),
			column(
				'appliedBy',
				payloadT('general:user'),
				rows.map((merge) => <span key={merge.id}>{merge.appliedBy ?? '-'}</span>)
			),
			column(
				'status',
				t(keys.status),
				rows.map((merge) => (
					<Pill key={merge.id} pillStyle={MERGE_STATUS[merge.status].pill} size="small">
						{t(MERGE_STATUS[merge.status].key)}
					</Pill>
				))
			),
		]
	}, [data.docs, collection, collections, i18n, pathname, payloadT, t])

	return (
		<div className={baseClass}>
			<ListHeader title={t(keys.historyTitle)} />

			{collections.length > 1 ? (
				<div className={`${baseClass}__controls`}>
					<ChoicePill
						groupLabel={t(keys.collection)}
						onChange={(value) => navigate({ collection: value || null, page: 1 })}
						options={[
							{ label: payloadT('general:allCollections'), value: '' },
							...collections.map((entry) => ({ label: entry.label, value: entry.slug })),
						]}
						value={collection ?? ''}
					/>
				</div>
			) : null}

			{data.docs.length === 0 ? (
				<NoListResults>
					<p>{t(keys.noMerges)}</p>
				</NoListResults>
			) : (
				<div className={`${baseClass}__table`}>
					<Table columns={columns} data={data.docs} />
				</div>
			)}

			{data.totalDocs > 0 ? (
				<ListPages
					limit={limit}
					onLimit={(next) => navigate({ limit: next, page: 1 })}
					onPage={(page) => navigate({ page })}
					page={data.page}
					totalDocs={data.totalDocs}
					totalPages={data.totalPages}
				/>
			) : null}
		</div>
	)
}
