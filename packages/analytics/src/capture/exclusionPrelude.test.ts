import { describe, expect, it } from 'vitest'
import { EXCLUSION_STASH_KEY, EXCLUSION_STASH_MS } from '../tracker/exclusion'
import { exclusionPrelude, withExclusionPrelude } from './exclusionPrelude'

describe('exclusionPrelude', () => {
	it('reads the parameter, keeps its value for the tracker and rewrites the address, all guarded', () => {
		const script = exclusionPrelude('staff')
		expect(script).toContain('p="staff"')
		expect(script).toContain(`s="${EXCLUSION_STASH_KEY}";Object.defineProperty(w,s,{value:v,`)
		expect(script).toContain(`delete w[s]}catch(e){}},${EXCLUSION_STASH_MS})`)
		expect(script).toContain('history.replaceState(history.state,"",')
		expect(script.startsWith('(function(){try{')).toBe(true)
		expect(script.endsWith('}catch(e){}})();')).toBe(true)
		expect(() => new Function(script)).not.toThrow()
	})
})

describe('withExclusionPrelude', () => {
	const snippet = { scripts: [{ src: '/api/_x/p/global/js/script.js', defer: true }] }

	it('leads a snippet with the prelude while the link is on', () => {
		expect(withExclusionPrelude(snippet, 'staff').scripts).toEqual([
			{ inline: exclusionPrelude('staff') },
			...snippet.scripts,
		])
	})

	it('leaves a snippet alone while the link is off, and one with no script at all', () => {
		expect(withExclusionPrelude(snippet, undefined)).toBe(snippet)
		const empty = { scripts: [] }
		expect(withExclusionPrelude(empty, 'staff')).toBe(empty)
	})
})
