'use client'

import {
	Banner,
	CheckboxInput,
	DocumentInfoProvider,
	Drawer,
	escapeDiffHTML,
	FieldDiffContainer,
	FieldLabel,
	Form,
	Gutter,
	OperationProvider,
	Pill,
	RenderFields,
	ShimmerEffect,
	useAuth,
	useConfig,
	useDocumentDrawer,
	useDrawerSlug,
	useLocale,
	useModal,
	useTranslation as usePayloadTranslation,
	useServerFunctions,
	useStepNav,
} from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import { useRouter } from 'next/navigation'
import type { FormState, TypedUser } from 'payload'
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react'

import './index.css'

import { isEmpty, listOf, sameValue } from '../merge/compare'
import { takenItems } from '../merge/plan'
import type { DecisionView } from '../merge/planResponse'
import type { MergeDoc, MergeRecordView } from '../merge/record'
import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { callApi } from './api'
import { MERGE_STATUS, MergeDocLink } from './MergesClient'
import { fieldKey, RelatedTable, rowsByDoc } from './RelatedDocuments'
import { groupLabel, type Mark, type Markup, Plain, SHORT_DATE, useFormat } from './Value'

const baseClass = 'dedupe-record'

const TITLE: Record<MergeRecordView['status'], TranslationKey> = {
	applied: keys.mergedInto,
	applying: keys.mergingInto,
	failed: keys.mergeFailedInto,
}

/** A document that still exists, opened in the admin's own document drawer. */
const LiveDoc = ({
	collection,
	doc,
	onDelete,
}: {
	collection: string
	doc: MergeDoc
	onDelete: () => void
}) => {
	const [DocumentDrawer, DocumentDrawerToggler] = useDocumentDrawer({
		id: doc.id,
		collectionSlug: collection,
	})
	return (
		<>
			<DocumentDrawerToggler className={`${baseClass}__head-name`}>
				{doc.title}
			</DocumentDrawerToggler>
			<DocumentDrawer onDelete={onDelete} />
		</>
	)
}

/**
 * A merged-in document in the trash, opened in a drawer read-only, as its edit view draws its
 * fields. Payload's document drawer loads no document in the trash, so this one reads it with
 * `trash=true` and builds its form state as the rows on the merge screen are built.
 */
const TrashedDoc = ({ collection, doc }: { collection: string; doc: MergeDoc }) => {
	const { t } = usePayloadTranslation()
	const {
		config: {
			routes: { api: apiRoute },
		},
		getEntityConfig,
	} = useConfig()
	const { permissions, user } = useAuth()
	const { code: locale } = useLocale()
	const { getFormState } = useServerFunctions()
	const { openModal } = useModal()
	const slug = useDrawerSlug(`dedupe-trashed-${doc.id}`)
	const [state, setState] = useState<{ state: FormState } | { error: string } | null>(null)
	const fields = getEntityConfig({ collectionSlug: collection })?.fields ?? []

	const open = async () => {
		openModal(slug)
		if (state && 'state' in state) return
		try {
			const data = await callApi<Record<string, unknown>>({
				apiRoute,
				path: `/${collection}/${doc.id}?trash=true&depth=0${locale ? `&locale=${locale}&fallback-locale=none` : ''}`,
			})
			const result = await getFormState({
				collectionSlug: collection,
				data,
				...(locale ? { locale } : {}),
				docPermissions: permissions?.collections?.[collection],
				docPreferences: { fields: {} },
				operation: 'update',
				readOnly: true,
				renderAllFields: true,
				schemaPath: collection,
				skipValidation: true,
			})
			setState(
				result.state
					? { state: result.state }
					: { error: 'message' in result ? result.message : '' }
			)
		} catch (err) {
			setState({ error: err instanceof Error ? err.message : String(err) })
		}
	}

	return (
		<>
			<button className={`${baseClass}__head-name`} onClick={() => void open()} type="button">
				{doc.title}
			</button>
			<Pill size="small">{t('general:trash')}</Pill>
			<Drawer slug={slug} title={doc.title}>
				{state === null ? (
					<ShimmerEffect height={200} />
				) : 'error' in state ? (
					<Banner type="error">{state.error}</Banner>
				) : (
					<DocumentInfoProvider
						collectionSlug={collection}
						currentEditor={user as TypedUser}
						hasPublishedDoc={false}
						id={doc.id}
						initialData={{}}
						isLocked={false}
						lastUpdateTime={0}
						mostRecentVersionIsAutosaved={false}
						unpublishedVersionCount={0}
						versionCount={0}
					>
						<OperationProvider operation="update">
							<Form el="div" initialState={state.state}>
								<RenderFields
									fields={fields}
									forceRender
									parentIndexPath=""
									parentPath=""
									parentSchemaPath={collection}
									permissions={permissions?.collections?.[collection]?.fields ?? true}
									readOnly
								/>
							</Form>
						</OperationProvider>
					</DocumentInfoProvider>
				)}
			</Drawer>
		</>
	)
}

