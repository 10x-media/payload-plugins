import type { LexicalEditor } from '@payloadcms/richtext-lexical/lexical'

import type { TokenWindowValues } from './types'

/**
 * The window values each message editor last saw in its form. Lexical toolbar
 * and slash menu items get the editor but no React context, so the plugin
 * mirrors the form here and the items read it back to offer only tokens the
 * window can fill.
 */
const valuesByEditor = new WeakMap<LexicalEditor, TokenWindowValues>()

export const setWindowValues = (editor: LexicalEditor, values: TokenWindowValues): void => {
	valuesByEditor.set(editor, values)
}

export const getWindowValues = (editor: LexicalEditor): TokenWindowValues =>
	valuesByEditor.get(editor) ?? {}
