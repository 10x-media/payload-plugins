//biome-ignore-all lint/suspicious/noExplicitAny: Just porting this from old repo. Feel free to improve
'use client'

import type { PluginComponent } from '@payloadcms/richtext-lexical'
import { $createUploadNode } from '@payloadcms/richtext-lexical/client'

import {
	$getNodeByKey,
	$getPreviousSelection,
	$getSelection,
	$isParagraphNode,
	$isRangeSelection,
	COMMAND_PRIORITY_LOW,
} from '@payloadcms/richtext-lexical/lexical'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { $insertNodeToNearestRoot } from '@payloadcms/richtext-lexical/lexical/utils'
import type { ListDrawerProps } from '@payloadcms/ui'
import { useListDrawer } from '@payloadcms/ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useFolderPickerDrawer } from '../../components/FolderPickerDrawer/useFolderPickerDrawer'

export type FolderUploadPluginClientProps = {
	allUploadSlugs: string[]
	folderEnabledSlugs: string[]
}

export const FolderUploadPlugin: PluginComponent<FolderUploadPluginClientProps> = ({
	clientProps,
}) => {
	const { allUploadSlugs = [], folderEnabledSlugs = [] } = clientProps ?? {}
	const [editor] = useLexicalComposerContext()
	const [replaceNodeKey, setReplaceNodeKey] = useState<null | string>(null)
	const unregisterInterceptRef = useRef<(() => void) | undefined>(undefined)
	const openDrawerForUploadRef = useRef<(nodeKey: string | null) => void>(() => {})

	const [FolderPickerDrawer, , { openDrawer, closeDrawer }] = useFolderPickerDrawer({
		collectionSlugs: folderEnabledSlugs,
		hasMany: false,
	})

	const [ListDrawer, , { closeDrawer: closeListDrawer, openDrawer: openListDrawer }] =
		useListDrawer({ collectionSlugs: allUploadSlugs })

	const openDrawerForUpload = useCallback(
		(nodeKey: string | null) => {
			setReplaceNodeKey(nodeKey)
			openDrawer()
		},
		[openDrawer]
	)

	// Keep ref in sync so the command handler always calls the latest version
	// without needing to be in the effect deps (avoids re-register on every render)
	openDrawerForUploadRef.current = openDrawerForUpload

	const insertUpload = useCallback(
		(collectionSlug: string, docId: string | number) => {
			if (!replaceNodeKey) {
				editor.update(() => {
					const selection = $getSelection() ?? $getPreviousSelection()
					if ($isRangeSelection(selection)) {
						const node = $createUploadNode({
							// @ts-expect-error fields can be null initially — same as Payload's own UploadPlugin
							data: { fields: null, relationTo: collectionSlug, value: docId },
						})
						const focusNode = selection.focus.getNode()
						$insertNodeToNearestRoot(node)
						if ($isParagraphNode(focusNode) && !focusNode.__first) {
							focusNode.remove()
						}
					}
				})
			} else {
				editor.update(() => {
					const existingNode = $getNodeByKey(replaceNodeKey)
					if (existingNode) {
						existingNode.replace(
							$createUploadNode({
								// @ts-expect-error fields can be null initially
								data: { fields: null, relationTo: collectionSlug, value: docId },
							})
						)
					}
				})
				setReplaceNodeKey(null)
			}
		},
		[editor, replaceNodeKey]
	)

	const handleSelect = useCallback(
		({ collectionSlug, doc }: { collectionSlug: string; doc: { id: string | number } }) => {
			closeDrawer()
			insertUpload(collectionSlug, doc.id)
		},
		[closeDrawer, insertUpload]
	)

	const onSwitchToListView = useCallback(() => {
		closeDrawer()
		openListDrawer()
	}, [closeDrawer, openListDrawer])

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const handleListSelect = useCallback<NonNullable<ListDrawerProps['onSelect']>>(
		({ collectionSlug, doc }) => {
			closeListDrawer()
			insertUpload(collectionSlug, (doc as any).id)
		},
		[closeListDrawer, insertUpload]
	)

	// Intercept INSERT_UPLOAD_WITH_DRAWER_COMMAND dispatched by UploadFeature.
	// Because the command singleton is not part of @payloadcms/richtext-lexical's public API,
	// we locate it in the editor's internal _commands map after all effects have run
	// (setTimeout 0 ensures UploadDrawer's useEffect has already registered it).
	useEffect(() => {
		if (folderEnabledSlugs.length === 0) return

		let cancelled = false

		const timer = setTimeout(() => {
			if (cancelled) return

			const commands = (editor as any)._commands as Map<unknown, unknown> | undefined
			if (!commands) return

			const uploadWithDrawerCmd = [...commands.keys()].find(
				(c) => (c as any)?.type === 'INSERT_UPLOAD_WITH_DRAWER_COMMAND'
			)
			if (!uploadWithDrawerCmd) return

			unregisterInterceptRef.current = editor.registerCommand(
				uploadWithDrawerCmd as any,
				(payload: any) => {
					openDrawerForUploadRef.current(
						payload?.replace ? (payload.replace.nodeKey as string) : null
					)
					return true
				},
				COMMAND_PRIORITY_LOW
			)
		}, 0)

		return () => {
			cancelled = true
			clearTimeout(timer)
			unregisterInterceptRef.current?.()
			unregisterInterceptRef.current = undefined
		}
	}, [editor, folderEnabledSlugs.length])

	if (folderEnabledSlugs.length === 0) return null

	return (
		<>
			<FolderPickerDrawer onSelect={handleSelect} onSwitchToListView={onSwitchToListView} />
			<ListDrawer onSelect={handleListSelect} />
		</>
	)
}
