'use client'
import { FieldLabel, useField } from '@payloadcms/ui'
import type { StaticLabel } from 'payload'
import type React from 'react'
import { useCallback, useState } from 'react'
import { keys } from '../../../translations/keys'
import { useTranslation } from '../../../translations/useTranslation'
import { EyeToggle } from './EyeToggle'
import { MaskDots } from './MaskDots'
import './ProtectedField.css'

const MASK_DOTS = 8

/**
 * Empty rich text has nothing to conceal, so it renders the editor directly (no
 * mask, no eye), matching how empty scalar fields render native. Null, an empty
 * root, and the default single-empty-paragraph state all count as empty.
 */
const isEmptyRichText = (value: unknown): boolean => {
	if (value == null) {
		return true
	}
	const children = (value as { root?: { children?: unknown[] } }).root?.children
	if (!Array.isArray(children) || children.length === 0) {
		return true
	}
	return children.every((node) => {
		const n = node as { children?: unknown[]; text?: string }
		if (typeof n.text === 'string') {
			return n.text.trim() === ''
		}
		return !n.children || n.children.length === 0
	})
}

/**
 * Reveal gate for the encrypted richText editor. The server-passed editor subtree
 * mounts on first reveal and then stays mounted; concealing only sets
 * display:none on its slot, so re-revealing never re-initialises Lexical (that
 * remount was the toggle flicker). Until the first reveal the editor is absent,
 * so the decrypted value only enters the DOM once the admin reveals it. The
 * concealed face is a static, form-unbound mask (the decrypted value is already
 * in form state from the field's afterRead hook, so a concealed submit reseals
 * the untouched plaintext). The eye is pinned to the label line in both states so
 * toggling never moves focus or shifts layout.
 */
export const RichTextRevealGate: React.FC<{
	children: React.ReactNode
	label?: StaticLabel
	localized?: boolean
	path: string
	required?: boolean
}> = ({ children, label, localized, path, required }) => {
	const { t } = useTranslation()
	const { value } = useField<unknown>({ path })
	const [startedEmpty] = useState(() => isEmptyRichText(value))
	const [revealed, setRevealed] = useState(false)
	const [mounted, setMounted] = useState(false)
	const toggle = useCallback(() => {
		setRevealed((prev) => !prev)
		setMounted(true)
	}, [])

	if (startedEmpty) {
		return <>{children}</>
	}

	return (
		<div className="tenx-protected-field tenx-protected-field--label-row">
			{mounted ? (
				<div className={revealed ? undefined : 'tenx-protected-field__reveal-slot--hidden'}>
					{children}
				</div>
			) : null}
			{revealed ? null : (
				<div className="field-type tenx-protected-field__face">
					<FieldLabel label={label} localized={localized} path={path} required={required} />
					<div className="field-type__wrap">
						<div
							aria-label={t(keys.encryptedValue)}
							className="tenx-protected-field__editor-box"
							role="img"
						>
							<MaskDots count={MASK_DOTS} />
						</div>
					</div>
				</div>
			)}
			<div className="tenx-protected-field__eye-wrap tenx-protected-field__eye-wrap--label-row">
				<EyeToggle
					className="tenx-protected-field__eye--floating"
					onToggle={toggle}
					revealed={revealed}
				/>
			</div>
		</div>
	)
}
