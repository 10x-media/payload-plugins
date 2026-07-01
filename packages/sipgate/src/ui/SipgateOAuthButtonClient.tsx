'use client'

import { Button } from '@payloadcms/ui'

type Props = {
	connected: boolean
}

export const SipgateOAuthButtonClient = ({ connected }: Props) => {
	return (
		<Button
			el="anchor"
			url="/api/sipgate/oauth/connect"
			buttonStyle={connected ? 'secondary' : 'primary'}
			margin={false}
		>
			{connected ? 'Reconnect Sipgate' : 'Connect Sipgate'}
		</Button>
	)
}
