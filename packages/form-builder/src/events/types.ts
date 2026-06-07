export type FormEventBase = { formId: string; at: string }

export type FormEvent =
	| (FormEventBase & { type: 'form.viewed' })
	| (FormEventBase & { type: 'form.started' })
	| (FormEventBase & { type: 'step.viewed'; stepId: string })
	| (FormEventBase & { type: 'step.completed'; stepId: string })
	| (FormEventBase & { type: 'field.errored'; field: string; message: string })
	| (FormEventBase & { type: 'form.abandoned' })
	| (FormEventBase & { type: 'submission.created'; submissionId: string })

export type FormEventSink = {
	emit: (event: FormEvent) => Promise<void> | void
}
