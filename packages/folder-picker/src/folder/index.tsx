'use client'

import { getTranslation } from '@payloadcms/translations'
import {
	Button,
	DefaultListView,
	Gutter,
	useConfig,
	useListDrawerContext,
	useTranslation,
} from '@payloadcms/ui'
import type { ListViewClientProps } from 'payload'
import React from 'react'
import { BulkUploadButton } from './BulkUploadButton'
import { FolderBrowser } from './FolderBrowser'
import './folder.css'
const tabsClass = 'default-list-view-tabs'

/**
 * List view for folder-enabled collections. On a real list route it renders Payload's own view
 * untouched, since the route already carries the List/Folders tabs. Inside a list drawer (the
 * upload field's "choose from existing") those tabs are replaced by the drawer header, so this
 * adds them back and swaps in a folder picker that does not navigate.
 */
export const FolderListView: React.FC<ListViewClientProps> = (props) => {
	const { collectionSlug } = props
	const { isInDrawer } = useListDrawerContext()
	const { getEntityConfig } = useConfig()
	const { i18n, t } = useTranslation()
	const [viewType, setViewType] = React.useState<'folders' | 'list'>('list')

	if (!isInDrawer) {
		return <DefaultListView {...props} />
	}

	const collectionConfig = getEntityConfig({ collectionSlug })

	// Same markup as Payload's DefaultListViewTabs, which is internal and always pushes a route.
	const tabs = (
		<div className={tabsClass} key="tabs">
			<Button
				buttonStyle="tab"
				className={[`${tabsClass}__button`, viewType === 'list' && `${tabsClass}__button--active`]
					.filter(Boolean)
					.join(' ')}
				disabled={viewType === 'list'}
				el="button"
				onClick={() => setViewType('list')}
			>
				{t('general:all')} {getTranslation(collectionConfig?.labels?.plural ?? '', i18n)}
			</Button>
			<Button
				buttonStyle="tab"
				className={[
					`${tabsClass}__button`,
					viewType === 'folders' && `${tabsClass}__button--active`,
				]
					.filter(Boolean)
					.join(' ')}
				disabled={viewType === 'folders'}
				el="button"
				onClick={() => setViewType('folders')}
			>
				{t('folder:byFolder')}
			</Button>
		</div>
	)

	// Both modes render their own header and gutter below this, so the tabs sit above in their own
	// gutter. Rendering them identically in both is what keeps placement and spacing the same.
	return (
		<React.Fragment>
			{viewType === 'folders' ? (
				// The folder view renders the tabs row itself so the breadcrumb can sit beside them.
				<FolderBrowser
					collectionSlug={collectionSlug}
					enableRowSelections={props.enableRowSelections}
					Tabs={tabs}
				/>
			) : (
				<React.Fragment>
					{/* DefaultListView owns the drawer header, so bulk upload cannot go beside its Create
						New pill without forking it. It rides with the tabs instead, which is the nearest
						slot this view actually controls. */}
					<Gutter className={`${tabsClass}__drawer-gutter`}>
						<div className={`${tabsClass}__drawer-row`}>
							{tabs}
							<BulkUploadButton
								collectionSlug={collectionSlug}
								enableRowSelections={props.enableRowSelections}
							/>
						</div>
					</Gutter>
					<DefaultListView {...props} />
				</React.Fragment>
			)}
		</React.Fragment>
	)
}

export default FolderListView
