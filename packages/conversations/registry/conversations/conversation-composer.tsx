'use client'

import {
	Composer,
	type ComposerClassNames,
	type ComposerFeature,
	type ComposerLabels,
	type ComposerToolbar,
	defaultComposerFeatures,
	englishComposerLabels,
} from '@10x-media/conversations/composer'
import { ComposerAddonsContext, useComposer } from '@10x-media/conversations/react'
import { GlobeIcon, LockIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { useConversationUI } from './conversation-ui'

export type ConversationComposerProps = {
	channel: string
	className?: string
	conversationKey: string
	/** Which channel this goes to and who reads it, above the editor. */
	cue?: { label: string; tone: 'neutral' | 'warning' } | null
	/** A link at the end of the cue, e.g. "Switch to Internal". */
	cueAction?: { label: ReactNode; onClick: () => void } | null
	/** Why the viewer cannot post; replaces the editor. */
	disabledReason?: ReactNode
	/** The editor's features. Default: bold, italic, link, lists, mention. */
	features?: (args: { defaultFeatures: ComposerFeature[] }) => ComposerFeature[]
	/** Editing: the body to start from. */
	initialBody?: unknown
	/** The editor's own strings (toolbar, link field, mentions). */
	editorLabels?: ComposerLabels
	onCancel?: () => void
	/** Editing: called with the new body instead of sending. */
	onSave?: (body: unknown) => Promise<unknown>
	parent?: null | string
	placeholder?: string
	toolbar?: ComposerToolbar
}

/**
 * The composer's parts in shadcn's look: popovers like `PopoverContent`, rows
 * like `DropdownMenuItem`, tool buttons like a ghost `Button`. Change them
 * here; behaviour stays in the package.
 */
const composerClassNames: ComposerClassNames = {
	root: 'flex flex-col rounded-lg data-dragging:bg-muted/60 data-dragging:ring-2 data-dragging:ring-primary/40 [&_.conversations-mention]:rounded [&_.conversations-mention]:bg-primary/10 [&_.conversations-mention]:px-1 [&_.conversations-mention]:font-medium',
	input: 'relative px-3 pt-2.5 pb-1 text-sm',
	content: 'max-h-60 min-h-6 overflow-y-auto outline-none',
	placeholder: 'pointer-events-none absolute top-2.5 left-3 select-none text-muted-foreground',
	footer: 'flex items-center gap-2 px-2 pb-2',
	footerEnd: 'ml-auto flex items-center gap-2',
	toolbar: 'flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden',
	toolbarGroup: 'flex items-center gap-0.5',
	toolbarDivider: 'mx-1 h-4 w-px bg-border',
	tool: 'inline-flex size-7 items-center justify-center gap-0.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 [&_svg]:size-4',
	toolActive: 'bg-muted text-foreground',
	toolDropdown: 'w-auto px-1',
	menu: 'z-50 min-w-48 max-h-72 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground text-sm shadow-md ring-1 ring-foreground/10',
	menuItem:
		'flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent hover:text-accent-foreground disabled:opacity-50',
	menuItemSelected: 'bg-accent text-accent-foreground',
	menuIcon: 'flex size-4 items-center justify-center text-muted-foreground [&_svg]:size-4',
	menuLabel: 'flex-1 truncate',
	menuAvatar:
		'flex size-5 shrink-0 items-center justify-center rounded-full bg-muted object-cover text-[9px] font-medium',
	menuGroup: 'px-2 pt-2 pb-1 font-medium text-muted-foreground text-xs',
	menuEmpty: 'px-2 py-1.5 text-muted-foreground',
	linkEditor:
		'z-50 w-80 rounded-lg bg-popover p-1.5 text-popover-foreground text-sm shadow-md ring-1 ring-foreground/10',
	linkPreview: 'w-auto max-w-80',
	linkRow: 'flex items-center gap-1',
	linkInput:
		'h-8 min-w-0 flex-1 rounded-md border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive',
	linkUrl: 'min-w-0 flex-1 truncate px-1 text-primary underline-offset-2 hover:underline',
	linkButton:
		'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4',
	linkError: 'px-1 pt-1 text-destructive text-xs',
	bold: 'font-semibold',
	italic: 'italic',
	link: 'text-primary underline underline-offset-2',
	paragraph: 'm-0',
	ul: 'my-1 list-disc pl-5',
	ol: 'my-1 list-decimal pl-5',
	listItem: 'my-0.5',
	nestedListItem: 'list-none',
}

/**
 * The message editor: Lexical with formatting, `/` commands, `@` mentions
 * and links, a channel cue above it, Send in the same box. Enter sends,
 * Shift+Enter breaks the line; a failed send keeps the text for Retry.
 */
export function ConversationComposer({
	channel,
	className,
	conversationKey,
	cue,
	cueAction,
	disabledReason,
	editorLabels = englishComposerLabels,
	features,
	initialBody,
	onCancel,
	onSave,
	parent = null,
	placeholder,
	toolbar = 'bottom',
}: ConversationComposerProps) {
	const { composerFeatures, labels, slots } = useConversationUI()
	const composer = useComposer({ channel, initialBody, key: conversationKey, onSave, parent })
	// Features are resolved once: the editor registers its nodes on mount.
	const [resolvedFeatures] = useState(() => {
		const pick = features ?? composerFeatures
		return pick ? pick({ defaultFeatures: defaultComposerFeatures() }) : defaultComposerFeatures()
	})
	const warning = cue?.tone === 'warning'
	const slotsOf = (list: typeof slots.composerAbove) =>
		onSave
			? null
			: list?.map((Slot, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: slots are a fixed list from props.
					<Slot channel={channel} conversationKey={conversationKey} key={index} />
				))

	const box = (
		<div
			className={cn(
				'rounded-lg border bg-background',
				warning && 'border-warning/60',
				composer.failed && 'border-destructive/60',
				className
			)}
		>
			{composer.failed ? (
				<div className="flex items-center gap-2 border-b px-3 py-1.5 text-destructive text-xs">
					<span className="flex-1">{labels.couldNotSend}</span>
					<Button onClick={() => void composer.submit()} size="xs" variant="outline">
						{labels.retry}
					</Button>
				</div>
			) : cue ? (
				<div
					className={cn(
						'flex items-center gap-1.5 border-b px-3 py-1.5 text-muted-foreground text-xs',
						warning && 'text-warning'
					)}
				>
					{warning ? <GlobeIcon className="size-3.5" /> : <LockIcon className="size-3.5" />}
					<span className="flex-1">{cue.label}</span>
					{cueAction ? (
						<button
							className="text-foreground underline-offset-2 hover:underline"
							onClick={cueAction.onClick}
							type="button"
						>
							{cueAction.label}
						</button>
					) : null}
				</div>
			) : null}
			{slotsOf(slots.composerAbove)}
			{disabledReason ? (
				<div className="px-3 py-3 text-muted-foreground text-sm">{disabledReason}</div>
			) : (
				<Composer
					autoFocus={Boolean(onSave)}
					below={slotsOf(slots.composerBelow)}
					classNames={composerClassNames}
					editorRef={composer.editorRef}
					features={resolvedFeatures}
					footer={
						<>
							<span className="hidden text-muted-foreground text-xs sm:inline">
								{composer.failed ? labels.textKept : labels.enterToSend}
							</span>
							{slotsOf(slots.composerActions)}
							{onCancel ? (
								<Button onClick={onCancel} size="sm" variant="outline">
									{labels.cancel}
								</Button>
							) : null}
							<Button disabled={composer.busy} onClick={() => void composer.submit()} size="sm">
								{onSave ? labels.save : labels.send}
							</Button>
						</>
					}
					initialBody={composer.initialBody}
					labels={editorLabels}
					mentions={{ channel, conversationKey }}
					onChange={composer.onChange}
					onFiles={composer.onFiles}
					onSubmit={() => void composer.submit()}
					placeholder={placeholder ?? labels.composerPlaceholder}
					toolbar={toolbar}
					unstyled
				/>
			)}
		</div>
	)
	return composer.addons ? (
		<ComposerAddonsContext.Provider value={composer.addons}>{box}</ComposerAddonsContext.Provider>
	) : (
		box
	)
}
