import type { DateRange } from '../core/contract'
import { previousWindow } from '../timeframe/comparison'
import { resolveTimeframe, type TimeframePreset } from '../timeframe/presets'
import { addDaysInTz, startOfDayInTz } from '../timeframe/tz'
import type { RecipeWindow } from './cacheStore'

/** Every window a recipe can name, in the order a read is matched against them. */
export const RECIPE_WINDOWS: readonly RecipeWindow[] = ['live', 'days', 'previous']

export const isRecipeWindow = (value: unknown): value is RecipeWindow =>
	RECIPE_WINDOWS.some((window) => window === value)

/**
 * The window a recipe names at `now` in `tz` (see `RecipeWindow`); null where the preset has no
 * previous window (a range longer than a year).
 */
export const recipeWindow = (
	recipe: { timeframe: TimeframePreset; window: RecipeWindow },
	now: Date,
	tz: string
): DateRange | null => {
	const live = resolveTimeframe(recipe.timeframe, now, tz)
	if (recipe.window === 'live') {
		return live
	}
	if (recipe.window === 'previous') {
		return previousWindow(live, tz)
	}
	return {
		start: startOfDayInTz(live.start, tz),
		end: new Date(addDaysInTz(live.end, 1, tz).getTime() - 1),
	}
}
