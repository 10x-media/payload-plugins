'use client'

import { useLexicalEditable } from '@payloadcms/richtext-lexical/lexical/react/useLexicalEditable'
import { useLexicalNodeSelection } from '@payloadcms/richtext-lexical/lexical/react/useLexicalNodeSelection'

import { useTranslation } from '../../translations/useTranslation'
import { TEXT_FORMAT_BITS, type TokenData, tokenKindLabel } from './types'
import { useTokenPreview } from './useTokenPreview'

const baseClass = 'content-lock-token'

/**
 * The editor face of a token: inline text reading what the banner will show,
 * from the live form, so changing the start or the scope updates it in place.
 * It wears the token's own bold and italic. A token the window cannot fill is
 * marked as an error. Clicking selects it, which opens the floating editor,
 * unless the document is read-only.
 */
export const TokenChip = ({ data, nodeKey }: { data: TokenData; nodeKey: string }) => {
	const { t } = useTranslation()
	const { text, problem } = useTokenPreview(data)
	const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey)
	const editable = useLexicalEditable()

	const classes = [
		baseClass,
		editable && `${baseClass}--editable`,
		editable && isSelected && `${baseClass}--selected`,
		problem && `${baseClass}--problem`,
		data.textFormat & TEXT_FORMAT_BITS.bold && `${baseClass}--bold`,
		data.textFormat & TEXT_FORMAT_BITS.italic && `${baseClass}--italic`,
		data.textFormat & TEXT_FORMAT_BITS.underline && `${baseClass}--underline`,
		data.textFormat & TEXT_FORMAT_BITS.strikethrough && `${baseClass}--strikethrough`,
	]
		.filter(Boolean)
		.join(' ')

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Lexical owns keyboard selection of the node; the click only mirrors it for the pointer.
		// biome-ignore lint/a11y/useKeyWithClickEvents: as above.
		<span
			className={classes}
			onClick={(event) => {
				// A read-only document (an ended window, no update access) keeps the
				// token inert: nothing to select, no editor to open.
				if (!editable) {
					return
				}
				event.preventDefault()
				clearSelection()
				setSelected(true)
			}}
			title={problem ? t(problem) : t(tokenKindLabel[data.token])}
		>
			{text}
		</span>
	)
}
