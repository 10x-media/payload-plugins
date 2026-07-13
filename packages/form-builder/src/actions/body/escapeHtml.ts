const REPLACEMENTS: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
}

/** Escape `&`, `<`, `>`, `"`, `'` for safe embedding in HTML text or attribute values. */
export const escapeHtml = (value: string): string =>
	value.replace(/[&<>"']/g, (char) => REPLACEMENTS[char] ?? char)
