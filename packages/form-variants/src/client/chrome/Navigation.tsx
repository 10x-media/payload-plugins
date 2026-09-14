'use client'

import { Button, Gutter, useFormProcessing } from '@payloadcms/ui'
import type React from 'react'
import { useState } from 'react'

import { BASE_CLASS } from '../../plugin/constants'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { type PrimaryAction, useWizard } from '../context'
import { useSaveLabel } from './SaveButton'

/**
 * The footer: one line for whatever the user needs to know (a validation or gate refusal, a
 * server error, the step's own message, why saving is blocked, read-only), Back, and one
 * primary button. The primary button is Next, turns into Save on the last step of a
 * `final-step` variant, and yields to a step's `setPrimaryAction`. A variant that saves on any
 * step keeps Save in the top bar, so its last step has no primary button here.
 */
export const Navigation: React.FC = () => {
	const { t } = useTranslation()
	const {
		back,
		busy,
		error,
		isFirst,
		isLast,
		message,
		next,
		primaryAction,
		readOnly,
		save,
		saveAllowed,
		saveBlockedMessage,
		saveBlockedReason,
		variant,
	} = useWizard()
	const saveLabel = useSaveLabel()
	const processing = useFormProcessing()
	const [pending, setPending] = useState(false)

	const status =
		error ??
		message ??
		(saveBlockedReason === 'blocked' ? saveBlockedMessage : null) ??
		(readOnly ? t(keys.readOnly) : null)

	let primary: null | PrimaryAction = primaryAction
	if (!primary && !isLast) {
		primary = { label: t(keys.next), onClick: next }
	} else if (!primary && variant.save === 'final-step' && !readOnly) {
		primary = { disabled: !saveAllowed, label: saveLabel, onClick: save }
	}

	// Nothing to say and nowhere to go: a one-step variant that saves from the top bar would
	// otherwise leave an empty bar stuck to the bottom of the form.
	if (!status && isFirst && !primary) {
		return null
	}

	const working = busy || pending || processing
	const run = async (action: PrimaryAction): Promise<void> => {
		setPending(true)
		try {
			await action.onClick()
		} finally {
			setPending(false)
		}
	}

	return (
		<Gutter className={`${BASE_CLASS}__footer`}>
			<div className={`${BASE_CLASS}__footer-inner`}>
				<div aria-live="polite" className={`${BASE_CLASS}__status`}>
					{status && (
						<p
							className={`${BASE_CLASS}__status-text${error ? ` ${BASE_CLASS}__status-text--error` : ''}`}
							role={error ? 'alert' : undefined}
						>
							{status}
						</p>
					)}
				</div>
				<div className={`${BASE_CLASS}__actions`}>
					{!isFirst && (
						<Button
							buttonStyle="secondary"
							disabled={working}
							margin={false}
							onClick={() => void back()}
							size="medium"
							type="button"
						>
							{t(keys.back)}
						</Button>
					)}
					{primary && (
						<Button
							buttonStyle="primary"
							className={working ? `${BASE_CLASS}__primary--working` : undefined}
							disabled={working || primary.disabled}
							extraButtonProps={{ 'aria-busy': working }}
							margin={false}
							onClick={() => void run(primary)}
							size="medium"
							type="button"
						>
							<span className={`${BASE_CLASS}__primary-label`}>{primary.label}</span>
							{working && <span aria-hidden className={`${BASE_CLASS}__spinner`} />}
						</Button>
					)}
				</div>
			</div>
		</Gutter>
	)
}