/** A section with a heading, as the admin draws a group field. */
const Section = ({ children, title }: { children: ReactNode; title: string }) => (
	<div className={`field-type group-field group-field--top-level ${baseClass}__section`}>
		<div className="group-field__wrap">
			<div className="group-field__header">
				<h3 className="group-field__title">
					<FieldLabel as="span" label={title} />
				</h3>
			</div>
			{children}
		</div>
	</div>
)

type Row = {
	key: string
	path: string
	type: string
	label: string
	locale?: string
	/** Each document's value before the merge, in column order. */
	cells: Markup[]
	/** Some document held a value other than the result's. */
	modified: boolean
	/** Columns whose whole list went into the result, filled as a single value is. */
	filled?: boolean[]
}

/**
 * One merge record, laid out as a document and its "Compare versions": the title and the
 * facts of the merge in the document's header, then every document of the merge as it was,
 * the primary first. What the merge took is marked as a whole, in the version view's colour
 * for an addition, in the column it came from; what it left is not marked. The IDs come
 * first: the version view leaves them out, since a document keeps its own, but a merge
 * keeps only the primary's.
 */
export function MergeRecordClient({
	queuePath,
	record,
}: {
	queuePath: string
	record: MergeRecordView
}) {
	const { i18n, t } = useTranslation()
	const { t: payloadT } = usePayloadTranslation()
	const router = useRouter()
	const { setStepNav } = useStepNav()
	const { markup } = useFormat(record.collection)
	const [modifiedOnly, setModifiedOnly] = useState(true)
	const { survivor, absorbed } = record
	const date = formatDate({ date: record.createdAt, i18n, pattern: SHORT_DATE })
	const titleOf = (id: string) => [survivor, ...absorbed].find((doc) => doc.id === id)?.title ?? id

	useEffect(() => {
		setStepNav([
			{ label: t(keys.historyTitle), url: `${queuePath}/merges` },
			{ label: survivor.title },
		])
	}, [setStepNav, t, queuePath, survivor.title])

	const docs = [survivor, ...absorbed]
	// What a failed or unfinished merge wrote is unknown, so nothing is marked as its result.
	const applied = record.status === 'applied'
	const valueIn = (decision: DecisionView, doc: string) =>
		decision.values.find((entry) => entry.doc === doc)?.value
	// A value of the result is marked in the one column it came from: the plan's source, or
	// for a list item the first document holding it, the primary before the rest, as the merge
	// screen takes a value once.
	const rowOf = (decision: DecisionView): Omit<Row, 'key' | 'path' | 'type' | 'label'> => {
		const { proposed } = decision
		const resultDoc = decision.source === 'same' ? survivor.id : decision.source
		const modified = docs.some((doc) => !sameValue(valueIn(decision, doc.id), proposed, decision))
		if (decision.list || decision.type === 'array' || decision.type === 'blocks') {
			const taken = takenItems({
				...decision,
				values: docs.map((doc) => ({ doc: doc.id, value: valueIn(decision, doc.id) })),
			})
			return {
				cells: docs.map((doc) => {
					const items = listOf(valueIn(decision, doc.id))
					return markup(decision, valueIn(decision, doc.id), {
						doc: doc.id,
						mark: (index): Mark => (applied && taken(doc.id, items[index]) ? 'create' : undefined),
					})
				}),
				filled: docs.map((doc) => {
					const items = listOf(valueIn(decision, doc.id))
					return applied && items.length > 0 && items.every((item) => taken(doc.id, item))
				}),
				modified,
			}
		}
		const holds = (doc: MergeDoc) =>
			!isEmpty(valueIn(decision, doc.id)) &&
			sameValue(valueIn(decision, doc.id), proposed, decision)
		const source =
			docs.find((doc) => doc.id === resultDoc && holds(doc)) ?? docs.find((doc) => holds(doc))
		return {
			cells: docs.map((doc) =>
				markup(decision, valueIn(decision, doc.id), {
					doc: doc.id,
					mark: applied && doc === source ? 'create' : undefined,
				})
			),
			modified,
		}
	}
	const idMarkup = (id: string, mark?: Mark) => ({
		html: `<p>${mark ? `<span data-match-type="${mark}">${escapeDiffHTML(id)}</span>` : escapeDiffHTML(id)}</p>`,
		byCharacter: false,
	})
	const idRow: Row = {
		key: 'id',
		path: 'id',
		type: 'text',
		label: 'ID',
		cells: docs.map(({ id }) => idMarkup(id, applied && id === survivor.id ? 'create' : undefined)),
		modified: true,
	}
	const fields: Row[] = record.decisions.map((decision) => {
		const group = groupLabel(decision.path)
		return {
			key: decision.key,
			path: decision.path,
			type: decision.type,
			label: group ? `${group} / ${decision.label}` : decision.label,
			...(decision.locale ? { locale: decision.locale } : {}),
			...rowOf(decision),
		}
	})
	const shown = [idRow, ...(modifiedOnly ? fields.filter((row) => row.modified) : fields)]
	// The line between columns, one layer over the heads and one over the fields.
	const rails = (
		<div aria-hidden="true" className={`${baseClass}__rails`}>
			{docs.map((doc) => (
				<span key={doc.id} />
			))}
		</div>
	)
	const status = MERGE_STATUS[record.status]
	const moved = new Map<string, MergeRecordView['moved']>()
	for (const entry of record.moved) {
		const key = fieldKey(entry)
		moved.set(key, [...(moved.get(key) ?? []), entry])
	}
	const meta: [string, ReactNode][] = [
		[payloadT('version:status'), t(status.key)],
		[payloadT('general:created'), date],
		[payloadT('general:user'), record.appliedBy ?? '-'],
		[t(keys.collection), record.collectionLabel],
	]

	return (
		<main className={`view-version ${baseClass}`}>
			<Gutter className="doc-header">
				<div className="doc-header__header">
					<h1 className="render-title doc-header__title">
						{t(TITLE[record.status], { title: survivor.title })}
					</h1>
				</div>
			</Gutter>
			<Gutter className="doc-controls">
				<div className="doc-controls__wrapper">
					<div className="doc-controls__content">
						<ul className="doc-controls__meta">
							{meta.map(([label, value]) => (
								<li className="doc-controls__list-item doc-controls__value-wrap" key={label}>
									<p className="doc-controls__label">{label}:&nbsp;</p>
									<p className="doc-controls__value">{value}</p>
								</li>
							))}
						</ul>
					</div>
				</div>
				<div className="doc-controls__divider" />
			</Gutter>

			{record.status === 'failed' && record.error ? (
				<Gutter>
					<Banner type="error">{record.error}</Banner>
				</Gutter>
			) : null}

			<Gutter className="view-version-controls-top">
				<div className="view-version-controls-top__wrapper">
					<h2>{payloadT('version:compareVersions')}</h2>
					<div className="view-version-controls-top__wrapper-actions">
						<span className="view-version__modifiedCheckBox">
							<CheckboxInput
								checked={modifiedOnly}
								id="modifiedOnly"
								label={payloadT('version:modifiedOnly')}
								onToggle={() => setModifiedOnly((value) => !value)}
							/>
						</span>
					</div>
				</div>
			</Gutter>

			{/* The heads and the fields scroll sideways together once the columns outgrow the page. */}
			<div
				className={`${baseClass}__compare${docs.length > 2 ? ` ${baseClass}__compare--scroll` : ''}`}
				style={{ '--dedupe-cols': docs.length } as CSSProperties}
			>
				<Gutter className="view-version-controls-bottom">
					{rails}
					<div className={`view-version-controls-bottom__wrapper ${baseClass}__heads`}>
						{docs.map((doc) => (
							<div className={`view-version__version-from ${baseClass}__head`} key={doc.id}>
								<div className="view-version__version-from-labels">
									<span>{t(doc.id === survivor.id ? keys.primaryRole : keys.mergedIn)}</span>
								</div>
								<div className="view-version__version-to-version">
									{/* Every document opens in a drawer, as on the merge screen; one deleted
									    since has only its name. */}
									<h2>
										{doc.state === 'live' ? (
											<LiveDoc
												collection={record.collection}
												doc={doc}
												onDelete={() => router.refresh()}
											/>
										) : doc.state === 'trash' ? (
											<TrashedDoc collection={record.collection} doc={doc} />
										) : (
											<MergeDocLink collection={record.collection} doc={doc} />
										)}
									</h2>
								</div>
							</div>
						))}
					</div>
				</Gutter>

				<Gutter className="view-version__diff-wrap">
					{rails}
					<div className="render-field-diffs">
						{shown.map((row) => (
							<div
								className={`render-field-diffs__field field__${row.type}`}
								data-field-path={row.path}
								key={row.key}
							>
								<FieldDiffContainer
									From={row.cells.map((cell, index) => (
										<div
											className={`${baseClass}__cell${row.filled?.[index] ? ` ${baseClass}__cell--taken` : ''}`}
											key={docs[index]?.id}
										>
											<Plain markup={cell} />
										</div>
									))}
									i18n={i18n}
									label={{ label: row.label, locale: row.locale }}
									To={null}
								/>
							</div>
						))}
					</div>
				</Gutter>
			</div>

			{moved.size > 0 ? (
				<Gutter className={`${baseClass}__block`}>
					<Section title={t(keys.relatedDocuments)}>
						{[...moved.values()].map((group) => {
							const [first] = group as [MergeRecordView['moved'][number]]
							return (
								<RelatedTable
									collection={first.collection}
									global={first.global}
									heading={`${first.collectionLabel} · ${first.label}`}
									key={fieldKey(first)}
									more={group.reduce((sum, entry) => sum + entry.total - entry.docs.length, 0)}
									noteHeading={t(keys.pointedAt)}
									onChanged={() => router.refresh()}
									rows={rowsByDoc(group, titleOf)}
								/>
							)
						})}
					</Section>
				</Gutter>
			) : null}
		</main>
	)
}
