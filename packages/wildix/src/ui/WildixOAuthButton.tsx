import type { PayloadComponent, PayloadServerReactComponent } from 'payload'
import { WildixOAuthButtonClient } from './WildixOAuthButtonClient'

const USERS_SLUG = 'wildix-users'

const WildixOAuthButton: PayloadServerReactComponent<PayloadComponent> = async (props) => {
	let connected = false
	let needsReconnect = false

	if (props.user) {
		try {
			const result = await props.payload.find({
				collection: USERS_SLUG,
				where: {
					'payloadUser.value': { equals: props.user.id },
					accessToken: { exists: true },
				},
				limit: 1,
				overrideAccess: true,
			})
			const doc = result.docs[0] as { needsReconnect?: boolean } | undefined
			connected = !!doc
			needsReconnect = doc?.needsReconnect ?? false
		} catch {}
	}

	return <WildixOAuthButtonClient connected={connected} needsReconnect={needsReconnect} />
}

export default WildixOAuthButton
