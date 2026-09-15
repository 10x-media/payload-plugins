'use client'

import { ChevronIcon, Popup, PopupList } from '@payloadcms/ui'
import type React from 'react'

import { BASE_CLASS } from '../../plugin/constants'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { useFormVariants } from '../context'

/**
 * One button naming the current form, opening a list of the others. It is a choice of mode,
 * not an action, so it is a single control rather than a row of buttons next to Save.
 * Switching keeps every value: two step variants share one form, and crossing to or from
 * `native` hands the form state over.
 */
export const VariantSwitcher: React.FC = () => {
	const { t } = useTranslation()
	const { active, available, switchTo } = useFormVariants()

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
									if (variant.key !== active.key) {
										switchTo(variant.key)
									}
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
		</div>
	)
}
