import type { DefaultServerCellComponentProps } from 'payload'
import { keys } from '../../../translations/keys'
import { asTranslate } from '../../../translations/server'
import { clampMaskDots } from '../maskDots'

/**
 * List cell for masked and write-only encrypted fields. Never renders cellData:
 * list data has been decrypted by afterRead (masked) or stripped (write-only),
 * and the list surface must not leak it. Server cell, so it translates the
 * accessible label per the admin's locale. The dot count mirrors the field's
 * `maskDots` (forwarded via clientProps) for list consistency, defaulting to
 * the same 8 as the field. `setName` (write-only fields) points at the virtual
 * set-indicator sibling in rowData; an unset secret renders an em dash instead
 * of dots that would imply a stored value.
 */
export const ProtectedCell = ({
	i18n,
	maskDots,
	rowData,
	setName,
}: DefaultServerCellComponentProps & { maskDots?: number; setName?: string }) => {
	if (setName && (rowData as Record<string, unknown> | undefined)?.[setName] !== true) {
		return <span className="tenx-protected-cell">&mdash;</span>
	}
	return renderLockedDots({ i18n, maskDots })
}

const renderLockedDots = ({
	i18n,
	maskDots,
}: Pick<DefaultServerCellComponentProps, 'i18n'> & { maskDots?: number }) => (
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
			{'•'.repeat(clampMaskDots(maskDots))}
		</span>
	</span>
)
