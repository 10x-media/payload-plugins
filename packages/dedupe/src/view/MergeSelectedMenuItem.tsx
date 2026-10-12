'use client'

import { PopupList, useConfig, useListQuery, useSelection } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { formatAdminURL } from 'payload/shared'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { mergeUrl } from './api'

/**
 * The list view's menu entry: with two rows selected, up to `maxGroupSize`, it opens the
 * merge screen, the first selected row as the survivor.
 */
export function MergeSelectedMenuItem({
	basePath,
	maxGroupSize,
}: {
	basePath: `/${string}`
	maxGroupSize: number
}) {
	const { t } = useTranslation()
	const { selectedIDs } = useSelection()
	const { collectionSlug } = useListQuery()
	const router = useRouter()
	const {
		config: {
			routes: { admin: adminRoute },
		},
	} = useConfig()

	const ready =
		selectedIDs.length >= 2 && selectedIDs.length <= maxGroupSize && Boolean(collectionSlug)

	return (
		<PopupList.Button
			disabled={!ready}
			onClick={() => {
				if (!ready) return
				router.push(
					mergeUrl({
						mergePath: formatAdminURL({ adminRoute, path: `${basePath}/merge` }),
						collection: collectionSlug,
						docs: selectedIDs.map(String),
					})
				)
			}}
		>
			{ready ? t(keys.mergeSelected) : t(keys.selectTwo, { max: String(maxGroupSize) })}
		</PopupList.Button>
	)
}
