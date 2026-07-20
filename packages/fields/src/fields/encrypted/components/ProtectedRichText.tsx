import { RscEntryLexicalField } from '@payloadcms/richtext-lexical/rsc'
import type { RichTextFieldClient, RichTextFieldServerProps } from 'payload'
import type { ComponentProps } from 'react'
import type { EncryptedProtection } from '../types'
import { RichTextRevealGate } from './RichTextRevealGate'

type ProtectedRichTextProps = RichTextFieldServerProps & { protection: EncryptedProtection }

type SanitizedEditorConfig = ComponentProps<typeof RscEntryLexicalField>['sanitizedEditorConfig']

/**
 * Server component for a masked encrypted richText field. Delegates to Payload's
 * own RscEntryLexicalField so the app's complete Lexical node set mounts: the
 * virtual field is a real richText field, so the schema-map and import-map
 * pipeline ran for it. The rendered editor is wrapped in a client reveal gate.
 * The editor's server work runs regardless of reveal state; only its client
 * LexicalComposer is withheld until revealed. Crypto stays server-side, and this
 * file never enters a client bundle (the lexical editor loads via the app import
 * map like any richText field).
 */
export const ProtectedRichText = (props: ProtectedRichTextProps) => {
	const { protection: _protection, ...serverProps } = props
	const { editor } = serverProps.field
	// A sanitized richText field always carries the lexical editorConfig (the exact
	// value renderField injects for a native richText field); the loose adapter
	// type surfaces it as unknown, so assert the component's own prop type.
	const sanitizedEditorConfig = (
		editor && typeof editor === 'object' && 'editorConfig' in editor
			? editor.editorConfig
			: undefined
	) as SanitizedEditorConfig
	const clientField = serverProps.clientField as RichTextFieldClient | undefined
	// RscEntryLexicalField's declared props intersect ClientComponentProps and
	// ServerComponentProps, whose `field` types are mutually exclusive (client vs
	// server), so no non-cast value satisfies it. This is the exact runtime shape
	// renderField passes through its own loosely-typed boundary.
	const editorProps = { ...serverProps, sanitizedEditorConfig } as unknown as ComponentProps<
		typeof RscEntryLexicalField
	>
	return (
		<RichTextRevealGate
			label={clientField?.label}
			localized={clientField?.localized}
			path={serverProps.path}
			required={clientField?.required}
		>
			<RscEntryLexicalField {...editorProps} />
		</RichTextRevealGate>
	)
}
