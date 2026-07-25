import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { clientRuntimeKeys } from './clientRuntimeKeys'
import { en } from './en'
import { keys } from './keys'

const reactDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'react')

const collectSourceFiles = (dir: string, out: string[] = []): string[] => {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) {
			collectSourceFiles(full, out)
			continue
		}
		if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
			out.push(full)
		}
	}
	return out
}

/** Every typed-key string the visitor runtime (`src/react/**`) references as `keys.<name>`. */
const keysReferencedByReact = (): Set<string> => {
	const nameToValue = keys as Record<string, string>
	const found = new Set<string>()
	for (const file of collectSourceFiles(reactDir)) {
		const source = readFileSync(file, 'utf8')
		for (const match of source.matchAll(/\bkeys\.([A-Za-z0-9_]+)/g)) {
			const value = nameToValue[match[1] as string]
			if (value) {
				found.add(value)
			}
		}
	}
	return found
}

describe('clientRuntimeKeys', () => {
	it('exactly matches the keys the visitor runtime (react/**) resolves', () => {
		expect(new Set(clientRuntimeKeys)).toEqual(keysReferencedByReact())
	})

	it('lists only real keys present in the English bundle', () => {
		for (const key of clientRuntimeKeys) {
			expect(typeof en[key], `en missing ${key}`).toBe('string')
		}
	})

	it('has no duplicate entries', () => {
		expect(new Set(clientRuntimeKeys).size).toBe(clientRuntimeKeys.length)
	})
})
