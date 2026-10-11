/** Monaco language ids by file extension, the most specific signal a text file carries. */
const BY_EXTENSION: Record<string, string> = {
	bash: 'shell',
	c: 'c',
	cjs: 'javascript',
	cpp: 'cpp',
	cs: 'csharp',
	css: 'css',
	go: 'go',
	gql: 'graphql',
	graphql: 'graphql',
	h: 'c',
	htm: 'html',
	html: 'html',
	ini: 'ini',
	java: 'java',
	js: 'javascript',
	json: 'json',
	jsx: 'javascript',
	less: 'less',
	md: 'markdown',
	mjs: 'javascript',
	php: 'php',
	py: 'python',
	rb: 'ruby',
	rs: 'rust',
	scss: 'scss',
	sh: 'shell',
	sql: 'sql',
	svg: 'xml',
	toml: 'ini',
	ts: 'typescript',
	tsx: 'typescript',
	xml: 'xml',
	yaml: 'yaml',
	yml: 'yaml',
}

/** Fallback by mime, for files whose name has no known extension. */
const BY_MIME: Record<string, string> = {
	'application/javascript': 'javascript',
	'application/json': 'json',
	'application/sql': 'sql',
	'application/typescript': 'typescript',
	'application/xml': 'xml',
	'application/yaml': 'yaml',
	'text/css': 'css',
	'text/html': 'html',
	'text/javascript': 'javascript',
	'text/markdown': 'markdown',
	'text/xml': 'xml',
	'text/yaml': 'yaml',
}

/** The Monaco language for a text file: extension first, then mime, then plain text. */
export const codeLanguage = (filename: string, mimeType: string): string => {
	const dot = filename.lastIndexOf('.')
	const extension = dot === -1 ? '' : filename.slice(dot + 1).toLowerCase()
	return BY_EXTENSION[extension] ?? BY_MIME[mimeType] ?? 'plaintext'
}
