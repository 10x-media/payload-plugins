'use client'

import type { JSXConverters } from '@payloadcms/richtext-lexical/react'
import { createContext, type ReactNode, useContext, useMemo } from 'react'

import type { ComposerFeature } from '../composer/types'

export type ChatRichText = {
	/** Composer features for every `ChatComposer` below (unless one passes its own). */
	composerFeatures?: (args: { defaultFeatures: ComposerFeature[] }) => ComposerFeature[]
	/** JSX converters for every message body below, e.g. for what those features store. */
	converters?: JSXConverters
}

const Context = createContext<ChatRichText>({})

/**
 * A project's own rich text for the admin components below it: the composer
 * features that write it and the converters that show it, kept together so
 * a message looks as it was written. The website's `ConversationUIProvider`
 * takes the same pair.
 */
export const ChatRichTextProvider = ({
	children,
	composerFeatures,
	converters,
}: ChatRichText & { children?: ReactNode }) => {
	const value = useMemo(() => ({ composerFeatures, converters }), [composerFeatures, converters])
	return <Context.Provider value={value}>{children}</Context.Provider>
}

export const useChatRichText = (): ChatRichText => useContext(Context)
