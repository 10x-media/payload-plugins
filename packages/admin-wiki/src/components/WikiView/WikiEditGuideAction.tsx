'use client'

import { Button } from '@payloadcms/ui'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'

export type WikiEditGuideActionProps = {
	editUrl: string
}

/**
 * The guide page's edit link, in the admin header's actions slot.
 *
 * Passed to `DefaultTemplate` as one of the view's `viewActions` (through the
 * import map, with `editUrl` as its client props), so the header renders it on
 * the server with the rest of the page. Setting it from the client instead
 * loses a race in Payload 4: `ActionsProvider` resets its actions in an effect
 * on mount, and a parent's effects run after its children's.
 */
export const WikiEditGuideAction = ({ editUrl }: WikiEditGuideActionProps) => {
	const { t } = useTranslation()
	return (
		<Button
			buttonStyle="pill"
			el="link"
			icon="edit"
			iconPosition="left"
			margin={false}
			size="medium"
			to={editUrl}
		>
			{t(keys.drawerEditGuide)}
		</Button>
	)
}
