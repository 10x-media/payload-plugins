import { FILE_KINDS, type FileKind } from './fileKind'

/**
 * Payload's fallback `File` graphic, path for path: a #333 square with a white
 * page and a grey folded corner. The icons draw the file type onto that page and
 * scale the whole page up (`PAGE_SCALE`), since at Payload's size the type would
 * be unreadable in a thumbnail.
 */
const BACKGROUND = '#333333'
const PAGE = 'M82.8876 50.5H55.5555V100.5H94.4444V61.9818H82.8876V50.5Z'
const FOLD = 'M82.8876 61.9818H94.4444L82.8876 50.5V61.9818Z'

/** How much larger than Payload's page the icons draw it, around the page's center (75, 75.5). */
const PAGE_SCALE = 2

/** Text-like rules at the top of the page, kept clear of the folded corner. */
const RULES =
	'<path d="M59.5 57.5h19M59.5 62.5h19M59.5 67.5h31M59.5 72.5h24" stroke="#D6D6D6" stroke-linecap="round" stroke-width="2"/>'

type Badge = { color: string; label?: string; symbol?: string }

/** Glyphs drawn in white inside the badge, centered on (75, 86). */
const SYMBOLS = {
	audio:
		'<g fill="#fff"><path d="M71.7 82.3l6.5-1.5v1.8l-6.5 1.5z"/><rect x="71.7" y="82.3" width="1.3" height="7.3"/><rect x="76.9" y="80.8" width="1.3" height="7.3"/><circle cx="71" cy="89.7" r="2"/><circle cx="76.2" cy="88.2" r="2"/></g>',
	image:
		'<path d="M66.5 91.5l4.6-6.4 3.3 4.2 2.3-2.6 4.8 4.8z" fill="#fff"/><circle cx="80.4" cy="81.8" r="1.7" fill="#fff"/>',
	video: '<path d="M72 80.8l8.6 5.2-8.6 5.2z" fill="#fff"/>',
} as const

/** Per family: the badge colour and its label or glyph. `file` draws no badge. */
const BADGES: Record<Exclude<FileKind, 'file'>, Badge> = {
	archive: { color: '#9C7B52', label: 'ZIP' },
	audio: { color: '#D9468F', symbol: SYMBOLS.audio },
	code: { color: '#4F6D8F', label: '</>' },
	csv: { color: '#0F9F8E', label: 'CSV' },
	image: { color: '#2F9BD6', symbol: SYMBOLS.image },
	json: { color: '#D9A21B', label: '{ }' },
	markdown: { color: '#5B5BD6', label: 'MD' },
	pdf: { color: '#E2463F', label: 'PDF' },
	sheet: { color: '#1F9D55', label: 'XLS' },
	slides: { color: '#E0662E', label: 'PPT' },
	text: { color: '#7A7A7A', label: 'TXT' },
	video: { color: '#7C4DDB', symbol: SYMBOLS.video },
	word: { color: '#2B6CD4', label: 'DOC' },
}

const escapeXml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')

const badge = ({ color, label, symbol }: Badge) => {
	const content = label
		? `<text x="75" y="86.4" fill="#fff" font-family="system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif" font-size="8.5" font-weight="700" letter-spacing=".3" text-anchor="middle" dominant-baseline="middle">${escapeXml(label)}</text>`
		: (symbol ?? '')
	return `<rect x="58.5" y="78" width="33" height="16.5" rx="2" fill="${color}"/>${content}`
}

/**
 * The icon for a file family as a standalone SVG document: usable as an `<img>`
 * source or a thumbnail URL, not only inside React.
 */
export const fileIconSvg = (kind: FileKind): string => {
	const decoration = kind === 'file' ? '' : `${RULES}${badge(BADGES[kind])}`
	const page = `<path d="${PAGE}" fill="#fff"/><path d="${FOLD}" fill="#9A9A9A"/>${decoration}`
	return `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150"><rect width="150" height="150" fill="${BACKGROUND}"/><g transform="translate(75 75.5) scale(${PAGE_SCALE}) translate(-75 -75.5)">${page}</g></svg>`
}

/** `fileIconSvg` as a data URI. */
export const fileIconDataUri = (kind: FileKind): string =>
	`data:image/svg+xml;charset=utf-8,${encodeURIComponent(fileIconSvg(kind))}`

/**
 * A short hash of every icon's markup, for the icon URLs: browsers cache the
 * icons for a year, so changed artwork must change the URL.
 */
export const FILE_ICONS_VERSION = (() => {
	let hash = 5381
	for (const char of FILE_KINDS.map(fileIconSvg).join('')) {
		hash = ((hash << 5) + hash + char.charCodeAt(0)) | 0
	}
	return (hash >>> 0).toString(36)
})()
