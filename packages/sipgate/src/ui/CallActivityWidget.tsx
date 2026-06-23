import type { WidgetServerProps } from 'payload'

const CallActivityWidget = (props: WidgetServerProps) => {
	console.log(props)
	return (
		<div>
			<h1>Call Activity</h1>
		</div>
	)
}

export default CallActivityWidget
