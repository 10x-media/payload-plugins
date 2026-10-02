'use client'

import {
	Button,
	Drawer,
	MoreIcon,
	Pill,
	Popup,
	PopupList,
	useDocumentDrawer,
	useDrawerSlug,
	useModal,
	useTranslation as usePayloadTranslation,
} from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'

import type { DocRef } from '../merge/planResponse'
import type { LinkedFrom } from '../merge/repoint'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { Radio } from './native'
import { fieldKey, RelatedTable } from './RelatedDocuments'
import { SHORT_DATE } from './Value'

const baseClass = 'dedupe-merge'

/** To the minute, so both dates fit a column head's line; the title keeps the seconds. */
const HEAD_DATE = 'dd.MM.yy HH:mm'

/**
 * One document's column head: its name opening it in a drawer to inspect or correct it in place
 * (the drawer's ID links to the document), how many documents link to it with a drawer listing
 * them, a menu to keep all its values or take it out of this merge, its dates, and the radio
 * that makes it the survivor.
 */
export const ColumnHeader = ({
	collection,
	doc,
	linked,
	onMakeSurvivor,
	onRemove,
	onSaved,
	onTakeAll,
	survivor,
}: {
	collection: string
	doc: DocRef
	linked: LinkedFrom[]
	onMakeSurvivor: () => void
	onRemove?: () => void
	onSaved: () => void
	onTakeAll: () => void
	survivor: boolean
}) => {
	const { t } = useTranslation()
	const { i18n, t: payloadT } = usePayloadTranslation()
	const [DocumentDrawer, DocumentDrawerToggler] = useDocumentDrawer({
		id: doc.id,
		collectionSlug: collection,
	})
	const linkedSlug = useDrawerSlug('dedupe-linked')
	const { openModal } = useModal()
	const linkedCount = linked.reduce((sum, entry) => sum + entry.total, 0)
	const date = (value: string | null) =>
		value ? (
			<time dateTime={value} title={formatDate({ date: value, i18n, pattern: SHORT_DATE })}>
				{formatDate({ date: value, i18n, pattern: HEAD_DATE })}
			</time>
		) : (
			'-'
		)

	return (
		<div className={`${baseClass}__head${survivor ? ` ${baseClass}__head--survivor` : ''}`}>
			<div className={`${baseClass}__head-title`}>
				<DocumentDrawerToggler className={`${baseClass}__head-name`} title={doc.title}>
					{doc.title}
				</DocumentDrawerToggler>
				{doc.status ? (
					<Pill size="small">
						{payloadT(doc.status === 'draft' ? 'version:draft' : 'version:published')}
					</Pill>
				) : null}
				<Button
					aria-label={`${t(keys.linkedFrom)}: ${linkedCount}`}
					buttonStyle="icon-label"
					className={`${baseClass}__linked`}
					disabled={linkedCount === 0}
					icon="link"
					iconPosition="left"
					iconStyle="none"
					margin={false}
					onClick={() => openModal(linkedSlug)}
				>
					{linkedCount}
				</Button>
				<Popup
					button={
						<span aria-label={payloadT('general:moreOptions')} role="img">
							<MoreIcon />
						</span>
					}
					buttonClassName={`${baseClass}__menu`}
					horizontalAlign="right"
					render={({ close }) => (
						<PopupList.ButtonGroup>
							<PopupList.Button
								onClick={() => {
									onTakeAll()
									close()
								}}
							>
								{t(keys.takeAll)}
							</PopupList.Button>
							{onRemove ? (
								<PopupList.Button
									onClick={() => {
										onRemove()
										close()
									}}
								>
									{t(keys.removeFromMerge)}
								</PopupList.Button>
							) : null}
						</PopupList.ButtonGroup>
					)}
					verticalAlign="bottom"
				/>
			</div>
			<dl className={`${baseClass}__head-meta`}>
				<div>
					<dt>{t(keys.updated)}</dt>
					<dd>{date(doc.updatedAt)}</dd>
				</div>
				<div>
					<dt>{t(keys.created)}</dt>
					<dd>{date(doc.createdAt)}</dd>
				</div>
			</dl>
			<Radio
				checked={survivor}
				className={`${baseClass}__head-survivor`}
				id={`dedupe-survivor-${doc.id}`}
				label={t(survivor ? keys.primary : keys.makePrimary)}
				name="dedupe-survivor"
				onChange={onMakeSurvivor}
			>
				<span>{t(survivor ? keys.primary : keys.makePrimary)}</span>
			</Radio>
			<DocumentDrawer onSave={onSaved} />
			{/* Mounted even when empty: one unmounted open leaves the admin's modal layer over the page. */}
			<Drawer slug={linkedSlug} title={t(keys.linkedFromTitle, { title: doc.title })}>
				{linked.map((entry) => (
					<RelatedTable
						collection={entry.collection}
						global={entry.global}
						heading={`${entry.collectionLabel} · ${entry.label}`}
						key={fieldKey(entry)}
						more={entry.total - entry.docs.length}
						onChanged={onSaved}
						rows={entry.docs.map((ref) => ({ doc: ref }))}
					/>
				))}
			</Drawer>
		</div>
	)
}
