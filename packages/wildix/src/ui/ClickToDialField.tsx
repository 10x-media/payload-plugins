import type { TextFieldServerComponent } from 'payload'
import { ClickToDialFieldClient } from './ClickToDialFieldClient'

const USERS_SLUG = 'wildix-users'
const DEVICES_SLUG = 'wildix-devices'

type WildixDevice = {
	contact: string
	userAgent: string
	online: boolean
	isActiveDevice: boolean
}

const ClickToDialField: TextFieldServerComponent = async ({ field, path, readOnly, req }) => {
	const label = typeof field.label === 'string' ? field.label : undefined
	const placeholder =
		typeof field.admin?.placeholder === 'string' ? field.admin.placeholder : undefined

	let wildixId: string | undefined

	if (req.user) {
		try {
			const result = await req.payload.find({
				// biome-ignore lint/suspicious/noExplicitAny: fixed slug maps to dynamic collection
				collection: USERS_SLUG as any,
				where: { 'payloadUser.value': { equals: req.user.id } },
				limit: 1,
				overrideAccess: true,
			})
			wildixId = result.docs[0]?.wildixId as string | undefined
		} catch {}
	}

	let initialDevices: WildixDevice[] = []
	try {
		const result = await req.payload.find({
			// biome-ignore lint/suspicious/noExplicitAny: fixed slug maps to dynamic collection
			collection: DEVICES_SLUG as any,
			where: wildixId ? { wildixUserId: { equals: wildixId } } : undefined,
			limit: 100,
			depth: 0,
			overrideAccess: true,
		})
		initialDevices = result.docs.map((doc) => ({
			contact: doc.contact as string,
			userAgent: (doc.userAgent as string | undefined) ?? (doc.contact as string),
			online: Boolean(doc.online),
			isActiveDevice: Boolean(doc.isActiveDevice),
		}))
	} catch {}

	return (
		<ClickToDialFieldClient
			path={path ?? field.name}
			label={label}
			placeholder={placeholder}
			required={field.required}
			readOnly={readOnly}
			width={field.admin?.width}
			initialDevices={initialDevices}
		/>
	)
}

export default ClickToDialField
