'use client'

import { getTranslation } from '@payloadcms/translations'
import {
	Button,
	ChevronIcon,
	DefaultListView,
	useConfig,
	useListDrawerContext,
	useModal,
	useTranslation,
} from '@payloadcms/ui'
import type { ListViewClientProps } from 'payload'
import React from 'react'

import { BulkUploadButton } from './BulkUploadButton'
import { type BrowseState, rootState } from './browseState'
import { HierarchyBrowser } from './HierarchyBrowser'
import { findFolderHierarchy } from './hierarchy'
import './folder.css'

const baseClass = 'folder-picker'
const tabsClass = 'default-list-view-tabs'

type Mode = 'folders' | 'list'

/**
 * Tab and folder per drawer. Switching collection in a polymorphic drawer, or any other refresh,
 * replaces the rendered list view with a fresh one from the server, so component state alone
 * would drop the user back on the list tab at the root.
 */
const drawerState = new Map<string, { browse: BrowseState; collectionSlug: string; mode: Mode }>()

/**
 * List view for every collection that files into a folder collection. On the collection route it
 * is Payload's own view, untouched. Inside a list drawer (an upload field's "choose from
 * existing", a relationship with `appearance: 'drawer'`, the lexical upload node) it adds the
 * route's All / By folder tabs back, and the folder tab hosts Payload's hierarchy view.
 */
export const FolderListView: React.FC<ListViewClientProps> = (props) => {
	const { collectionSlug, enableRowSelections } = props
	const { drawerSlug, isInDrawer } = useListDrawerContext()
	const { config, getEntityConfig } = useConfig()
	const { closeModal } = useModal()
	const { i18n, t } = useTranslation()

	const hierarchy = React.useMemo(
		() => findFolderHierarchy(config.collections, collectionSlug),
		[config.collections, collectionSlug]
	)

	const key = drawerSlug ?? ''
	const [state, setState] = React.useState(() => {
		const saved = drawerState.get(key)
		// A folder of one collection means nothing to the next, so a switch keeps only the tab.
		return {
			browse: saved?.collectionSlug === collectionSlug ? saved.browse : rootState,
			collectionSlug,
			mode: saved?.mode ?? ('list' as Mode),
		}
	})
	const update = React.useCallback(
		(next: Partial<typeof state>) => setState((current) => ({ ...current, ...next })),
		[]
	)
	const browse = state.collectionSlug === collectionSlug ? state.browse : rootState
	React.useEffect(() => {
		drawerState.set(key, { browse, collectionSlug, mode: state.mode })
	}, [browse, collectionSlug, key, state.mode])

	if (!isInDrawer || !hierarchy) {
		return <DefaultListView {...props} />
	}

	const collectionLabel = getTranslation(
		getEntityConfig({ collectionSlug })?.labels?.plural ?? collectionSlug,
		i18n
	)
	const folderLabel = getTranslation(
		getEntityConfig({ collectionSlug: hierarchy.slug })?.labels?.singular ?? hierarchy.slug,
		i18n
	)

	// Payload's `DefaultListViewTabs` markup; the component itself always pushes a route.
	const tab = (mode: Mode, label: string, id: string) => (
		<Button
			buttonStyle={state.mode === mode ? 'pill' : 'ghost'}
			className={[`${tabsClass}__button`, state.mode === mode && `${tabsClass}__button--active`]
				.filter(Boolean)
				.join(' ')}
			disabled={state.mode === mode}
			el="button"
			id={id}
			onClick={() => update({ mode })}
		>
			{label}
		</Button>
	)

	return (
		<div className={`${baseClass}__drawer ${baseClass}__drawer--${state.mode}`}>
			<div className={`${baseClass}__bar`}>
				<Button
					aria-label={t('general:close')}
					buttonStyle="ghost"
					className="close-modal-button"
					icon={<ChevronIcon direction="left" size={24} />}
					onClick={() => drawerSlug && closeModal(drawerSlug)}
				/>
				<div className={tabsClass}>
					{tab('list', `${t('general:all')} ${collectionLabel}`, `${baseClass}-tab-list`)}
					{tab('folders', `${t('general:by')} ${folderLabel}`, `${baseClass}-tab-folders`)}
				</div>
				<BulkUploadButton
					collectionSlug={collectionSlug}
					enableRowSelections={enableRowSelections}
					parentID={state.mode === 'folders' ? browse.parentId : null}
				/>
			</div>
			{state.mode === 'folders' ? (
				<HierarchyBrowser
					collectionSlug={collectionSlug}
					enableRowSelections={enableRowSelections}
					hierarchy={hierarchy}
					onStateChange={(next) => update({ browse: next, collectionSlug })}
					state={browse}
				/>
			) : (
				<DefaultListView {...props} />
			)}
		</div>
	)
}

export default FolderListView
