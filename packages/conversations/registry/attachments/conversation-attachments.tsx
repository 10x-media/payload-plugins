'use client'

import {
	ATTACHMENTS,
	type AttachmentsClientData,
	type AttachmentView,
	formatSize,
	isImage,
	useAttachments,
	useAttachmentsComposer,
} from '@10x-media/conversations/attachments/react'
import { useComposerFiles, useExtension, type WindowMessage } from '@10x-media/conversations/react'
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	DownloadIcon,
	FileIcon,
	PaperclipIcon,
	XIcon,
} from 'lucide-react'
import { useRef, useState } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

type ComposerSlotProps = { channel: string; conversationKey: string }

/** Shown in the viewer rather than a new tab: images and PDFs. */
const viewable = (file: AttachmentView) => isImage(file) || file.mimeType === 'application/pdf'

/** `composerActions` slot: the paperclip next to Send. */
export function AttachButton() {
	const intake = useComposerFiles()
	const settings = useExtension<AttachmentsClientData>(ATTACHMENTS)
	const input = useRef<HTMLInputElement>(null)
	if (!intake?.acceptsFiles || !settings) return null
	return (
		<>
			<Button
				aria-label="Attach files"
				onClick={() => input.current?.click()}
				size="icon-sm"
				variant="ghost"
			>
				<PaperclipIcon />
			</Button>
			<input
				accept={settings.mimeTypes.length > 0 ? settings.mimeTypes.join(',') : undefined}
				hidden
				multiple
				onChange={(event) => {
					intake.addFiles([...(event.target.files ?? [])])
					event.target.value = ''
				}}
				ref={input}
				type="file"
			/>
		</>
	)
}

/**
 * `composerBelow` slot: the files picked for the next message, inside the
 * composer's box. It also takes the composer's drops and pastes.
 */
export function AttachmentsPicker({ channel, conversationKey }: ComposerSlotProps) {
	const { files, maxFiles, rejected, remove } = useAttachmentsComposer({ channel, conversationKey })
	if (files.length === 0 && rejected.length === 0) return null
	return (
		<div className="px-3 pb-2">
			{files.length > 0 ? (
				<ul className="flex flex-wrap gap-1.5">
					{files.map((entry) => (
						<li
							className="flex h-8 max-w-64 items-center gap-1.5 rounded-md border bg-muted/50 pr-1 pl-1 text-xs"
							key={entry.id}
						>
							{entry.preview ? (
								<img alt="" className="size-6 rounded-sm object-cover" src={entry.preview} />
							) : (
								<FileIcon className="size-4 text-muted-foreground" />
							)}
							<span className="min-w-0 truncate">{entry.file.name}</span>
							<span className="shrink-0 text-muted-foreground">{formatSize(entry.file.size)}</span>
							<Button
								aria-label={`Remove ${entry.file.name}`}
								onClick={() => remove(entry.id)}
								size="icon-xs"
								variant="ghost"
							>
								<XIcon />
							</Button>
						</li>
					))}
				</ul>
			) : null}
			{rejected.map((entry) => (
				<p className="mt-1 text-destructive text-xs" key={`${entry.reason}:${entry.filename}`}>
					{entry.reason === 'type'
						? `${entry.filename}: this file type is not allowed`
						: `Up to ${maxFiles} files per message`}
				</p>
			))}
		</div>
	)
}

