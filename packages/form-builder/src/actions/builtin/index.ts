import type { AnyActionDefinition } from '../defineAction'
import { confirmation } from './confirmation'
import { emailTeam } from './emailTeam'
import { signedWebhook } from './signedWebhook'

export const defaultActionDefinitions: Record<string, AnyActionDefinition> = {
	emailTeam: emailTeam as AnyActionDefinition,
	confirmation: confirmation as AnyActionDefinition,
	signedWebhook: signedWebhook as AnyActionDefinition,
}
