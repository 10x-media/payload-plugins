'use client'

import {
	ChevronIcon,
	ConfirmationModal,
	Popup,
	PopupList,
	useFormModified,
	useModal,
} from '@payloadcms/ui'
import type React from 'react'
import { useCallback, useState } from 'react'

import { BASE_CLASS } from '../../plugin/constants'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { useFormVariants } from '../context'

/**
 * One button naming the current form, opening a list of the others. It is a choice of mode,
 * not an action, so it is a single control rather than a row of buttons next to Save.
 * Switching between two step variants keeps every value, since they share one form; switching
 * to or from `native` leaves the form, so with unsaved changes it asks first.
 */
export const VariantSwitcher: React.FC = () => {
	const { t } = useTranslation()
	const { active, available, collectionSlug, switchTo } = useFormVariants()
	const modified = useFormModified()
	const { closeModal, openModal } = useModal()
	const [pending, setPending] = useState<null | string>(null)
	const modalSlug = `${BASE_CLASS}-switch-${collectionSlug}`

	const request = useCallback(
		(key: string) => {
			if (!active || key === active.key) {
				return
			}
			const target = available.find((variant) => variant.key === key)
			const crossesForms = Boolean(target) && target?.native !== active.native
			if (crossesForms && modified) {
				setPending(key)
				openModal(modalSlug)
				return
			}
			switchTo(key)
		},
		[active, available, modalSlug, modified, openModal, switchTo]
	)

	if (available.length < 2 || !active) {
		return null
	}

	return (
		<div className={`${BASE_CLASS}__switcher`}>
			<Popup
				button={
					<>
						<span className={`${BASE_CLASS}__switcher-label`}>{t(keys.switcherLabel)}:</span>
						<span className={`${BASE_CLASS}__switcher-current`}>{active.label}</span>
						<ChevronIcon className={`${BASE_CLASS}__switcher-chevron`} />
					</>
				}
				buttonClassName={`${BASE_CLASS}__switcher-trigger`}
				horizontalAlign="right"
				render={({ close }) => (
					<PopupList.ButtonGroup>
						{available.map((variant) => (
							<PopupList.Button
								active={variant.key === active.key}
								className={`${BASE_CLASS}__switcher-option`}
								key={variant.key}
								onClick={() => {
									close()
									request(variant.key)
								}}
							>
								{variant.label}
							</PopupList.Button>
						))}
					</PopupList.ButtonGroup>
				)}
				size="large"
				verticalAlign="bottom"
			/>
			<ConfirmationModal
				body={t(keys.unsavedSwitchBody)}
				confirmLabel={t(keys.switchConfirm)}
				heading={t(keys.unsavedSwitchHeading)}
				modalSlug={modalSlug}
				onCancel={() => setPending(null)}
				onConfirm={() => {
					if (pending) {
						switchTo(pending)
					}
					setPending(null)
					closeModal(modalSlug)
				}}
			/>
		</div>
	)
}