/** Images and PDFs of one message, full size, one at a time. */
function AttachmentViewer({
	files,
	index,
	onIndexChange,
}: {
	files: AttachmentView[]
	index: null | number
	onIndexChange: (index: null | number) => void
}) {
	const file = index === null ? undefined : files[index]
	const step = (by: number) =>
		index === null ? undefined : onIndexChange((index + by + files.length) % files.length)
	return (
		<Dialog onOpenChange={(open) => (open ? undefined : onIndexChange(null))} open={Boolean(file)}>
			<DialogContent
				className="flex h-[85vh] flex-col gap-3 sm:max-w-4xl"
				onKeyDown={(event) => {
					if (event.key === 'ArrowRight') step(1)
					if (event.key === 'ArrowLeft') step(-1)
				}}
				showCloseButton={false}
			>
				{file?.url ? (
					<>
						<div className="flex items-center gap-2">
							<DialogTitle className="min-w-0 flex-1 truncate">{file.filename}</DialogTitle>
							{files.length > 1 ? (
								<>
									<Button
										aria-label="Previous file"
										onClick={() => step(-1)}
										size="icon-sm"
										variant="ghost"
									>
										<ChevronLeftIcon />
									</Button>
									<span className="text-muted-foreground text-xs tabular-nums">
										{(index ?? 0) + 1} / {files.length}
									</span>
									<Button
										aria-label="Next file"
										onClick={() => step(1)}
										size="icon-sm"
										variant="ghost"
									>
										<ChevronRightIcon />
									</Button>
								</>
							) : null}
							<a
								aria-label={`Download ${file.filename}`}
								className={buttonVariants({ size: 'icon-sm', variant: 'ghost' })}
								download={file.filename}
								href={file.url}
							>
								<DownloadIcon />
							</a>
							<Button
								aria-label="Close"
								onClick={() => onIndexChange(null)}
								size="icon-sm"
								variant="ghost"
							>
								<XIcon />
							</Button>
						</div>
						<div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-muted/40">
							{isImage(file) ? (
								<img
									alt={file.filename}
									className="max-h-full max-w-full object-contain"
									src={file.url}
								/>
							) : (
								<iframe
									className="size-full rounded-md bg-white"
									src={file.url}
									title={file.filename}
								/>
							)}
						</div>
					</>
				) : null}
			</DialogContent>
		</Dialog>
	)
}

/** `messageFooter` slot: a message's files; images and PDFs open in a viewer. */
export function MessageAttachments({ message }: { message: WindowMessage }) {
	const { files, uploads } = useAttachments(message)
	const [open, setOpen] = useState<null | number>(null)
	if (message.deletedAt || (files.length === 0 && uploads.length === 0)) return null
	const inViewer = files.filter(viewable)
	const images = files.filter(isImage)
	const others = files.filter((file) => !isImage(file))
	const show = (file: AttachmentView) => setOpen(inViewer.indexOf(file))
	return (
		<div className="mt-1.5 flex flex-col items-start gap-1.5">
			{images.length > 0 ? (
				<div className="flex flex-wrap gap-1.5">
					{images.map((file) => (
						<button
							aria-label={`Open ${file.filename}`}
							className="size-28 cursor-zoom-in overflow-hidden rounded-md border bg-muted"
							key={String(file.id)}
							onClick={() => show(file)}
							type="button"
						>
							<img
								alt={file.filename}
								className="size-full object-cover"
								loading="lazy"
								src={file.thumbnail ?? file.url ?? ''}
							/>
						</button>
					))}
				</div>
			) : null}
			{others.map((file) => (
				<div
					className="flex max-w-full items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-sm"
					key={String(file.id)}
				>
					<FileIcon className="size-4 shrink-0 text-muted-foreground" />
					{viewable(file) ? (
						<button
							className="min-w-0 truncate hover:underline"
							onClick={() => show(file)}
							type="button"
						>
							{file.filename}
						</button>
					) : (
						<a
							className="min-w-0 truncate hover:underline"
							href={file.url ?? undefined}
							rel="noreferrer"
							target="_blank"
						>
							{file.filename}
						</a>
					)}
					<span className="shrink-0 text-muted-foreground text-xs">
						{formatSize(file.filesize)}
					</span>
					{file.url ? (
						<a
							aria-label={`Download ${file.filename}`}
							className={buttonVariants({ size: 'icon-xs', variant: 'ghost' })}
							download={file.filename}
							href={file.url}
						>
							<DownloadIcon />
						</a>
					) : null}
				</div>
			))}
			{uploads.map((upload, index) => (
				<p
					className={
						upload.status === 'failed'
							? 'text-destructive text-xs'
							: 'text-muted-foreground text-xs'
					}
					// biome-ignore lint/suspicious/noArrayIndexKey: two uploads may share a name; the list never reorders.
					key={index}
					title={upload.error ?? undefined}
				>
					{upload.status === 'failed'
						? `${upload.filename} could not be uploaded`
						: `Uploading ${upload.filename}…`}
				</p>
			))}
			<AttachmentViewer files={inViewer} index={open} onIndexChange={setOpen} />
		</div>
	)
}

/** The three slots, ready for `ConversationUIProvider` (spread next to other extensions' slots). */
export const attachmentSlots = {
	composerActions: [AttachButton],
	composerBelow: [AttachmentsPicker],
	messageFooter: [MessageAttachments],
}
