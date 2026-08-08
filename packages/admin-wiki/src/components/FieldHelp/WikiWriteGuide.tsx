'use client'

import { Button, PopupList, useDocumentDrawer } from '@payloadcms/ui'

import { targetFieldNameFor } from '../../shared/targetKeys'
import { parseTargetKey } from '../../shared/targetLabels'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { BookIcon } from '../icons'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import './field-help.css'

/** The new guide's prefilled target list: one value in the matching field. */
const initialDataFor = (targetKey: string): null | Record<string, string[]> => {
	const parsed = parseTargetKey(targetKey)
	return parsed ? { [targetFieldNameFor(parsed.kind)]: [parsed.value] } : null
}

export type WikiWriteGuideProps = {
	/** The surface the new guide should target, e.g. `field:collection:posts.title`. */
	targetKey: string
	/**
	 * `inline` is the hover-revealed line beside a field, `button` the standalone
	 * pill on a list or edit view header, `menuItem` a row in the ⋯ menu.
	 */
	variant?: 'button' | 'inline' | 'menuItem'
}

/**
 * The "write this guide" affordance for a surface that has none. Opens a create
 * drawer for the wiki pages collection with the target already filled in, so
 * the author never retypes a schema path and never leaves the page whose field
 * they were looking at. Saving refreshes the targets map, so the new guide's
 * trigger appears in place of this affordance without a reload.
 *
 * Renders nothing unless the reader's create permission resolves true and the
 * configured `writeAffordances` mode allows it (by default, only while wiki
 * edit mode is on).
 */
export const WikiWriteGuide = ({ targetKey, variant = 'inline' }: WikiWriteGuideProps) => {
	const { t } = useTranslation()
	const { canWrite, pagesSlug, refresh } = useWikiTargets()
	const [DocumentDrawer, DocumentDrawerToggler, { openDrawer }] = useDocumentDrawer({
		collectionSlug: pagesSlug,
	})
	const initialData = initialDataFor(targetKey)

	if (!canWrite || !initialData) {
		return null
	}

	const label = t(keys.fieldHelpWriteGuide)
	const drawer = <DocumentDrawer initialData={initialData} onSave={refresh} />

	if (variant === 'menuItem') {
		return (
			<>
				<PopupList.Button onClick={openDrawer}>{label}</PopupList.Button>
				{drawer}
			</>
		)
	}

	if (variant === 'button') {
		return (
			<>
				<Button
					buttonStyle="pill"
					className="wiki-write-guide wiki-write-guide--button"
					icon={<BookIcon size="small" />}
					iconPosition="left"
					iconStyle="none"
					margin={false}
					onClick={openDrawer}
					size="small"
				>
					{label}
				</Button>
				{drawer}
			</>
		)
	}

	return (
		<>
			<DocumentDrawerToggler
				aria-label={label}
				className="wiki-write-guide wiki-write-guide--inline"
			>
				<span aria-hidden="true">+</span>
				{label}
			</DocumentDrawerToggler>
			{drawer}
		</>
	)
}
