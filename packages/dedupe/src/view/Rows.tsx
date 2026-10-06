'use client'

import {
	Banner,
	CheckboxInput,
	DocumentInfoProvider,
	Form,
	OperationProvider,
	Pill,
	RenderFields,
	ShimmerEffect,
	useAuth,
	useConfig,
	useRowLabel,
	useServerFunctions,
} from '@payloadcms/ui'
import type { FormState, SanitizedFieldsPermissions, SelectType, TypedUser } from 'payload'
import { createContext, type ReactNode, use, useEffect, useMemo, useRef, useState } from 'react'

import { isEmpty, writePath } from '../merge/compare'
import type { DecisionView, DocRef } from '../merge/planResponse'
import { type Entry, fieldAt } from './Value'

const baseClass = 'dedupe-merge'

/** A field whose items are rows: an array or blocks. */
export const isRows = (decision: Pick<DecisionView, 'list' | 'type'>): boolean =>
	decision.list && (decision.type === 'array' || decision.type === 'blocks')

/** The form state a document's rows are drawn from, per locale, or why it could not be built. */
export type RowStates = Record<string, { state: FormState } | { error: string }>

export const rowStateKey = (doc: string, locale: string | undefined): string =>
	`${doc}@${locale ?? ''}`

/**
 * The form state of every document's arrays and blocks, built from the values the plan holds,
 * one request per document and locale, as the bulk edit drawer builds the state of its fields.
 * A document whose rows did not change is not asked for again.
 */
export const useRowStates = (
	collection: string,
	decisions: DecisionView[],
	docs: DocRef[]
): RowStates => {
	const { getFormState } = useServerFunctions()
	const { permissions } = useAuth()
	const docPermissions = permissions?.collections?.[collection]
	const [states, setStates] = useState<RowStates>({})
	const asked = useRef(new Map<string, string>())

	const requests = useMemo(() => {
		const out = new Map<
			string,
			{ data: Record<string, unknown>; locale?: string; select: Record<string, unknown> }
		>()
		for (const decision of decisions.filter((entry) => !entry.hidden && isRows(entry))) {
			for (const doc of docs) {
				const key = rowStateKey(doc.id, decision.locale)
				const request = out.get(key) ?? { data: {}, locale: decision.locale, select: {} }
				const value = decision.values.find((entry) => entry.doc === doc.id)?.value
				if (!isEmpty(value)) writePath(request.data, decision.path, value)
				writePath(request.select, decision.path, true)
				out.set(key, request)
			}
		}
		return out
	}, [decisions, docs])

	useEffect(() => {
		for (const [key, { data, locale, select }] of requests) {
			const signature = JSON.stringify([data, select])
			if (asked.current.get(key) === signature) continue
			asked.current.set(key, signature)
			const settle = (state: RowStates[string]) => {
				if (asked.current.get(key) === signature) {
					setStates((current) => ({ ...current, [key]: state }))
				}
			}
			getFormState({
				collectionSlug: collection,
				data,
				docPermissions,
				docPreferences: { fields: {} },
				locale,
				operation: 'update',
				readOnly: true,
				renderAllFields: true,
				schemaPath: collection,
				select: select as SelectType,
				skipValidation: true,
			}).then(
				(result) =>
					settle(
						result.state
							? { state: result.state }
							: { error: 'message' in result ? result.message : '' }
					),
				(err: unknown) => settle({ error: err instanceof Error ? err.message : String(err) })
			)
		}
	}, [requests, getFormState, collection, docPermissions])

	return states
}

type Picks = {
	entries: Entry[]
	/** Absent where the reviewer does not pick for the field. */
	checked?: (index: number) => boolean
	/** A check that may not be taken off, as the last one of a required list. */
	locked: (index: number) => boolean
	id: (index: number) => string
	toggle: (index: number) => void
}

const PicksContext = createContext<Picks | null>(null)

/**
 * A row's label: the check that takes the row, then the label the admin gives it, or the
 * collection's own row label when it has one.
 */
