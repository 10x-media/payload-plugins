import type { TextFieldServerProps } from 'payload'
import { clientFieldProps } from '../ui/data/clientFieldProps'
import { WithScopeToken } from '../ui/data/WithScopeToken'
import { GoalSelectField } from './GoalSelectField'

/**
 * The goal picker `goalField()` renders, its goal list keyed by the scope token resolved from the
 * `req` Payload hands a field server component (`ServerFieldBase`).
 *
 * @internal
 */
export function GoalSelectFieldServer(props: TextFieldServerProps) {
	return (
		<WithScopeToken req={props.req}>
			<GoalSelectField {...clientFieldProps(props)} />
		</WithScopeToken>
	)
}
