'use client'

import {
	Button,
	MoreIcon,
	Pill,
	Popup,
	PopupList,
	useConfig,
	useDocumentDrawer,
	useTranslation as usePayloadTranslation,
} from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import { formatAdminURL } from 'payload/shared'

import type { DocRef } from '../merge/planResponse'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { Radio } from './native'
import { SHORT_DATE } from './Value'

const baseClass = 'dedupe-merge'

/** To the minute, so both dates fit a column head's line; the title keeps the seconds. */
const HEAD_DATE = 'dd.MM.yy HH:mm'

/**
 * One document's column head, laid out as an upload field shows its document: the name opening it
 * in a new tab and an edit button opening it in a drawer to correct it in place. Then a menu to
 * keep all its values or take it out of this merge, its dates, and the radio that makes it the
 * survivor.
 */
export const ColumnHeader = ({
	collection,
	doc,
	onMakeSurvivor,
	onRemove,
	onSaved,
	onTakeAll,
	survivor,
}: {
	collection: string
	doc: DocRef
	onMakeSurvivor: () => void
	onRemove?: () => void
	onSaved: () => void
	onTakeAll: () => void
	survivor: boolean
}) => {
	const { t } = useTranslation()
	const { i18n, t: payloadT } = usePayloadTranslation()
	const {
		config: {
			routes: { admin: adminRoute },
		},
	} = useConfig()
	const [DocumentDrawer, , { openDrawer }] = useDocumentDrawer({
		id: doc.id,
		collectionSlug: collection,
	})
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
				<a
					className={`${baseClass}__head-name`}
					href={formatAdminURL({ adminRoute, path: `/collections/${collection}/${doc.id}` })}
					rel="noopener noreferrer"
					target="_blank"
					title={doc.title}
				>
					{doc.title}
				</a>
				{doc.status ? (
					<Pill size="small">
						{payloadT(
							doc.status === 'draft'
								? 'version:draft'
								: doc.status === 'changed'
									? 'version:changed'
									: 'version:published'
						)}
					</Pill>
				) : null}
				<Button
					aria-label={payloadT('general:editLabel', { label: doc.title })}
					buttonStyle="icon-label"
					className={`${baseClass}__head-edit`}
					icon="edit"
					iconStyle="none"
					margin={false}
					onClick={openDrawer}
					tooltip={payloadT('general:edit')}
				/>
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
		</div>
	)
}
