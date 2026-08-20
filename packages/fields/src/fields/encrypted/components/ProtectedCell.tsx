import type { DefaultServerCellComponentProps } from 'payload'
import { keys } from '../../../translations/keys'
import { asTranslate } from '../../../translations/server'
import { formatHint } from '../hint'
import { clampMaskDots } from '../maskDots'

/**
 * List cell for masked and write-only encrypted fields. Never renders cellData:
 * list data has been decrypted by afterRead (masked) or stripped (write-only),
 * and the list surface must not leak it. Server cell, so it translates the
 * accessible label per the admin's locale. The dot count mirrors the field's
 * `maskDots` (forwarded via clientProps) for list consistency, defaulting to
 * the same 8 as the field. `setName` (write-only fields) points at the virtual
 * set-indicator sibling in rowData; an unset secret renders an em dash instead
 * of dots that would imply a stored value. `hintName` points at the stored
 * identification hint, which replaces the dots when present.
 */
export const ProtectedCell = ({
	hintName,
	i18n,
	maskDots,
	rowData,
	setName,
}: DefaultServerCellComponentProps & {
	hintName?: string
	maskDots?: number
	setName?: string
}) => {
	const row = rowData as Record<string, unknown> | undefined
	if (setName && row?.[setName] !== true) {
		return (
			<span
				aria-label={asTranslate(i18n.t)(keys.secretNotSet)}
				className="tenx-protected-cell"
				role="img"
			>
				&mdash;
			</span>
		)
	}
	const hint = hintName ? row?.[hintName] : undefined
	return renderLocked({
		i18n,
		text:
			typeof hint === 'string' && hint.length > 0
				? formatHint(hint, clampMaskDots(maskDots))
				: undefined,
		maskDots,
	})
}

const renderLocked = ({
	i18n,
	maskDots,
	text,
}: Pick<DefaultServerCellComponentProps, 'i18n'> & { maskDots?: number; text?: string }) => (
	<span
		className="tenx-protected-cell"
		style={{ alignItems: 'center', display: 'inline-flex', gap: '0.4em' }}
	>
		<svg
			aria-hidden="true"
			fill="none"
			height="12"
			stroke="currentColor"
			strokeWidth="2"
			viewBox="0 0 24 24"
			width="12"
		>
			<rect height="10" rx="2" width="14" x="5" y="11" />
			<path d="M8 11V7a4 4 0 0 1 8 0v4" />
		</svg>
		<span aria-label={asTranslate(i18n.t)(keys.encryptedValue)} role="img">
			{text ?? '•'.repeat(clampMaskDots(maskDots))}
		</span>
	</span>
)
