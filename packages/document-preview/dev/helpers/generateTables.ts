/** A generated table fixture: name (extension decides CSV or TSV) and its text. */
export type GeneratedTable = { name: string; text: string }

/** mulberry32: small, seeded, so every seed run produces the same files. */
const random = (seed: number) => () => {
	seed = (seed + 0x6d2b79f5) | 0
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const WORDS =
	'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua'.split(
		' '
	)
const NAMES = [
	'Ada',
	'Grace',
	'Linus',
	'Margaret',
	'Олена',
	'Тарас',
	'Zoë',
	'José',
	'李雷',
	'Søren',
]

const sentence = (rand: () => number, words: number) =>
	Array.from({ length: words }, () => WORDS[Math.floor(rand() * WORDS.length)]).join(' ')

/** Quote a CSV cell when it needs it (delimiter, quote or newline inside). */
const csvCell = (value: string, delimiter: string) =>
	value.includes(delimiter) || value.includes('"') || value.includes('\n')
		? `"${value.replaceAll('"', '""')}"`
		: value

const toText = (rows: string[][], delimiter: string) =>
	rows.map((row) => row.map((cell) => csvCell(cell, delimiter)).join(delimiter)).join('\n')

const grid = (
	seed: number,
	{ columns, rows }: { columns: number; rows: number },
	cell: (rand: () => number, row: number, column: number) => string
): string[][] => {
	const rand = random(seed)
	const header = Array.from({ length: columns }, (_, column) => `col_${column + 1}`)
	const body = Array.from({ length: rows }, (_, row) =>
		Array.from({ length: columns }, (_, column) => cell(rand, row, column))
	)
	return [header, ...body]
}

const number = (rand: () => number) => (rand() * 10_000).toFixed(2)

/**
 * Mixed shapes for exercising the CSV viewer: short and long cells, empty
 * cells, quoted delimiters, embedded newlines, non-Latin text, ragged rows.
 */
const mixedRows = (): string[][] => {
	const rand = random(7)
	const header = [
		'id',
		'name',
		'email',
		'amount',
		'notes (long)',
		'empty sometimes',
		'quoted, with commas',
		'multiline',
		'flag',
		...Array.from({ length: 21 }, (_, index) => `metric_${index + 1}`),
	]
	const rows = Array.from({ length: 2_000 }, (_, row) => {
		const name = NAMES[row % NAMES.length] ?? 'Ada'
		const cells = [
			String(row + 1),
			name,
			`${name.toLowerCase()}.${row}@example.com`,
			number(rand),
			sentence(rand, 10 + Math.floor(rand() * 40)),
			rand() < 0.4 ? '' : sentence(rand, 2),
			`${sentence(rand, 2)}, ${sentence(rand, 2)}`,
			rand() < 0.2 ? `line one\nline two ${row}` : 'single line',
			rand() < 0.5 ? 'true' : 'false',
			...Array.from({ length: 21 }, () => number(rand)),
		]
		// Every 50th row is short, as hand-edited exports often are.
		return row % 50 === 49 ? cells.slice(0, 5) : cells
	})
	return [header, ...rows]
}

/** Every generated table fixture, from tiny to past the 20 MB CSV limit. */
export const generateTables = (): GeneratedTable[] => [
	{ name: 'tiny.csv', text: 'name,score\nAda,97\nGrace,93\n' },
	{
		name: 'tall-120k-rows.csv',
		text: toText(
			grid(1, { columns: 8, rows: 120_000 }, (rand, row, column) =>
				column === 0 ? String(row + 1) : number(rand)
			),
			','
		),
	},
	{
		name: 'wide-600-columns.csv',
		text: toText(
			grid(2, { columns: 600, rows: 200 }, (rand) => number(rand)),
			','
		),
	},
	{
		name: 'huge-13k-by-120.csv',
		text: toText(
			grid(3, { columns: 120, rows: 13_000 }, (rand, _row, column) =>
				column % 10 === 1 ? sentence(rand, 3 + Math.floor(rand() * 8)) : number(rand)
			),
			','
		),
	},
	{ name: 'mixed-widths.csv', text: toText(mixedRows(), ',') },
	{
		name: 'tall-50k-rows.tsv',
		text: toText(
			grid(4, { columns: 12, rows: 50_000 }, (rand, row, column) =>
				column === 0 ? String(row + 1) : column === 1 ? sentence(rand, 2) : number(rand)
			),
			'\t'
		),
	},
	{
		name: 'wide-300-columns.tsv',
		text: toText(
			grid(5, { columns: 300, rows: 100 }, (rand, _row, column) =>
				column % 7 === 0 ? sentence(rand, 1 + Math.floor(rand() * 12)) : number(rand)
			),
			'\t'
		),
	},
	{
		name: 'too-large-25mb.csv',
		text: toText(
			grid(6, { columns: 10, rows: 300_000 }, (rand) => number(rand)),
			','
		),
	},
]
