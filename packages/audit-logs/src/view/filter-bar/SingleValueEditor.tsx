'use client'

import { ReactSelect } from '@payloadcms/ui'
import type React from 'react'
import { useCallback, useState } from 'react'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { PayloadDocSelect } from './PayloadDocSelect'
import type { EditorProps, SelectOption } from './types'

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
	const { t } = useTranslation()
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
									// biome-ignore lint/a11y/noAutofocus: the input lives in a filter popup opened by an explicit user action, so focus follows the interaction rather than page load
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
						{ label: t(keys.authEventFailedLogin), value: 'failed_login' },
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
								// biome-ignore lint/a11y/noAutofocus: the input lives in a filter popup opened by an explicit user action, so focus follows the interaction rather than page load
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
								// biome-ignore lint/a11y/noAutofocus: the input lives in a filter popup opened by an explicit user action, so focus follows the interaction rather than page load
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
								// biome-ignore lint/a11y/noAutofocus: the input lives in a filter popup opened by an explicit user action, so focus follows the interaction rather than page load
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
