'use client'

import {
	Banner,
	Button,
	Link,
	Table,
	toast,
	useConfig,
	useTranslation as usePayloadTranslation,
	useStepNav,
} from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import { usePathname, useRouter } from 'next/navigation'
import type { Column } from 'payload'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'

import './index.css'

import { PAGE_SIZE, PAIR_STATUSES, type PairStatus } from '../collections/slugs'
import type { QueueGroup, QueueResponse } from '../queue/pairs'
import type { ScanSummary } from '../queue/scan'
import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { callApi, mergeUrl } from './api'
import { ChoicePill } from './ChoicePill'
import { column, ListHeader, ListPages, ListTabs, NoListResults } from './native'
import { Signals } from './Signals'
import { SHORT_DATE } from './Value'

const baseClass = 'dedupe-queue'

const STATUS: Record<PairStatus, { label: TranslationKey; about: TranslationKey }> = {
	open: { label: keys.statusOpen, about: keys.aboutOpen },
	dismissed: { label: keys.statusDismissed, about: keys.aboutDismissed },
	merged: { label: keys.statusMerged, about: keys.aboutMerged },
	superseded: { label: keys.statusSuperseded, about: keys.aboutSuperseded },
	stale: { label: keys.statusStale, about: keys.aboutStale },
}

type QueueClientProps = {
	/** Empty for every collection. */
	collection: string
	data: QueueResponse
	/** The merge history; a merged group opens its record there. */
	historyPath: string
	limit: number
	/** The most documents the merge screen takes: a larger group opens with its most alike. */
	maxGroupSize: number
	mergePath: string
	/** An error the page arrived with, shown above the table as the list view shows one. */
	notice: null | string
	status: PairStatus
}

/**
 * The groups of look-alike documents to review, laid out as a collection list: the first column
 * opens a group, as it opens a document there, and there are no buttons in the rows. Marking a
 * group not duplicates happens on the merge screen, where its documents are in view.
 */
