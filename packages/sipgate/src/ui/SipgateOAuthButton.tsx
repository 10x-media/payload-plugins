import type { PayloadComponent, PayloadServerReactComponent } from 'payload'
import { SipgateOAuthButtonClient } from './SipgateOAuthButtonClient'

const USERS_SLUG = 'sipgate-users'

const SipgateOAuthButton: PayloadServerReactComponent<PayloadComponent> = async (props) => {
	let connected = false

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
			connected = result.totalDocs > 0
		} catch {}
	}

	return <SipgateOAuthButtonClient connected={connected} />
}

export default SipgateOAuthButton
