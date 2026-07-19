import type { DefaultServerCellComponentProps } from 'payload'
import { keys } from '../../../translations/keys'
import { asTranslate } from '../../../translations/server'

/**
 * List cell for masked encrypted fields. Never renders cellData: list data has
 * been decrypted by afterRead, and the list surface must not leak it. Server
 * cell, so it translates the accessible label per the admin's locale.
 */
export const ProtectedCell = ({ i18n }: DefaultServerCellComponentProps) => (
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
			&bull;&bull;&bull;&bull;&bull;&bull;
		</span>
	</span>
)
