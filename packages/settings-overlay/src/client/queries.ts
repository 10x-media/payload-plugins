'use client'

import type { useServerFunctions } from '@payloadcms/ui'
import { QueryClient, queryOptions } from '@tanstack/react-query'
import type { ListQuery, ServerFunctionClient } from 'payload'
import type React from 'react'

import type { LazyItemTransport } from './transport'

/**
 * The panel's cache. Created per provider, never at module scope: a module-level client would
 * outlive the provider and keep the previous reader's renders after a logout.
 *
 * `structuralSharing` is off for every query. React Query would otherwise walk each result
 * looking for unchanged subtrees to reuse, and a React element tree is exactly the kind of
 * plain-object graph it would try to merge. A rendered view is data to store, not to diff.
 */
export const createOverlayQueryClient = (): QueryClient =>
	new QueryClient({
		defaultOptions: {
			queries: {
				refetchOnWindowFocus: false,
				retry: false,
				structuralSharing: false,
			},
		},
	})

export const overlayKeys = {
	all: ['settings-overlay'] as const,
	document: (entity: 'collection' | 'global', slug: string, docID: string | undefined) =>
		['settings-overlay', 'document', entity, slug, docID ?? 'new'] as const,
	item: (overlayId: string, itemSlug: string) =>
		['settings-overlay', 'item', overlayId, itemSlug] as const,
	list: (collectionSlug: string, panelSlug: string, query: ListQuery | undefined) =>
		['settings-overlay', 'list', collectionSlug, panelSlug, query ?? null] as const,
	lists: (collectionSlug: string) => ['settings-overlay', 'list', collectionSlug] as const,
}

/**
 * Payload's list view in drawer mode. Fresh for half a minute, then revalidated in the
 * background on the next mount; a save or delete in the pane invalidates it outright.
 */
export const listQuery = (
	serverFunction: ServerFunctionClient,
	args: { collectionSlug: string; panelSlug: string; query?: ListQuery }
) =>
	queryOptions({
		queryFn: async () => {
			const result = (await serverFunction({
				name: 'render-list',
				args: {
					collectionSlug: args.collectionSlug,
					disableBulkDelete: false,
					disableBulkEdit: false,
					disableQueryPresets: true,
					drawerSlug: args.panelSlug,
					enableRowSelections: true,
					overrideEntityVisibility: true,
					query: args.query ?? {},
				},
			})) as { List: React.ReactNode }
			return result?.List ?? null
		},
		queryKey: overlayKeys.list(args.collectionSlug, args.panelSlug, args.query),
		staleTime: 30 * 1000,
	})

export type DocumentQueryArgs = {
	docID?: string
	entity: 'collection' | 'global'
	isCreate: boolean
	panelSlug: string
	slug: string
}

/**
 * Payload's edit view for a document, the create form or a global. Always refetched on mount
 * (a form must not open on stale data), while a cached render shows meanwhile, so reopening a
 * document is instant and then quietly current.
 */
export const documentQuery = (
	renderDocument: ReturnType<typeof useServerFunctions>['renderDocument'],
	args: DocumentQueryArgs
) =>
	queryOptions({
		gcTime: 5 * 60 * 1000,
		queryFn: async () => {
			const result = await renderDocument(renderDocumentArgs(args))
			return result?.Document ?? null
		},
		queryKey: overlayKeys.document(args.entity, args.slug, args.isCreate ? undefined : args.docID),
		refetchOnMount: 'always',
		staleTime: 0,
	})

/**
 * The argument object `renderDocument` takes for one pane target.
 *
 * A global goes through the same server function as a collection document: Payload's own
 * version-comparison drawer passes a global's slug as `collectionSlug` with `paramsOverride`
 * segments `['globals', slug]`, and the handler resolves the global from that. The create form
 * needs its own override too, or the handler builds segments `['collections', slug, 'undefined']`
 * and skips the create-permission gate.
 */
export const renderDocumentArgs = (args: DocumentQueryArgs) => ({
	collectionSlug: args.slug,
	// Payload's dots menu reports delete, duplicate and restore through a drawer context the pane
	// cannot provide, so it is hidden and `client/documentActions.tsx` renders those same actions
	// wired to the panel instead.
	disableActions: true,
	docID: args.docID as unknown as string,
	drawerSlug: args.panelSlug,
	overrideEntityVisibility: true,
	...(args.entity === 'global'
		? { paramsOverride: { segments: ['globals', args.slug] } }
		: args.isCreate
			? { paramsOverride: { segments: ['collections', args.slug, 'create'] } }
			: {}),
	redirectAfterCreate: false,
	redirectAfterDelete: false,
	redirectAfterDuplicate: false,
	// `handleServerFunction` forwards only the three above, so this one never reaches the view.
	// It is set for the day it does; until then the actions menu passes the flag as a prop.
	redirectAfterRestore: false,
})

/**
 * A `view` item, or a `component` item that asked to be lazy.
 *
 * `searchParams` are the page's current query parameters minus the panel's own, handed over as
 * a page would hand them, and part of the key: an embedded view that pages through
 * `router.push('?page=2')` is re-rendered for page 2.
 */
export const lazyItemQuery = (
	transport: LazyItemTransport,
	serverFunction: ServerFunctionClient,
	args: { itemSlug: string; overlayId: string; searchParams: Record<string, string> }
) =>
	queryOptions({
		queryFn: () =>
			transport({
				itemSlug: args.itemSlug,
				overlayId: args.overlayId,
				searchParams: args.searchParams,
				serverFunction,
			}),
		queryKey: [...overlayKeys.item(args.overlayId, args.itemSlug), args.searchParams] as const,
		refetchOnMount: 'always',
		staleTime: 0,
	})
