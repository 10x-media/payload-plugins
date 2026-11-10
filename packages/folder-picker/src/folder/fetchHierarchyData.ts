import { getTranslation, type I18nClient } from '@payloadcms/translations'
import type {
	ClientCollectionConfig,
	HierarchyViewData,
	PaginatedDocs,
	RelatedDocumentsGrouped,
	Where,
} from 'payload'
import { DEFAULT_HIERARCHY_LIST_LIMIT, formatAdminURL } from 'payload/shared'
import * as qs from 'qs-esm'

import { andWhere, childrenWhere, type FolderHierarchy, filedInWhere } from './hierarchy'

type ID = number | string

export type FetchHierarchyArgs = {
	apiRoute: string
	/** Applied to the folder query: which folders this drawer may show at all. */
	baseFilter?: Where
	getEntityConfig: (args: { collectionSlug: string }) => ClientCollectionConfig | undefined
	hierarchy: FolderHierarchy
	i18n: I18nClient
	parentId: ID | null
	/** Applied per related collection, e.g. to hide what the field already holds. */
	relatedBaseFilters: Record<string, Where | undefined>
	/** The collections the drawer picks from that file into `hierarchy`. */
	relatedSlugs: string[]
	search: string
	serverURL?: string
	signal?: AbortSignal
}

/**
 * Deep enough for any real folder tree in one request: the parent relationship populates
 * upwards, so the folder doc carries its whole ancestor chain.
 */
const ANCESTOR_DEPTH = 10

/**
 * Client-side counterpart of Payload's `handleHierarchy`, which only runs inside `renderListView`
 * for a hierarchy route. The list drawer never renders that view type, so the plugin builds the
 * same `HierarchyViewData` over REST, the way `HierarchyTable` already loads its later pages.
 * Access control applies as for any REST read; admin `baseFilter`s do not, as in that table.
 */
export const fetchHierarchyData = async ({
	apiRoute,
	baseFilter,
	getEntityConfig,
	hierarchy,
	i18n,
	parentId,
	relatedBaseFilters,
	relatedSlugs,
	search,
	serverURL,
	signal,
}: FetchHierarchyArgs): Promise<HierarchyViewData> => {
	const get = async <T>(path: `/${string}`, query: Record<string, unknown>): Promise<T> => {
		const url = formatAdminURL({
			apiRoute,
			path: `${path}${qs.stringify(query, { addQueryPrefix: true })}`,
			serverURL,
		})
		const response = await fetch(url, { credentials: 'include', signal })
		if (!response.ok) {
			throw new Error(`Request failed: ${response.status} ${url}`)
		}
		return (await response.json()) as T
	}

	const { fieldName, parentFieldName, slug, useAsTitle } = hierarchy

	const parentRequest =
		parentId === null
			? Promise.resolve(null)
			: get<Record<string, unknown> & { id: ID }>(`/${slug}/${encodeURIComponent(parentId)}`, {
					depth: ANCESTOR_DEPTH,
				})

	const childrenRequest = get<PaginatedDocs>(`/${slug}`, {
		depth: 0,
		draft: true,
		limit: DEFAULT_HIERARCHY_LIST_LIMIT,
		where: andWhere(
			childrenWhere(parentFieldName, parentId),
			search ? { [useAsTitle]: { like: search } } : undefined,
			baseFilter
		),
	})

	const relatedRequests = relatedSlugs.map(async (relatedSlug) => {
		const config = getEntityConfig({ collectionSlug: relatedSlug })
		const title = config?.admin?.useAsTitle ?? 'id'
		const result = await get<PaginatedDocs>(`/${relatedSlug}`, {
			depth: 0,
			draft: true,
			limit: DEFAULT_HIERARCHY_LIST_LIMIT,
			where: andWhere(
				filedInWhere(fieldName, parentId),
				search ? { [title]: { like: search } } : undefined,
				relatedBaseFilters[relatedSlug]
			),
		})
		return { config, relatedSlug, result }
	})

	const [parent, childrenData, related] = await Promise.all([
		parentRequest,
		childrenRequest,
		Promise.all(relatedRequests),
	])

	const relatedDocumentsByCollection: RelatedDocumentsGrouped = {}
	for (const { config, relatedSlug, result } of related) {
		if (result.totalDocs > 0) {
			relatedDocumentsByCollection[relatedSlug] = {
				fieldName,
				hasMany: false,
				label: getTranslation(config?.labels?.plural ?? relatedSlug, i18n),
				result,
			}
		}
	}

	const relatedFilters = Object.fromEntries(
		Object.entries(relatedBaseFilters).filter((entry): entry is [string, Where] =>
			Boolean(entry[1])
		)
	)

	return {
		// Payload derives this from the parent folder's types and limits Create New to it. A drawer
		// picks from its own collections only, so a document of any other type created here could
		// not be picked: offer the drawer's collections (and folders, which the view always adds).
		allowedCollections: relatedSlugs.map((relatedSlug) => ({
			label: getTranslation(
				getEntityConfig({ collectionSlug: relatedSlug })?.labels?.plural ?? relatedSlug,
				i18n
			),
			slug: relatedSlug,
		})),
		baseFilter,
		breadcrumbs: parent ? ancestorTrail(parent, parentFieldName, useAsTitle) : [],
		childrenData,
		parent: parent ? { ...parent, [parentFieldName]: idOf(parent[parentFieldName]) } : null,
		parentFieldName,
		parentId,
		relatedBaseFilters: Object.keys(relatedFilters).length > 0 ? relatedFilters : undefined,
		relatedDocumentsByCollection,
	}
}

const idOf = (value: unknown): unknown =>
	value && typeof value === 'object' && 'id' in value ? (value as { id: unknown }).id : value

/**
 * Root first, `doc` last, read off the populated parent chain. Stops where population did
 * (a bare id), which only happens past `ANCESTOR_DEPTH`.
 */
export const ancestorTrail = (
	doc: Record<string, unknown> & { id: ID },
	parentFieldName: string,
	useAsTitle: string
): HierarchyViewData['breadcrumbs'] => {
	const trail: HierarchyViewData['breadcrumbs'] = []
	let cursor: unknown = doc
	while (cursor && typeof cursor === 'object' && 'id' in cursor) {
		const node = cursor as Record<string, unknown> & { id: ID }
		trail.unshift({ id: node.id, title: String(node[useAsTitle] ?? node.id) })
		cursor = node[parentFieldName]
	}
	return trail
}
