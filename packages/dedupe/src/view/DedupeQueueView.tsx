import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps, Params, PayloadComponent } from 'payload'

import type { DedupeQueueSlotProps, DedupeQueueSlotServerProps } from '../options'
import { getContext, listCollections } from '../plugin/context'
import { authRedirectUrl } from './authRedirect'
import { DedupeQueue, queueParams } from './DedupeQueue'

/** The queue's page: `DedupeQueue` in Payload's template, between the `view.queue` slots. */
export async function DedupeQueueView({
	initPageResult,
	params,
	searchParams,
}: AdminViewServerProps) {
	const { req } = initPageResult
	const { user } = req
	const sp: Params = searchParams ?? {}

	const ctx = getContext(req.payload)
	if (!user || !(await ctx.options.access.review({ req }))) {
		redirect(authRedirectUrl({ config: req.payload.config, params, searchParams: sp, user }))
	}

	const { collection, status } = queueParams(sp, listCollections(ctx, req.i18n))
	const slotProps: DedupeQueueSlotProps = { collection, status }
	const slotServerProps: DedupeQueueSlotServerProps = {
		payload: req.payload,
		req,
		searchParams: sp,
	}
	const renderSlot = (components: PayloadComponent[] | undefined) =>
		components?.length
			? RenderServerComponent({
					clientProps: slotProps,
					Component: components,
					importMap: req.payload.importMap,
					serverProps: slotServerProps,
				})
			: null
	const queue = ctx.options.view === false ? false : ctx.options.view.queue
	const slots = queue === false ? undefined : queue.components

	return (
		<DefaultTemplate
			i18n={req.i18n}
			locale={initPageResult.locale}
			params={params}
			payload={req.payload}
			permissions={initPageResult.permissions}
			searchParams={searchParams}
			user={user}
			visibleEntities={initPageResult.visibleEntities}
			req={req}
		>
			<Gutter>
				{renderSlot(slots?.beforeList)}
				<DedupeQueue req={req} searchParams={sp} />
				{renderSlot(slots?.afterList)}
			</Gutter>
		</DefaultTemplate>
	)
}
