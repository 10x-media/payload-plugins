import { keys, type TranslationKey } from './keys'

export const uk: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Завдання',

	[keys.statusQueued]: 'У черзі',
	[keys.statusScheduled]: 'Заплановано',
	[keys.statusRetrying]: 'Повтор',
	[keys.statusRunning]: 'Виконується',
	[keys.statusSucceeded]: 'Успішно',
	[keys.statusFailed]: 'Збій',
	[keys.statusCancelled]: 'Скасовано',

	[keys.fieldStatus]: 'Статус',
	[keys.fieldWorkflow]: 'Робочий процес',
	[keys.fieldTask]: 'Задача',
	[keys.fieldJob]: 'Завдання',
	[keys.fieldQueue]: 'Черга',
	[keys.fieldAttempts]: 'Спроби',
	[keys.fieldCreated]: 'Створено',
	[keys.fieldUpdated]: 'Оновлено',
	[keys.fieldCompleted]: 'Завершено',
	[keys.fieldExecuted]: 'Виконано',
	[keys.fieldTaskId]: 'ID задачі',
	[keys.fieldInput]: 'Вхідні дані',
	[keys.fieldOutput]: 'Вихідні дані',
	[keys.fieldError]: 'Помилка',
	[keys.fieldId]: 'ID',
	[keys.fieldStarted]: 'Розпочато',
	[keys.fieldLeaseExpires]: 'Оренда спливає',
	[keys.fieldScheduledFor]: 'Заплановано на',

	[keys.outcome]: 'Результат',
	[keys.noAttempts]: 'Спроб ще не зафіксовано.',
	[keys.copy]: 'Скопіювати',
	[keys.copied]: 'Скопійовано',
	[keys.jobSingular]: 'завдання',
	[keys.jobPlural]: 'завдань',
	[keys.errorWorkflowTaskExclusive]:
		'Завдання виконує або робочий процес, або задачу, але не обидва.',
	[keys.cronBadge]: 'Cron',
	[keys.attemptsTooltip]: 'Спроби виконання цього завдання, включно з повторами',
	[keys.inlineStep]: 'вбудований крок: {{id}}',
}
