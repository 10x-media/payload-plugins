'use client'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { BookIcon } from '../icons'
import './surfaces.css'

export type WikiAllGuidesButtonProps = {
	/** How many guides the drawer will hold. */
	count: number
	onClick: () => void
}

/**
 * The way into the full guide drawer, shared by the list band and the document
 * panel so the two surfaces offer the same affordance in the same words. It is
 * only ever the overflow: both surfaces show what they can inline first and fall
 * back to this for the rest.
 */
export const WikiAllGuidesButton = ({ count, onClick }: WikiAllGuidesButtonProps) => {
	const { t } = useTranslation()
	return (
		<button className="wiki-all-guides" onClick={onClick} type="button">
			<BookIcon size="small" />
			{count === 1 ? t(keys.guideCountOne) : t(keys.guideCount, { count })}
		</button>
	)
}
