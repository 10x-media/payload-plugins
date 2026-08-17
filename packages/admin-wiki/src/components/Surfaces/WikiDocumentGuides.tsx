'use client'

import { useDrawerSlug, useModal } from '@payloadcms/ui'
import { useState } from 'react'

import type { WikiTargetEntry } from '../../shared/targetKeys'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { WikiWriteGuide } from '../FieldHelp/WikiWriteGuide'
import { useWikiFieldPicker } from '../FieldPicker/WikiPickerContext'
import { GuideDrawer } from '../GuideDrawer/GuideDrawer'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import { WikiAllGuidesButton } from './WikiAllGuidesButton'
import { WikiGuideCard } from './WikiGuideCard'
import './surfaces.css'

/** Guides shown in full before the panel defers the rest to the drawer. */
const INLINE_LIMIT = 2

export type WikiDocumentGuidesProps = {
	/** The document's or global's target key, e.g. `collection:posts`. */
	targetKey: string
}

/**
 * The guides panel for a document or global, rendered as a sidebar UI field.
 *
 * The sidebar is where document-scoped facts live, which is what a guide about
 * this collection is; the document controls beside Save are a strip of actions,
 * and a guide is not an action. Being a field also means Payload collapses the
 * sidebar to nothing when this renders null, so a collection nobody has written
 * about keeps its full-width edit view.
 *
 * Nothing inside the field picker, the same way `WikiBlockHelp` is silent there:
 * silencing it rather than filtering the field out keeps the field indexes the
 * schema paths are computed from exactly as Payload built them.
 */
export const WikiDocumentGuides = ({ targetKey }: WikiDocumentGuidesProps) => {
	const { t } = useTranslation()
	const { entriesFor } = useWikiTargets()
	const { openModal } = useModal()
	const picker = useWikiFieldPicker()
	const drawerSlug = useDrawerSlug('wiki-document-guides')
	const [initialGuideId, setInitialGuideId] = useState<number | string | undefined>(undefined)
	const entries = entriesFor(targetKey)

	if (picker) {
		return null
	}

	if (entries.length === 0) {
		return <WikiWriteGuide targetKey={targetKey} variant="button" />
	}

	const open = (entry?: WikiTargetEntry) => {
		setInitialGuideId(entry?.id)
		openModal(drawerSlug)
	}

	return (
		<div className="wiki-doc-guides">
			<p className="wiki-doc-guides__label">{t(keys.surfaceTriggerLabel)}</p>
			<ul className="wiki-doc-guides__list">
				{entries.slice(0, INLINE_LIMIT).map((entry) => (
					<li key={entry.id}>
						<WikiGuideCard compact entry={entry} onClick={() => open(entry)} />
					</li>
				))}
			</ul>
			{entries.length > INLINE_LIMIT ? (
				<WikiAllGuidesButton count={entries.length} onClick={() => open()} />
			) : null}
			<GuideDrawer entries={entries} initialGuideId={initialGuideId} slug={drawerSlug} />
		</div>
	)
}
