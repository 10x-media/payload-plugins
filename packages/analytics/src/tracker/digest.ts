import type { TrackerWindow } from './types'

const hex = (bytes: ArrayBuffer): string => {
	let out = ''
	for (const byte of new Uint8Array(bytes)) {
		out += byte.toString(16).padStart(2, '0')
	}
	return out
}

/**
 * The SHA-256 of `text` as lowercase hex, by `crypto.subtle`. Null when hashing fails or the page
 * has no `crypto.subtle` (plain http outside localhost).
 */
export const sha256Hex = async (win: TrackerWindow, text: string): Promise<string | null> => {
	const subtle: SubtleCrypto | undefined = win.crypto?.subtle
	if (!subtle) {
		return null
	}
	try {
		return hex(await subtle.digest('SHA-256', new TextEncoder().encode(text)))
	} catch {
		return null
	}
}

/**
 * Whether `text` hashes to `digest`. False where the page cannot hash (no `crypto.subtle`), so a
 * check that cannot run never passes.
 */
export const matchesDigest = async (
	win: TrackerWindow,
	text: string,
	digest: string
): Promise<boolean> => (await sha256Hex(win, text)) === digest
