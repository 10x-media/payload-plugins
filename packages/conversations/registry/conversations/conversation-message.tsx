'use client'

import {
	type AuthorsMap,
	absoluteTime,
	MessageBody,
	relativeTime,
	useMessage,
	type WindowMessage,
} from '@10x-media/conversations/react'
import { MoreHorizontalIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { ConversationComposer } from './conversation-composer'
import { useConversationUI } from './conversation-ui'

export type ConversationMessageProps = {
	authors: AuthorsMap
	/** A follow-up from the same author: no avatar, no name. */
	compact?: boolean
	message: WindowMessage
	/** Opens the message's thread; absent inside a thread. */
	onOpenThread?: (message: WindowMessage) => void
	/** The channel takes no writes: no Edit or Delete. */
	readOnly?: boolean
	/** When the viewer last read this message's thread. */
	threadReadAt?: string
	viewer: null | string
}

const initials = (name: string) =>
	name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join('') || '?'

/**
 * One message: avatar, name, time, body, edited mark, thread summary, and a
 * menu with reply, edit, delete and whatever extensions add. A deleted
 * message stays as a placeholder while it anchors a thread.
 */
export function ConversationMessage({
	authors,
	compact = false,
	message,
	onOpenThread,
	readOnly,
	threadReadAt,
	viewer,
}: ConversationMessageProps) {
	const { converters, labels, locale, renderType, slots } = useConversationUI()
	const state = useMessage({ message, readOnly, threadReadAt, viewer })
	const [menuOpen, setMenuOpen] = useState(false)
	const close = () => setMenuOpen(false)
	const author = authors[message.authorKey]
	const name = state.own ? labels.you : (author?.name ?? '')
	const hasMenu =
		!state.deleted &&
		!state.editing &&
		!message.sendStatus &&
		(Boolean(onOpenThread) ||
			state.canEdit ||
			state.canDelete ||
			Boolean(slots.messageActions?.length) ||
			Boolean(slots.messageQuickActions?.length))

	return (
		<div
			className={cn(
				'group relative flex gap-3 px-4 hover:bg-muted/40',
				compact ? 'py-0.5' : 'pt-2 pb-0.5',
				message.sendStatus === 'sending' && 'opacity-60'
			)}
			data-message-id={String(message.id)}
		>
			<div className="w-8 shrink-0">
				{compact ? null : author?.avatar ? (
					<img alt="" className="size-8 rounded-full object-cover" src={author.avatar} />
				) : (
					<div className="flex size-8 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-xs">
						{initials(author?.name ?? '')}
					</div>
				)}
			</div>
			<div className="min-w-0 flex-1">
				{compact ? null : (
					<div className="flex items-baseline gap-2">
						<span className="font-medium text-sm">{name}</span>
						<time
							className="text-muted-foreground text-xs"
							dateTime={message.createdAt}
							title={absoluteTime(message.createdAt, locale)}
						>
							{relativeTime(message.createdAt, locale)}
						</time>
						{message.editedAt && !state.deleted ? (
							<span className="text-muted-foreground text-xs">· {labels.edited}</span>
						) : null}
					</div>
				)}
				{state.deleted ? (
					<div className="text-muted-foreground text-sm italic">{labels.messageDeleted}</div>
				) : state.editing ? (
					<ConversationComposer
						channel={message.channel}
						className="my-1"
						conversationKey={message.key}
						initialBody={message.body}
						onCancel={() => state.setEditing(false)}
						onSave={state.save}
						parent={message.parent ?? null}
					/>
				) : message.type === 'text' ? (
					<MessageBody
						authors={authors}
						converters={converters}
						className="text-sm leading-relaxed [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_.conversations-mention]:rounded [&_.conversations-mention]:bg-primary/10 [&_.conversations-mention]:px-1 [&_.conversations-mention]:font-medium"
						message={message}
					/>
				) : (
					(renderType?.(message) ?? (
						<div className="text-muted-foreground text-sm italic">{labels.unknownType}</div>
					))
				)}
				{message.sendStatus === 'sending' ? (
					<div className="text-muted-foreground text-xs">{labels.sending}</div>
				) : null}
				{slots.messageFooter?.map((Slot, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: slots are a fixed list from props.
					<Slot key={index} message={message} />
				))}
				{state.replies > 0 && onOpenThread ? (
					<button
						className="mt-1 flex items-center gap-2 rounded-md px-1 py-0.5 text-primary text-xs hover:bg-muted"
						onClick={() => onOpenThread(message)}
						type="button"
					>
						<span className="font-medium">{labels.replies(state.replies)}</span>
						{state.hasNewReplies ? (
							<span className="rounded bg-primary px-1 text-[10px] text-primary-foreground uppercase">
								{labels.newReplies}
							</span>
						) : null}
						{message.lastReplyAt ? (
							<span className="text-muted-foreground">
								{relativeTime(message.lastReplyAt, locale)}
							</span>
						) : null}
					</button>
				) : null}
			</div>
			{hasMenu ? (
				<div
					className={cn(
						'absolute top-1 right-3 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
						menuOpen && 'opacity-100'
					)}
				>
					<DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
						<DropdownMenuTrigger
							render={
								<Button aria-label={labels.messageMenu} size="icon-sm" variant="outline">
									<MoreHorizontalIcon />
								</Button>
							}
						/>
						<DropdownMenuContent align="end" className="min-w-44">
							{slots.messageQuickActions?.map((Slot, index) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: slots are a fixed list from props.
								<Slot close={close} key={index} message={message} />
							))}
							{onOpenThread ? (
								<DropdownMenuItem onClick={() => onOpenThread(message)}>
									{labels.replyInThread}
								</DropdownMenuItem>
							) : null}
							{state.canEdit ? (
								<DropdownMenuItem onClick={() => state.setEditing(true)}>
									{labels.edit}
								</DropdownMenuItem>
							) : null}
							{state.canDelete ? (
								<DropdownMenuItem
									onClick={() => {
										if (window.confirm(labels.deleteConfirm)) void state.remove()
									}}
									variant="destructive"
								>
									{labels.delete}
								</DropdownMenuItem>
							) : null}
							{slots.messageActions?.map((Slot, index) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: slots are a fixed list from props.
								<Slot close={close} key={index} message={message} />
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			) : null}
		</div>
	)
}
