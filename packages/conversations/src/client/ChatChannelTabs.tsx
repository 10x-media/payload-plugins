'use client'

import { type ChannelView, resolveLabel } from '../react/hooks'
import { useTranslation } from '../translations/useTranslation'

export type ChatChannelTabsProps = {
	active: string
	channels: ChannelView[]
	onChange: (channel: string) => void
	/** False with `reads: false`: no counts. */
	reads?: boolean
}

/** One tab per readable channel, with its unread count. Renders nothing for a single channel. */
export const ChatChannelTabs = ({
	active,
	channels,
	onChange,
	reads = true,
}: ChatChannelTabsProps) => {
	const { i18n } = useTranslation()
	if (channels.length < 2) return null
	return (
		<div className="conversations-tabs" role="tablist">
			{channels.map((channel) => (
				<button
					aria-selected={channel.slug === active}
					className={`conversations-tabs__tab${channel.slug === active ? ' conversations-tabs__tab--active' : ''}`}
					key={channel.slug}
					onClick={() => onChange(channel.slug)}
					role="tab"
					type="button"
				>
					<span>{resolveLabel(channel.label, i18n.language)}</span>
					{reads && channel.unread > 0 ? (
						<span className="conversations-tabs__count">
							{channel.unread > 99 ? '99+' : channel.unread}
						</span>
					) : null}
				</button>
			))}
		</div>
	)
}