export function QueueClient({
	collection,
	data,
	historyPath,
	limit,
	maxGroupSize,
	mergePath,
	notice,
	status,
}: QueueClientProps) {
	const { i18n, t } = useTranslation()
	const { t: payloadT } = usePayloadTranslation()
	const {
		config: {
			routes: { api: apiRoute },
		},
	} = useConfig()
	const router = useRouter()
	const pathname = usePathname()
	const { setStepNav } = useStepNav()
	const [busy, setBusy] = useState(false)
	const [navigating, startTransition] = useTransition()
	const { collections } = data

	useEffect(() => {
		setStepNav([{ label: t(keys.queueTitle) }])
	}, [setStepNav, t])

	/** The address carries the filters, and the server view reads the queue from it. */
	const navigate = useCallback(
		(next: { collection?: string; limit?: number; page?: number; status?: PairStatus }) => {
			const target = { collection, status, limit, page: data.page, ...next }
			const query = new URLSearchParams({ status: target.status })
			if (target.collection) query.set('collection', target.collection)
			if (target.page > 1) query.set('page', String(target.page))
			if (target.limit !== PAGE_SIZE) query.set('limit', String(target.limit))
			startTransition(() => router.replace(`${pathname}?${query}`, { scroll: false }))
		},
		[collection, status, limit, data.page, pathname, router]
	)

	const scan = useCallback(async () => {
		setBusy(true)
		try {
			const result = await callApi<{ inline: boolean; summaries?: ScanSummary[] }>({
				apiRoute,
				path: '/dedupe/scan',
				method: 'POST',
				body: collection ? { collection } : {},
			})
			if (result.inline && result.summaries) {
				const total = (key: 'compared' | 'pairs') =>
					String(result.summaries?.reduce((sum, summary) => sum + summary[key], 0) ?? 0)
				toast.success(t(keys.scanDone, { pairs: total('pairs'), compared: total('compared') }))
			} else {
				toast.success(t(keys.scanQueued))
			}
			startTransition(() => router.refresh())
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t(keys.error))
		} finally {
			setBusy(false)
		}
	}, [apiRoute, collection, router, t])

	const canScan = collection
		? Boolean(collections.find((entry) => entry.slug === collection)?.hasMatch)
		: collections.some((entry) => entry.hasMatch)

	const columns = useMemo<Column[]>(() => {
		const rows = data.docs
		const labels = new Map(collections.map((entry) => [entry.slug, entry.label]))
		// A superseded group names a document merged or removed since, and one in the trash cannot
		// be merged: nothing to open.
		const hrefOf = (group: QueueGroup): string | null => {
			if (group.status === 'merged') return group.merge ? `${historyPath}/${group.merge}` : null
			if (group.status === 'superseded' || group.docs.some((doc) => doc.trashed)) return null
			return mergeUrl({
				mergePath,
				collection: group.collection,
				docs: group.docs.slice(0, maxGroupSize).map((doc) => doc.id),
			})
		}
		const titlesOf = (group: QueueGroup): string => {
			const named = group.docs
				.slice(0, 3)
				.map((doc) => doc.title)
				.join(', ')
			const more = group.docs.length - 3
			return more > 0 ? t(keys.andMore, { title: named, count: String(more) }) : named
		}
		return [
			column(
				'documents',
				payloadT('general:documents'),
				rows.map((group) => {
					const titles = titlesOf(group)
					const href = hrefOf(group)
					return href ? (
						<Link href={href} key={group.id}>
							{titles}
						</Link>
					) : (
						<span key={group.id}>{titles}</span>
					)
				})
			),
			...(collection
				? []
				: [
						column(
							'collection',
							t(keys.collection),
							rows.map((group) => (
								<span key={group.id}>{labels.get(group.collection) ?? group.collection}</span>
							))
						),
					]),
			column(
				'score',
				t(keys.similarity),
				rows.map((group) => (
					<span className={`${baseClass}__score`} key={group.id}>
						{group.score > 0 ? `${Math.round(group.score * 100)}%` : '-'}
					</span>
				))
			),
			column(
				'signals',
				t(keys.signals),
				rows.map((group) => <Signals key={group.id} signals={group.signals} />)
			),
			...(status === 'dismissed'
				? [
						column(
							'decided',
							t(keys.markedBy),
							rows.map((group) => (
								<span key={group.id}>
									{[
										group.decidedBy,
										group.decidedAt
											? formatDate({ date: group.decidedAt, i18n, pattern: SHORT_DATE })
											: null,
									]
										.filter(Boolean)
										.join(' · ')}
								</span>
							))
						),
					]
				: []),
		]
	}, [
		data.docs,
		collection,
		collections,
		historyPath,
		i18n,
		maxGroupSize,
		mergePath,
		payloadT,
		status,
		t,
	])

	return (
		<div className={baseClass}>
			<ListHeader
				actions={
					<ListTabs
						onChange={(next) => navigate({ status: next, page: 1 })}
						tabs={PAIR_STATUSES.map((entry) => ({
							count: data.counts[entry],
							label: t(STATUS[entry].label),
							value: entry,
						}))}
						value={status}
					/>
				}
				title={t(keys.queueTitle)}
				titleActions={
					canScan ? (
						<Button
							buttonStyle="pill"
							disabled={busy || navigating}
							margin={false}
							onClick={() => void scan()}
							size="small"
						>
							{t(keys.runScan)}
						</Button>
					) : null
				}
			/>

			<div className={`${baseClass}__controls`}>
				{collections.length > 1 ? (
					<ChoicePill
						groupLabel={t(keys.collection)}
						onChange={(value) => navigate({ collection: value, page: 1 })}
						options={[
							{ label: payloadT('general:allCollections'), value: '' },
							...collections.map((entry) => ({ label: entry.label, value: entry.slug })),
						]}
						value={collection}
					/>
				) : null}
				<p className={`${baseClass}__about`}>{t(STATUS[status].about)}</p>
			</div>

			{notice ? <Banner type="error">{notice}</Banner> : null}

			{data.docs.length === 0 ? (
				<NoListResults>
					<p className={`${baseClass}__message`}>{t(keys.noPairs)}</p>
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
