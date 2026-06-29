import type { TextFieldServerComponent } from 'payload'
import { ClickToDialFieldClient } from './ClickToDialFieldClient'

const USERS_SLUG = 'sipgate-users'
const DEVICES_SLUG = 'sipgate-devices'
const CHANNELS_SLUG = 'sipgate-channels'

type SipgateDevice = {
	id: string
	alias: string
	type: string
	online: boolean
	dnd: boolean
}

type SipgateChannel = {
	id: string
	name: string
}

const ClickToDialField: TextFieldServerComponent = async ({ field, path, readOnly, req }) => {
	const label = typeof field.label === 'string' ? field.label : undefined
	const placeholder =
		typeof field.admin?.placeholder === 'string' ? field.admin.placeholder : undefined

	let sipgateUserId: string | undefined
	let defaultChannelId: string | undefined

	if (req.user) {
		try {
			const result = await req.payload.find({
				// biome-ignore lint/suspicious/noExplicitAny: fixed slug maps to dynamic collection
				collection: USERS_SLUG as any,
				where: { 'payloadUser.value': { equals: req.user.id } },
				limit: 1,
				overrideAccess: true,
			})
			const sipgateUser = result.docs[0]
			if (sipgateUser) {
				sipgateUserId = sipgateUser.id as string
				defaultChannelId = sipgateUser.defaultChannel as string | undefined
			}
		} catch {}
	}

	let initialDevices: SipgateDevice[] = []
	try {
		const result = await req.payload.find({
			// biome-ignore lint/suspicious/noExplicitAny: fixed slug maps to dynamic collection
			collection: DEVICES_SLUG as any,
			where: sipgateUserId ? { sipgateUserId: { equals: sipgateUserId } } : undefined,
			limit: 100,
			depth: 0,
			overrideAccess: true,
		})
		initialDevices = result.docs as SipgateDevice[]
	} catch {}

	let initialChannels: SipgateChannel[] = []
	if (sipgateUserId) {
		try {
			const result = await req.payload.find({
				// biome-ignore lint/suspicious/noExplicitAny: fixed slug maps to dynamic collection
				collection: CHANNELS_SLUG as any,
				where: { 'assignedUsers.sipgateUserId': { equals: sipgateUserId } },
				limit: 100,
				depth: 0,
				overrideAccess: true,
			})
			initialChannels = result.docs.map((doc) => ({
				id: doc.id as string,
				name: (doc.name as string | undefined) ?? (doc.id as string),
			}))
		} catch {}
	}

	return (
		<ClickToDialFieldClient
			path={path ?? field.name}
			label={label}
			placeholder={placeholder}
			required={field.required}
			readOnly={readOnly}
			width={field.admin?.width}
			initialDevices={initialDevices}
			initialChannels={initialChannels}
			defaultChannelId={defaultChannelId}
		/>
	)
}

export default ClickToDialField
