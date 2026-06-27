import type { TextFieldServerComponent, Where } from 'payload'
import { ClickToDialFieldClient } from './ClickToDialFieldClient'

type SipgateDevice = {
	id: string
	alias: string
	type: string
	online: boolean
	dnd: boolean
}

type FieldCustom = {
	sipgateDevicesSlug?: string
	sipgateUsersSlug?: string
	filterDevicesByUser?: boolean
}

const ClickToDialField: TextFieldServerComponent = async ({ field, path, readOnly, req }) => {
	const label = typeof field.label === 'string' ? field.label : undefined
	const placeholder =
		typeof field.admin?.placeholder === 'string' ? field.admin.placeholder : undefined

	const custom = (field.admin?.custom ?? {}) as FieldCustom
	const devicesSlug = custom.sipgateDevicesSlug ?? 'sipgate-devices'
	const usersSlug = custom.sipgateUsersSlug ?? 'sipgate-users'
	const filterByUser = custom.filterDevicesByUser ?? true

	// biome-ignore lint/suspicious/noExplicitAny: dynamic slugs from plugin config
	let userWhere: Where | undefined

	if (filterByUser && req.user) {
		try {
			const sipgateUserResult = await req.payload.find({
				// biome-ignore lint/suspicious/noExplicitAny: dynamic slugs from plugin config
				collection: usersSlug as any,
				where: { 'payloadUser.value': { equals: req.user.id } },
				limit: 1,
				overrideAccess: true,
			})
			const sipgateUserId = sipgateUserResult.docs[0]?.id as string | undefined
			if (sipgateUserId) {
				userWhere = { sipgateUserId: { equals: sipgateUserId } }
			}
		} catch {}
	}

	let initialDevices: SipgateDevice[] = []
	try {
		const result = await req.payload.find({
			// biome-ignore lint/suspicious/noExplicitAny: dynamic slugs from plugin config
			collection: devicesSlug as any,
			where: userWhere,
			limit: 100,
			depth: 0,
			overrideAccess: true,
		})
		initialDevices = result.docs as SipgateDevice[]
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
