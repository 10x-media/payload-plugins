import type { ReactNode } from 'react'
import { keys } from '../translations/keys'
import { asTranslate, type Translate } from '../translations/server'
import { ReadState } from '../ui/components/ReadState'
import { WithScopeToken } from '../ui/data/WithScopeToken'
import { retryOfferFor } from '../ui/readState'
import type { WidgetReadStatus } from './prepareWidgetRead'
import { WIDGET_STATE_KEYS } from './stateKeys'
import type { AnalyticsWidgetProps } from './viewLink'
import { WidgetCard, type WidgetCardProps, WidgetEmpty } from './WidgetCard'
import { type WidgetShimmerProps, WidgetSuspense } from './WidgetShimmer'

/**
 * A built-in widget's frame: its loading card paints at once, and its body streams in with the
 * request's scope token mounted for the client parts.
 */
export function WidgetFrame({
	widget,
	children,
	...shimmer
}: Omit<WidgetShimmerProps, 'link'> & { widget: AnalyticsWidgetProps; children: ReactNode }) {
	const t = asTranslate(widget.req.i18n.t)
	return (
		<WidgetSuspense {...shimmer} {...(widget.view ? { link: t(keys.widgetOpenInView) } : {})}>
			<WithScopeToken req={widget.req}>{children}</WithScopeToken>
		</WidgetSuspense>
	)
}

/** A card that says why it has no numbers, offering a retry where waiting can help. */
export function WidgetStateCard({
	status,
	retryAfterMs,
	t,
	locale,
	...card
}: Omit<WidgetCardProps, 'caption' | 'children'> & {
	status: Exclude<WidgetReadStatus, 'ok'>
	retryAfterMs?: number | undefined
	t: Translate
	locale: string
}) {
	return (
		<WidgetCard {...card}>
			<WidgetEmpty>
				<ReadState
					message={t(WIDGET_STATE_KEYS[status])}
					retry={retryOfferFor(status, retryAfterMs, { t, locale })}
				/>
			</WidgetEmpty>
		</WidgetCard>
	)
}
