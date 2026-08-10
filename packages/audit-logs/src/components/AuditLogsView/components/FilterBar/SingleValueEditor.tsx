'use client'

import { ReactSelect, useTranslation } from '@payloadcms/ui'
import type React from 'react'
import { useCallback, useState } from 'react'
import type {
	CustomTranslationsKeys,
	CustomTranslationsObject,
} from '../../../../translations/index.js'
import { PayloadDocSelect } from './PayloadDocSelect.js'
import type { EditorProps, SelectOption } from './types.js'

type Props = EditorProps & {
	field: 'changedPath' | 'documentId' | 'eventType' | 'group'
	index?: number
	userTitleFields: Record<string, string>
}

export function SingleValueEditor({
	field,
	index,
	onClose,
	setStaged,
	staged,
	userTitleFields,
}: Props) {
	const { t } = useTranslation<CustomTranslationsObject, CustomTranslationsKeys>()
	const isChangedPath = field === 'changedPath'
	const existingValue = isChangedPath
		? index !== undefined && index >= 0
			? (staged.changedPaths?.[index] ?? '')
			: ''
		: (staged[field as 'documentId' | 'eventType' | 'group'] ?? '')

	const [local, setLocal] = useState(existingValue)

	const commitText = useCallback(() => {
		if (isChangedPath) {
			setStaged((f) => {
				const paths = [...(f.changedPaths ?? [])]
				if (!local.trim()) {
					if (index !== undefined && index >= 0) paths.splice(index, 1)
				} else if (index !== undefined && index >= 0) {
					paths[index] = local.trim()
				} else {
					paths.push(local.trim())
				}
				return { ...f, changedPaths: paths.length ? paths : undefined }
			})
		} else {
			setStaged((f) => {
				if (!local) {
					const next = { ...f }
					delete next[field as 'documentId' | 'eventType' | 'group']
					return next
				}
				return { ...f, [field]: local }
			})
		}
		onClose()
	}, [field, index, isChangedPath, local, onClose, setStaged])

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') commitText()
		if (e.key === 'Escape') onClose()
	}

	const label = isChangedPath
		? t(keys.filterChangedPath)
		: field === 'documentId'
			? t(keys.filterDocument)
			: field === 'group'
				? t(keys.filterGroup)
				: t(keys.filterEventType)
	const stagedCollection = staged.collections?.[0]
	const hasAuthOp = staged.operations?.includes('auth')
	const hasCustomOp = staged.operations?.includes('custom')

	return (
		<div className="al-filterpopover__editor" data-popup-prevent-close>
			<div className="al-filterpopover__editor-label">{label}</div>

			{field === 'documentId' && (
				<>
					{stagedCollection ? (
						<>
							<PayloadDocSelect
								collection={stagedCollection}
								onSelect={(id) => {
									setStaged((f) => ({ ...f, documentId: id }))
									onClose()
								}}
								titleField={userTitleFields[stagedCollection] ?? 'id'}
							/>
							<div className="al-filterpopover__divider">{t(keys.orEnterId)}</div>
						</>
					) : (
						<div className="al-filterpopover__hint">{t(keys.selectCollectionHint)}</div>
					)}
					<div className="al-filterpopover__input-row">
						<div className="field-type text" style={{ flex: '1 1 auto' }}>
							<div className="field-type__wrap">
								<input
									autoFocus={!stagedCollection}
									onChange={(e) => setLocal(e.target.value)}
									onKeyDown={handleKeyDown}
									placeholder={t(keys.documentIdPlaceholder)}
									type="text"
									value={local as string}
								/>
							</div>
						</div>
						<button className="al-filterpopover__confirm" onClick={commitText} type="button">
							{staged.documentId ? t(keys.update) : t(keys.add)}
						</button>
					</div>
				</>
			)}

			{field === 'eventType' &&
				hasAuthOp &&
				(() => {
					const authEventOptions = [
						{ label: t(keys.authEventLogin), value: 'login' },
						{ label: t(keys.authEventForgotPassword), value: 'forgot_password' },
					]
					return (
						<ReactSelect
							onChange={(selected) => {
								const opt = selected as SelectOption | null
								setStaged((f) => {
									const next = { ...f }
									if (!opt) delete next.eventType
									else next.eventType = opt.value
									return next
								})
								onClose()
							}}
							options={authEventOptions}
							placeholder={t(keys.selectEventPlaceholder)}
							value={authEventOptions.find((o) => o.value === staged.eventType) ?? undefined}
						/>
					)
				})()}

			{field === 'eventType' && !hasAuthOp && hasCustomOp && (
				<div className="al-filterpopover__input-row">
					<div className="field-type text" style={{ flex: '1 1 auto' }}>
						<div className="field-type__wrap">
							<input
								autoFocus
								onChange={(e) => setLocal(e.target.value)}
								onKeyDown={handleKeyDown}
								placeholder={t(keys.eventTypePlaceholder)}
								type="text"
								value={local as string}
							/>
						</div>
					</div>
					<button className="al-filterpopover__confirm" onClick={commitText} type="button">
						{existingValue ? t(keys.update) : t(keys.add)}
					</button>
				</div>
			)}

			{isChangedPath && (
				<div className="al-filterpopover__input-row">
					<div className="field-type text" style={{ flex: '1 1 auto' }}>
						<div className="field-type__wrap">
							<input
								autoFocus
								onChange={(e) => setLocal(e.target.value)}
								onKeyDown={handleKeyDown}
								placeholder={t(keys.fieldPathPlaceholder)}
								type="text"
								value={local as string}
							/>
						</div>
					</div>
					<button className="al-filterpopover__confirm" onClick={commitText} type="button">
						{existingValue ? t(keys.update) : t(keys.add)}
					</button>
				</div>
			)}

			{field === 'group' && (
				<div className="al-filterpopover__input-row">
					<div className="field-type text" style={{ flex: '1 1 auto' }}>
						<div className="field-type__wrap">
							<input
								autoFocus
								onChange={(e) => setLocal(e.target.value)}
								onKeyDown={handleKeyDown}
								placeholder={t(keys.groupPlaceholder)}
								type="text"
								value={local as string}
							/>
						</div>
					</div>
					<button className="al-filterpopover__confirm" onClick={commitText} type="button">
						{existingValue ? t(keys.update) : t(keys.add)}
					</button>
				</div>
			)}
		</div>
	)
}
