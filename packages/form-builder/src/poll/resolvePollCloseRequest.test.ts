import { describe, expect, it } from 'vitest'
import { planPollClose } from './resolvePollCloseRequest'

const past = () => new Date(Date.now() - 60_000).toISOString()
const future = () => new Date(Date.now() + 60 * 60_000).toISOString()

describe('planPollClose', () => {
	it('refuses a form that is not poll-enabled', () => {
		expect(planPollClose({ pollEnabled: false, poll: { type: 'manual' } })).toEqual({
			ok: false,
			reason: 'not-poll',
		})
	})

	it('refuses a poll-enabled form with no poll config', () => {
		expect(planPollClose({ pollEnabled: true, poll: null })).toEqual({
			ok: false,
			reason: 'not-poll',
		})
	})

	it('refuses a poll that already closed', () => {
		expect(
			planPollClose({ pollEnabled: true, poll: { type: 'mostVoted', closesAt: past() } })
		).toEqual({ ok: false, reason: 'already-closed' })
	})

	it('refuses a manual poll with no winner recorded', () => {
		expect(planPollClose({ pollEnabled: true, poll: { type: 'manual' } })).toEqual({
			ok: false,
			reason: 'manual-no-winner',
		})
		expect(
			planPollClose({ pollEnabled: true, poll: { type: 'manual', outcome: { winningValues: [] } } })
		).toEqual({ ok: false, reason: 'manual-no-winner' })
	})

	it('treats an absent type as manual', () => {
		expect(planPollClose({ pollEnabled: true, poll: {} })).toEqual({
			ok: false,
			reason: 'manual-no-winner',
		})
	})

	it('closes a manual poll that has a winner without resolving', () => {
		expect(
			planPollClose({
				pollEnabled: true,
				poll: { type: 'manual', outcome: { winningValues: ['red'] } },
			})
		).toEqual({ ok: true, resolveOutcome: false })
	})

	it('closes a mostVoted poll and asks to resolve the outcome', () => {
		expect(planPollClose({ pollEnabled: true, poll: { type: 'mostVoted' } })).toEqual({
			ok: true,
			resolveOutcome: true,
		})
	})

	it('closes a source poll and asks to resolve the outcome', () => {
		expect(planPollClose({ pollEnabled: true, poll: { type: 'source' } })).toEqual({
			ok: true,
			resolveOutcome: true,
		})
	})

	it('closes a poll scheduled to close in the future (forces it now)', () => {
		expect(
			planPollClose({ pollEnabled: true, poll: { type: 'mostVoted', closesAt: future() } })
		).toEqual({ ok: true, resolveOutcome: true })
	})
})
