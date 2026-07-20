import { expect, test } from '@playwright/test'

test('poll: voting reveals per-option results', async ({ page }) => {
	await page.goto('/poll')
	await expect(page.getByRole('heading', { name: 'Poll' })).toBeVisible()

	await page.getByLabel('Favorite framework').selectOption('payload')
	await page.getByRole('button', { name: 'Submit' }).click()

	// After voting, results replace the form (per-browser voted guard). One vote for Payload reads 100%.
	await expect(page.getByText('100%')).toBeVisible()
})

test('athlete poll: relationship-backed options, vote reveals name-labeled results', async ({
	page,
}) => {
	await page.goto('/athletes')
	await expect(page.getByRole('heading', { name: 'Who will win?' })).toBeVisible()

	// The options are the four athletes the author made voteable via the `athleteVote` relationship,
	// resolved from the field itself. A seeded-but-not-voteable athlete never appears as a choice.
	await expect(page.getByText('Mara Vieira')).toBeVisible()
	await expect(page.getByText('Liam Byrne')).toBeVisible()
	await expect(page.getByText('Kofi Mensah')).toHaveCount(0)

	await page.getByText('Mara Vieira').click()
	await page.getByRole('button', { name: 'Submit' }).click()

	// Results replace the form; one vote for Mara reads 100%, labeled with the athlete's name (not the id).
	await expect(page.getByText('100%')).toBeVisible()
	await expect(page.getByText('Mara Vieira')).toBeVisible()
})
