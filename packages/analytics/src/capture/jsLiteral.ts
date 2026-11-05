/**
 * The two characters that are legal inside a JSON string but terminate a line in JavaScript.
 * Built from their code points rather than written out: both are invisible in source.
 */
export const LINE_SEPARATOR = String.fromCharCode(0x2028)
export const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

const ESCAPES: Record<string, string> = {
	'<': '\\u003c',
	'>': '\\u003e',
	'&': '\\u0026',
	[LINE_SEPARATOR]: '\\u2028',
	[PARAGRAPH_SEPARATOR]: '\\u2029',
}

const UNSAFE = new RegExp(`[<>&${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`, 'g')

/**
 * A value as a JavaScript literal safe inside an inline `<script>`, which `JSON.stringify` alone is
 * not (`</script>`, U+2028). Every value an adapter embeds in a snippet goes through this.
 */
export const jsLiteral = (value: unknown): string => {
	const json = JSON.stringify(value)
	return (json ?? 'null').replace(UNSAFE, (char) => ESCAPES[char] ?? char)
}
