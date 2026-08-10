'use client'

import { Button, useActions } from '@payloadcms/ui'
import { useEffect } from 'react'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'

export type WikiViewActionsProps = {
	editUrl: string
}

/**
 * Puts the guide's edit link in the admin header's actions slot.
 *
 * Custom root views get no server-side `viewActions`: `getRouteData` seeds that
 * list from the global `admin.components.actions` and then only appends for
 * collection and global views, so a component registered in the import map would
 * render on every admin page and have to hide itself by pathname. The actions
 * provider exposes a client setter for exactly this, which keeps the button
 * scoped to the view that owns it.
 *
 * Renders nothing itself; the cleanup matters because the provider lives above
 * this view and survives soft navigation away from it.
 */
export const WikiViewActions = ({ editUrl }: WikiViewActionsProps) => {
	const { setViewActions } = useActions()
	const { t } = useTranslation()
	const label = t(keys.drawerEditGuide)

	useEffect(() => {
		setViewActions({
			'wiki-edit-guide': (
				<Button
					buttonStyle="pill"
					el="link"
					icon="edit"
					iconPosition="left"
					iconStyle="none"
					margin={false}
					size="small"
					to={editUrl}
				>
					{label}
				</Button>
			),
		})
		return () => setViewActions({})
	}, [editUrl, label, setViewActions])

	return null
}
