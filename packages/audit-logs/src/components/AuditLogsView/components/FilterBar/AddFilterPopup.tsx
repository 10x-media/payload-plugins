'use client'

import { Popup, PopupList } from '@payloadcms/ui'
import type React from 'react'
import { useState } from 'react'
import { keys } from '../../../../translations/keys'
import { useTranslation } from '../../../../translations/useTranslation'
import type { Filters, SelectOption } from '../../types'
import type { AvailableFilter, FilterField } from './types'
import { ValueEditor } from './ValueEditor'

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
	const { t } = useTranslation()
	const [editing, setEditing] = useState<{ index?: number; key: FilterField } | null>(null)

	return (
		<Popup
			button={
				<button className="al-filterbar__add" type="button">
					{t(keys.addFilter)}
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
