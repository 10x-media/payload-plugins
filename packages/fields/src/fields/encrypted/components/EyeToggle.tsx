'use client'
import { EyeIcon } from '@payloadcms/ui'
import type React from 'react'
import { keys } from '../../../translations/keys'
import { useTranslation } from '../../../translations/useTranslation'

/**
 * The reveal toggle shared by every concealed field, drawn like the native
 * password toggle: a plain button around Payload's own `EyeIcon` (struck-through
 * while the value is shown, open while it is concealed). Present in both masked
 * and revealed states so toggling never removes the focused control from the tree.
 */
export const EyeToggle: React.FC<{
	className?: string
	onToggle: () => void
	revealed: boolean
}> = ({ className, onToggle, revealed }) => {
	const { t } = useTranslation()
	return (
		<button
			aria-label={revealed ? t(keys.hideValue) : t(keys.showValue)}
			aria-pressed={revealed}
			className={['tenx-protected-field__eye', className].filter(Boolean).join(' ')}
			onClick={onToggle}
			type="button"
		>
			<EyeIcon active={revealed} size={24} />
		</button>
	)
}