const RowPick = ({ own }: { own?: ReactNode }) => {
	const { rowNumber = 0 } = useRowLabel()
	const picks = use(PicksContext)
	const entry = picks?.entries[rowNumber]
	if (!picks || !entry) return own ?? null
	return (
		<span className={`${baseClass}__row-pick`}>
			{picks.checked ? (
				<CheckboxInput
					checked={picks.checked(rowNumber)}
					id={picks.id(rowNumber)}
					onToggle={() => picks.toggle(rowNumber)}
					readOnly={picks.locked(rowNumber)}
				/>
			) : null}
			<span className={`${baseClass}__row-title`}>
				<span className={`${baseClass}__row-name`}>
					{own ??
						(entry.block ? (
							<>
								{entry.block.number}
								<Pill pillStyle="white" size="small">
									{entry.block.label}
								</Pill>
							</>
						) : (
							entry.title
						))}
				</span>
			</span>
		</span>
	)
}

/** The state of one field and what it holds, its rows closed and labelled with a check. */
const withPicks = (state: FormState, path: string): FormState =>
	Object.fromEntries(
		Object.entries(state)
			.filter(([key]) => key === path || key.startsWith(`${path}.`))
			.map(([key, field]) =>
				key === path && field.rows
					? [
							key,
							{
								...field,
								rows: field.rows.map((row) => ({
									...row,
									collapsed: true,
									customComponents: {
										...row.customComponents,
										RowLabel: <RowPick own={row.customComponents?.RowLabel} />,
									},
								})),
							},
						]
					: [key, field]
			)
	)

/**
 * A document's rows as its own edit view draws them, read-only, each with a check in its
 * label: a row opens to its fields, the rows inside it included.
 */
export const Rows = ({
	collection,
	decision,
	picks,
	state,
}: {
	collection: string
	decision: Pick<DecisionView, 'path'>
	picks: Picks
	state: RowStates[string] | undefined
}) => {
	const { getEntityConfig } = useConfig()
	const { permissions, user } = useAuth()
	const segments = decision.path.split('.')
	const field = fieldAt(getEntityConfig({ collectionSlug: collection })?.fields ?? [], segments)
	// The reader's field access at the level the field sits in, so a field they may not read is not drawn.
	const fieldPermissions = segments
		.slice(0, -1)
		.reduce<SanitizedFieldsPermissions>((level, name) => {
			if (level === true) return true
			const entry = level[name]
			if (entry === undefined) return {}
			return entry === true ? true : (entry.fields ?? true)
		}, permissions?.collections?.[collection]?.fields ?? true)
	const form = state && 'state' in state ? state.state : undefined
	// A new object makes the form start over, so it only changes with the state it is made from.
	const initialState = useMemo(
		() => (form ? withPicks(form, decision.path) : undefined),
		[form, decision.path]
	)

	return (
		<div className={`${baseClass}__cell ${baseClass}__rows`}>
			{state && 'error' in state ? (
				<Banner type="error">{state.error}</Banner>
			) : !field || !initialState ? (
				<ShimmerEffect height={40} />
			) : (
				<PicksContext value={picks}>
					<DocumentInfoProvider
						collectionSlug={collection}
						currentEditor={user as TypedUser}
						hasPublishedDoc={false}
						initialData={{}}
						isLocked={false}
						lastUpdateTime={0}
						mostRecentVersionIsAutosaved={false}
						unpublishedVersionCount={0}
						versionCount={0}
					>
						<OperationProvider operation="update">
							<Form el="div" initialState={initialState}>
								<RenderFields
									fields={[field]}
									forceRender
									parentIndexPath=""
									parentPath={segments.slice(0, -1).join('.')}
									parentSchemaPath={[collection, ...segments.slice(0, -1)].join('.')}
									permissions={fieldPermissions}
									readOnly
								/>
							</Form>
						</OperationProvider>
					</DocumentInfoProvider>
				</PicksContext>
			)}
		</div>
	)
}
