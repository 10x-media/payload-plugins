import { describe, expectTypeOf, it } from 'vitest'
import type {
	ModeSnapshot as ReactModeSnapshot,
	SlotMode as ReactSlotMode,
	useAnalytics,
} from './react'
import type { ModeSnapshot, SlotMode, Tracker } from './tracker'

/** Checked by the type checker: each entry that exports `GateStatus` also names a slot's mode. */
describe('the slot mode types', () => {
	it('are the same from /tracker and /react', () => {
		expectTypeOf<ReactSlotMode>().toEqualTypeOf<SlotMode>()
		expectTypeOf<ReactModeSnapshot>().toEqualTypeOf<ModeSnapshot>()
		expectTypeOf<SlotMode>().toEqualTypeOf<'off' | 'cookieless' | 'anonymous' | 'full'>()
	})

	it('type what the tracker and useAnalytics give', () => {
		expectTypeOf<Tracker['mode']>().toEqualTypeOf<ModeSnapshot>()
		expectTypeOf<ReturnType<typeof useAnalytics>['mode']>().toEqualTypeOf<ModeSnapshot>()
		expectTypeOf<ModeSnapshot['tenant']>().toEqualTypeOf<SlotMode>()
	})
})
