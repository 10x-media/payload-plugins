'use client'

import { getTranslation } from '@payloadcms/translations'
import {
	Banner,
	Button,
	CheckboxInput,
	ConfirmationModal,
	StaggeredShimmers,
	toast,
	useConfig,
	useLocale,
	useModal,
	useStepNav,
	useWindowInfo,
} from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import { useRouter } from 'next/navigation'
import { formatAdminURL } from 'payload/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import './index.css'

import type { ApplyMergeResult } from '../merge/apply'
import { choosable, withChoice } from '../merge/plan'
import type { PlanResponse } from '../merge/planResponse'
import type { MergeChoice } from '../schema/types'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { callApi, mergeUrl } from './api'
import { Matrix } from './Matrix'
import { fieldList, SHORT_DATE } from './Value'

const baseClass = 'dedupe-merge'

const CONFIRM_MODAL = 'dedupe-merge-confirm'
const REMOVE_MODAL = 'dedupe-remove-confirm'

type MergeClientProps = {
	collection: string
	/** The documents in the order their columns stand. */
	docs: string[]
	queuePath: string
	survivor: string
}

export function MergeClient({
	collection,
	docs: initialDocs,
	queuePath,
	survivor: initialSurvivor,
}: MergeClientProps) {
	const { i18n, t } = useTranslation()
	const router = useRouter()
	const {
		config: {
			routes: { admin: adminRoute, api: apiRoute },
		},
		getEntityConfig,
	} = useConfig()
	const { setStepNav } = useStepNav()
	const { code: locale } = useLocale()
	const { openModal } = useModal()
	const [docs, setDocs] = useState(initialDocs)
	const [survivor, setSurvivor] = useState(initialSurvivor)
	const [plan, setPlan] = useState<PlanResponse | null>(null)
	const [choices, setChoices] = useState<Record<string, MergeChoice>>({})
	const [onlyDifferences, setOnlyDifferences] = useState(true)
	const [showDiff, setShowDiff] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const [answer, setAnswer] = useState<Pick<
		PlanResponse,
		'blocked' | 'cleared' | 'decisions' | 'filled' | 'readyToApply' | 'refusal' | 'release'
	> | null>(null)
	const absorbed = useMemo(() => docs.filter((id) => id !== survivor), [docs, survivor])
	const requests = useRef(0)
	const titleOf = useCallback(
		(id: string) => plan?.docs.find((doc) => doc.id === id)?.title ?? id,
		[plan]
	)

	const collectionConfig = getEntityConfig({ collectionSlug: collection })
	const collectionLabel = collectionConfig
		? getTranslation(collectionConfig.labels.plural, i18n)
		: collection
	const survivorTitle = plan ? titleOf(survivor) : null
	// The plan on screen still answers for the documents and survivor the reviewer has since changed.
	const stale = plan ? plan.survivor !== survivor || plan.docs.length !== docs.length : false
	const {
		breakpoints: { s: phone },
	} = useWindowInfo()
	// On a phone the admin's header holds two short crumbs, as on a document's own page.
	useEffect(() => {
		setStepNav([
			{ label: t(keys.queueTitle), url: queuePath },
			...(phone ? [] : [{ label: collectionLabel, url: `${queuePath}?collection=${collection}` }]),
			...(survivorTitle
				? [
						{
							label: phone
								? survivorTitle
								: t(keys.andMore, { title: survivorTitle, count: String(docs.length - 1) }),
						},
					]
				: []),
		])
	}, [setStepNav, t, queuePath, collection, collectionLabel, survivorTitle, docs.length, phone])

	// Only the newest answer counts: a slow one for a survivor the reviewer has since moved
	// away from must not replace it.
	const load = useCallback(async () => {
		const request = ++requests.current
		setError(null)
		try {
			const next = await callApi<PlanResponse>({
				apiRoute,
				path: `/dedupe/plan${locale ? `?locale=${locale}` : ''}`,
				method: 'POST',
				body: { collection, survivor, absorbed },
			})
			if (request === requests.current) setPlan(next)
		} catch (err) {
			if (request === requests.current) setError(err instanceof Error ? err.message : t(keys.error))
		}
	}, [apiRoute, collection, survivor, absorbed, locale, t])

	useEffect(() => {
		void load()
	}, [load])

	// Whether the merge may apply, and what the absorbed documents give up, depend on the
	// choices, the database and the fields' own validation, so the server answers both;
	// `null` while a choice is in flight keeps the merge from applying before the reviewer
	// has seen the answer.
	useEffect(() => {
		if (!plan || stale) {
			setAnswer(null)
			return
		}
		if (Object.keys(choices).length === 0) {
			setAnswer(plan)
			return
		}
		setAnswer(null)
		let current = true
		const timer = setTimeout(() => {
			callApi<PlanResponse>({
				apiRoute,
				path: `/dedupe/plan${locale ? `?locale=${locale}` : ''}`,
				method: 'POST',
				body: { collection, survivor, absorbed, choices },
			})
				.then((next) => {
					if (current) setAnswer(next)
				})
				.catch((err: unknown) => {
					if (current) setError(err instanceof Error ? err.message : t(keys.error))
				})
		}, 250)
		return () => {
			current = false
			clearTimeout(timer)
		}
	}, [plan, stale, choices, apiRoute, collection, survivor, absorbed, locale, t])

	// The address follows the screen without a navigation, so the matrix stays where it is.
	const remember = useCallback(
		(nextDocs: string[], nextSurvivor: string) => {
			window.history.replaceState(
				null,
				'',
				mergeUrl({
					mergePath: `${queuePath}/merge`,
					collection,
					docs: nextDocs,
					survivor: nextSurvivor,
				})
			)
		},
		[queuePath, collection]
	)

	const makeSurvivor = useCallback(
		(doc: string) => {
			if (doc === survivor) return
			setSurvivor(doc)
			remember(docs, doc)
		},
		[survivor, docs, remember]
	)

	// A document taken out of this merge only; to keep it out of the queue as well, the
	// reviewer marks the documents not duplicates.
	const removeDoc = useCallback(
		(doc: string) => {
			const nextDocs = docs.filter((id) => id !== doc)
			const nextSurvivor = doc === survivor ? (nextDocs[0] as string) : survivor
			setDocs(nextDocs)
			setSurvivor(nextSurvivor)
			setChoices((current) =>
				Object.fromEntries(
					Object.entries(current)
						.filter(([, choice]) => !('doc' in choice) || choice.doc !== doc)
						.map(([key, choice]) => [
							key,
							'items' in choice
								? { items: choice.items.filter((item) => item.doc !== doc) }
								: choice,
						])
				)
			)
			remember(nextDocs, nextSurvivor)
		},
		[docs, survivor, remember]
	)

	const [removing, setRemoving] = useState<string | null>(null)
	const askRemove = useCallback(
		(doc: string) => {
			setRemoving(doc)
			openModal(REMOVE_MODAL)
		},
		[openModal]
	)

	// Stable, and keyed by the decision rather than closing over it, so a memoised row only
	// redraws when its own decision or choice moved.
	const choose = useCallback((key: string, choice: MergeChoice | undefined) => {
		setChoices((current) => {
			const next = { ...current }
			if (choice === undefined) delete next[key]
			else next[key] = choice
			return next
		})
	}, [])

	// Every field this document's value, in one state update, so the rows redraw once rather
	// than once each.
	const takeAll = useCallback(
		(doc: string) => {
			if (!plan) return
			setChoices((current) => {
				const next = { ...current }
				for (const decision of plan.decisions.filter(choosable)) next[decision.key] = { doc }
				return next
			})
		},
		[plan]
	)

	const decide = useCallback(
		async (action: 'dismiss' | 'reopen') => {
			setBusy(true)
			try {
				await callApi({
					apiRoute,
					path: `/dedupe/${action}`,
					method: 'POST',
					body: { collection, docs },
				})
				if (action === 'dismiss') {
					toast.success(t(keys.markedNotDuplicates))
					router.push(`${queuePath}?collection=${collection}`)
					return
				}
				await load()
			} catch (err) {
				toast.error(err instanceof Error ? err.message : t(keys.error))
			}
			setBusy(false)
		},
		[apiRoute, collection, docs, t, router, queuePath, load]
	)

	const decisions = useMemo(
		() =>
			plan?.decisions.map(
				(decision) =>
					// A required value the server took from the most similar document, for these choices.
					(answer?.filled.includes(decision.key)
						? answer.decisions.find((entry) => entry.key === decision.key)
						: undefined) ?? withChoice(decision, choices[decision.key])
			) ?? [],
		[plan, choices, answer]
	)
	const ordered = useMemo(
		() =>
			plan
				? docs
						.map((id) => plan.docs.find((doc) => doc.id === id))
						.filter((doc) => doc !== undefined)
				: [],
		[plan, docs]
	)
	// A document that gives nothing up has nothing to say, and no empty block under the table.
	const releases = Object.entries(answer?.release ?? {}).filter(
		([, release]) => release.deletes.length + release.marked.length + release.emptied.length > 0
	)
	const deletesNote = new Map(
		releases
			.filter(([, release]) => release.deletes.length > 0)
			.map(([id, release]) => [
				id,
				t(keys.releaseDeletes, {
					title: titleOf(id),
					survivor: titleOf(survivor),
					fields: fieldList(decisions, release.deletes),
				}),
			])
	)

	const apply = useCallback(async () => {
		if (!plan) return
		setBusy(true)
		try {
			const result = await callApi<ApplyMergeResult>({
				apiRoute,
				path: '/dedupe/apply',
				method: 'POST',
				body: {
					collection,
					survivor,
					absorbed,
					choices,
					expected: Object.fromEntries(plan.docs.map((doc) => [doc.id, doc.updatedAt])),
				},
			})
			toast.success(t(keys.applied))
			router.push(
				formatAdminURL({ adminRoute, path: `/collections/${collection}/${result.survivorId}` })
			)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t(keys.error))
			setBusy(false)
		}
	}, [plan, apiRoute, collection, survivor, absorbed, choices, t, router, adminRoute])

	if (error) {
		return (
			<div className={baseClass}>
				<Banner type="error">{error}</Banner>
			</div>
		)
	}
	if (!plan) {
		return (
			<div className={baseClass}>
				<StaggeredShimmers count={4} height={96} />
			</div>
		)
	}

	return (
		<div className={baseClass}>
			<div className={`${baseClass}__header`}>
				<h1>{t(keys.mergeInto, { title: titleOf(survivor) })}</h1>
			</div>

			{plan.dismissed ? (
				<Banner>
					{t(keys.dismissedNote, {
						user: plan.dismissed.by ?? '-',
						date: plan.dismissed.at
							? formatDate({ date: plan.dismissed.at, i18n, pattern: SHORT_DATE })
							: '-',
					})}
				</Banner>
			) : null}
			{plan.markedApart.map((entry) => (
				<Banner key={entry.docs.join('|')}>
					{t(keys.markedApart, {
						a: titleOf(entry.docs[0]),
						b: titleOf(entry.docs[1]),
						user: entry.by ?? '-',
						date: entry.at ? formatDate({ date: entry.at, i18n, pattern: SHORT_DATE }) : '-',
					})}
				</Banner>
			))}
			{plan.transactions === 'off' ? <Banner>{t(keys.noTransactions)}</Banner> : null}
			{plan.transactions === 'refused' ? (
				<Banner type="error">{t(keys.transactionsRequired)}</Banner>
			) : null}

			<div
				aria-busy={stale}
				className={`${baseClass}__body${stale ? ` ${baseClass}__body--loading` : ''}`}
			>
				<Matrix
					choices={choices}
					collection={collection}
					decisions={plan.decisions}
					docs={ordered}
					onChoose={choose}
					onMakeSurvivor={makeSurvivor}
					onRemove={docs.length > 2 ? askRemove : undefined}
					onSaved={() => void load()}
					onTakeAll={takeAll}
					onlyDifferences={onlyDifferences}
					showDiff={showDiff}
					survivor={survivor}
				/>

				{(answer ?? plan).refusal ? (
					<div className={`${baseClass}__releases`}>
						<Banner type="error">
							{t(keys.mayNotApply)} {(answer ?? plan).refusal}
						</Banner>
					</div>
				) : null}

				{(answer ?? plan).blocked ? (
					<div className={`${baseClass}__releases`}>
						<Banner type="error">{(answer ?? plan).blocked}</Banner>
					</div>
				) : null}

				{plan.survivorDraft ? (
					<div className={`${baseClass}__releases`}>
						<Banner type="error">{t(keys.survivorDraft, { title: titleOf(survivor) })}</Banner>
					</div>
				) : null}

				{answer && answer.cleared.length > 0 ? (
					<div className={`${baseClass}__releases`}>
						<Banner type="info">
							{t(keys.pointersCleared, {
								fields: fieldList(decisions, answer.cleared),
								survivor: titleOf(survivor),
							})}
						</Banner>
					</div>
				) : null}

				{releases.map(([id, release]) => (
					<div className={`${baseClass}__releases`} key={id}>
						{deletesNote.has(id) ? <Banner type="error">{deletesNote.get(id)}</Banner> : null}
						{release.marked.length > 0 ? (
							<Banner type="error">
								{t(keys.releaseMarked, {
									title: titleOf(id),
									survivor: titleOf(survivor),
									fields: fieldList(decisions, release.marked),
								})}
							</Banner>
						) : null}
						{release.emptied.length > 0 ? (
							<Banner type="error">
								{t(keys.releaseEmptied, {
									title: titleOf(id),
									survivor: titleOf(survivor),
									fields: fieldList(decisions, release.emptied),
								})}
							</Banner>
						) : null}
					</div>
				))}
			</div>

			<div className={`${baseClass}__footer`}>
				<div className={`${baseClass}__toggles`}>
					<CheckboxInput
						checked={onlyDifferences}
						id="dedupe-only-differences"
						label={t(keys.onlyDifferences)}
						onToggle={() => setOnlyDifferences((value) => !value)}
					/>
					<CheckboxInput
						checked={showDiff}
						id="dedupe-show-diff"
						label={t(keys.showDiff)}
						onToggle={() => setShowDiff((value) => !value)}
					/>
				</div>
				{plan.dismissed ? (
					// Marked not duplicates: reopened before it can be merged.
					<Button
						buttonStyle="primary"
						disabled={busy}
						margin={false}
						onClick={() => void decide('reopen')}
						size="large"
					>
						{t(keys.reopen)}
					</Button>
				) : (
					<>
						<Button
							buttonStyle="secondary"
							disabled={busy}
							margin={false}
							onClick={() => void decide('dismiss')}
							size="large"
						>
							{t(keys.dismiss)}
						</Button>
						<Button
							buttonStyle="primary"
							disabled={busy || !answer?.readyToApply}
							margin={false}
							onClick={() => openModal(CONFIRM_MODAL)}
							size="large"
						>
							{t(keys.mergeCount, { count: String(docs.length) })}
						</Button>
					</>
				)}
			</div>

			<ConfirmationModal
				body={t(keys.removeBody)}
				confirmLabel={t(keys.removeFromMerge)}
				heading={t(keys.removeHeading, { title: removing ? titleOf(removing) : '' })}
				modalSlug={REMOVE_MODAL}
				onConfirm={() => {
					if (removing) removeDoc(removing)
				}}
			/>
			<ConfirmationModal
				body={[
					t(keys.confirmBody, {
						absorbed: absorbed.map(titleOf).join(', '),
						survivor: titleOf(survivor),
					}),
					...deletesNote.values(),
				].join(' ')}
				confirmLabel={t(keys.mergeCount, { count: String(docs.length) })}
				heading={t(keys.confirmHeading)}
				modalSlug={CONFIRM_MODAL}
				onConfirm={apply}
			/>
		</div>
	)
}
