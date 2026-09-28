import {
	BoldFeature,
	FixedToolbarFeature,
	ItalicFeature,
	LinkFeature,
	lexicalEditor,
	OrderedListFeature,
	ParagraphFeature,
	UnorderedListFeature,
} from '@payloadcms/richtext-lexical'
import type { CollectionSlug } from 'payload'

import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import type { ConversationsEditorFeature, ConversationsInstance } from '../types'
import { ConversationsMentionFeature } from './mention/server'

/**
 * The instance editor's default features: short-message formatting only.
 * Links are external only (`enabledCollections: []`); their schemes are
 * narrowed to http, https and mailto when a message is saved.
 */
export const defaultConversationFeatures = (instance: string): ConversationsEditorFeature[] => [
	ParagraphFeature(),
	BoldFeature(),
	ItalicFeature(),
	LinkFeature({ enabledCollections: [] as CollectionSlug[] }),
	UnorderedListFeature(),
	OrderedListFeature(),
	ConversationsMentionFeature({ instance }),
	FixedToolbarFeature(),
]

/** The self-contained editor of one instance. Never inherits the project's editor. */
export const buildConversationEditor = (
	instance: ConversationsInstance
): ReturnType<typeof lexicalEditor> =>
	lexicalEditor({
		// A chat composer, not a document: no gutter, drag handles or block buttons.
		admin: {
			hideAddBlockButton: true,
			hideDraggableBlockElement: true,
			hideGutter: true,
			hideInsertParagraphAtEnd: true,
			placeholder: labelForKey(keys.composerPlaceholder),
		},
		features: () =>
			instance.editorFeatures({ defaultFeatures: defaultConversationFeatures(instance.slug) }),
	})
