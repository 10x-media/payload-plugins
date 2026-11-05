/** Most segments a goal's address pattern may have. */
export const MAX_PATTERN_SEGMENTS = 32

/** Most `**` one pattern may use. */
export const MAX_PATTERN_GLOBSTARS = 4

/** A path deeper than this never matches any pattern. */
export const MAX_PATH_SEGMENTS = 128

/** Why a pattern is refused, or null when it is within the caps. */
export type PatternProblem = 'too-many-segments' | 'too-many-globstars'

type Segment =
	| { kind: 'literal'; text: string }
	/** Text around wildcards: one wildcard, one or more characters, between consecutive parts. */
	| { kind: 'glob'; parts: string[] }
	| { kind: 'globstar' }

const indexOrEnd = (value: string, char: string): number => {
	const index = value.indexOf(char)
	return index === -1 ? value.length : index
}

/**
 * Query and hash cut, then one trailing slash, on a pattern and a path alike, so a pattern
 * pasted from an address matches the way the address does.
 */
const pathOnly = (value: string): string => {
	const cut = value.slice(0, Math.min(indexOrEnd(value, '?'), indexOrEnd(value, '#')))
	return cut.length > 1 && cut.endsWith('/') ? cut.slice(0, -1) : cut
}

/** Segments as a split on `/` writes them, minus the empty one before a leading slash. */
const depthOf = (pieces: string[], value: string): number =>
	pieces.length - (value.startsWith('/') ? 1 : 0)

const onlyStars = (text: string): boolean => {
	for (const char of text) {
		if (char !== '*') {
			return false
		}
	}
	return true
}

/** Each run of two or more stars counts once, wherever it stands. */
const globstarRuns = (text: string): number => {
	let runs = 0
	let stars = 0
	for (const char of text) {
		if (char === '*') {
			stars++
			continue
		}
		if (stars >= 2) {
			runs++
		}
		stars = 0
	}
	return stars >= 2 ? runs + 1 : runs
}

const compileSegment = (text: string): Segment => {
	if (!text.includes('*')) {
		return { kind: 'literal', text }
	}
	if (text.length >= 2 && onlyStars(text)) {
		return { kind: 'globstar' }
	}
	// A run of stars inside a segment is one wildcard: only the first and last parts can be empty.
	const pieces = text.split('*')
	const parts: string[] = [pieces[0] ?? '']
	for (let i = 1; i < pieces.length; i++) {
		const piece = pieces[i] ?? ''
		if (piece !== '' || i === pieces.length - 1) {
			parts.push(piece)
		}
	}
	return { kind: 'glob', parts }
}

/**
 * Greedy and linear: each middle part takes its earliest place, which leaves the most room for
 * the rest, and every wildcard keeps at least one character.
 */
const globMatches = (parts: string[], text: string): boolean => {
	const first = parts[0] ?? ''
	if (!text.startsWith(first)) {
		return false
	}
	let end = first.length
	const last = parts.length - 1
	for (let i = 1; i < last; i++) {
		const part = parts[i] ?? ''
		const at = text.indexOf(part, end + 1)
		if (at === -1) {
			return false
		}
		end = at + part.length
	}
	const tail = parts[last] ?? ''
	return text.length - tail.length >= end + 1 && text.endsWith(tail)
}

const segmentMatches = (segment: Segment, text: string): boolean => {
	switch (segment.kind) {
		case 'literal':
			return segment.text === text
		case 'glob':
			return globMatches(segment.parts, text)
		case 'globstar':
			return false
	}
}

/** A pattern checked against the caps, ready to match any number of paths. */
export interface CompiledPattern {
	segments: Segment[]
}

/** Why `pattern` exceeds the caps, or null when a goal may use it. */
export const patternProblem = (pattern: string): PatternProblem | null => {
	const cut = pathOnly(pattern)
	if (depthOf(cut.split('/'), cut) > MAX_PATTERN_SEGMENTS) {
		return 'too-many-segments'
	}
	return globstarRuns(cut) > MAX_PATTERN_GLOBSTARS ? 'too-many-globstars' : null
}

/** The pattern compiled, or null for one over the caps, which then matches nothing. */
export const compilePattern = (pattern: string): CompiledPattern | null => {
	if (patternProblem(pattern) !== null) {
		return null
	}
	return { segments: pathOnly(pattern).split('/').map(compileSegment) }
}

/** The path's segments, or null for a path too deep to match anything. */
export const pathSegments = (path: string): string[] | null => {
	const cut = pathOnly(path)
	const pieces = cut.split('/')
	return depthOf(pieces, cut) > MAX_PATH_SEGMENTS ? null : pieces
}

/**
 * Whether the pattern covers the path, by dynamic programming over segments. `**` takes one or more
 * non-empty segments, keeping `/docs/**` off `/docs` and `/**` off the root.
 */
export const matchesSegments = (pattern: CompiledPattern, path: string[]): boolean => {
	const size = path.length
	let row: boolean[] = Array.from({ length: size + 1 }, (_, j) => j === 0)
	for (const segment of pattern.segments) {
		const next: boolean[] = Array.from({ length: size + 1 }, () => false)
		let any = false
		if (segment.kind === 'globstar') {
			let before = false
			for (let j = 1; j <= size; j++) {
				if (j >= 2 && row[j - 2] === true) {
					before = true
				}
				const reached = before || (row[j - 1] === true && path[j - 1] !== '')
				next[j] = reached
				any ||= reached
			}
		} else {
			for (let j = 0; j < size; j++) {
				if (row[j] === true && segmentMatches(segment, path[j] ?? '')) {
					next[j + 1] = true
					any = true
				}
			}
		}
		if (!any) {
			return false
		}
		row = next
	}
	return row[size] === true
}

/**
 * Anchored, case-sensitive glob: a whole-segment `*` is one segment, in-segment `*` one or more
 * characters, `**` one or more segments. Trailing slashes, queries and hashes are ignored.
 */
export const pathMatches = (pattern: string, path: string): boolean => {
	const compiled = compilePattern(pattern)
	const segments = pathSegments(path)
	return compiled !== null && segments !== null && matchesSegments(compiled, segments)
}
