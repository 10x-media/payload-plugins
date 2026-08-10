'use client'

import { Popup, PopupList, useTranslation } from '@payloadcms/ui'
import type React from 'react'
import { useState } from 'react'

import type {
	CustomTranslationsKeys,
	CustomTranslationsObject,
} from '../../../../translations/index.js'

import type { Filters, SelectOption } from '../../types.js'
import type { AvailableFilter, FilterField } from './types.js'
import { ValueEditor } from './ValueEditor.js'

type Props = {
	availableToAdd: AvailableFilter[]
	collectionSlugs: string[]
	globalSlugs: string[]
	setStaged: React.Dispatch<React.SetStateAction<Filters>>
	staged: Filters
	tenantOptions?: SelectOption[]
	userTitleFields: Record<string, string>
}

export function AddFilterPopup({
	availableToAdd,
	collectionSlugs,
	globalSlugs,
	setStaged,
	staged,
	tenantOptions,
	userTitleFields,
}: Props) {
	const { t } = useTranslation<CustomTranslationsObject, CustomTranslationsKeys>()
	const [editing, setEditing] = useState<{ index?: number; key: FilterField } | null>(null)

	return (
		<Popup
			button={
				<button className="al-filterbar__add" type="button">
					{t('auditPlugin:addFilter')}
				</button>
			}
			buttonType="custom"
			caret={false}
			horizontalAlign="left"
			onToggleClose={() => setEditing(null)}
			portalClassName="al-filter-popup"
			render={({ close }) =>
				editing === null ? (
					<div data-popup-prevent-close>
						<PopupList.ButtonGroup>
							{availableToAdd.map(({ key, label }) => (
								<PopupList.Button
									key={key}
									onClick={() =>
										setEditing(key === 'changedPath' ? { key: 'changedPath', index: -1 } : { key })
									}
								>
									{label}
								</PopupList.Button>
							))}
						</PopupList.ButtonGroup>
					</div>
				) : (
					<ValueEditor
						collectionSlugs={collectionSlugs}
						field={editing.key}
						globalSlugs={globalSlugs}
						index={editing.index}
						onClose={close}
						setStaged={setStaged}
						staged={staged}
						tenantOptions={tenantOptions}
						userTitleFields={userTitleFields}
					/>
				)
			}
			size="fit-content"
		/>
	)
}
