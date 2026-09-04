import { keys, type TranslationKey } from './keys'

export const ru: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Задания',

	[keys.statusQueued]: 'В очереди',
	[keys.statusScheduled]: 'Запланировано',
	[keys.statusRetrying]: 'Повтор',
	[keys.statusRunning]: 'Выполняется',
	[keys.statusSucceeded]: 'Успешно',
	[keys.statusFailed]: 'Сбой',
	[keys.statusCancelled]: 'Отменено',

	[keys.fieldStatus]: 'Статус',
	[keys.fieldWorkflow]: 'Рабочий процесс',
	[keys.fieldTask]: 'Задача',
	[keys.fieldJob]: 'Задание',
	[keys.fieldQueue]: 'Очередь',
	[keys.fieldAttempts]: 'Попытки',
	[keys.fieldCreated]: 'Создано',
	[keys.fieldUpdated]: 'Обновлено',
	[keys.fieldCompleted]: 'Завершено',
	[keys.fieldExecuted]: 'Выполнено',
	[keys.fieldTaskId]: 'ID задачи',
	[keys.fieldInput]: 'Входные данные',
	[keys.fieldOutput]: 'Выходные данные',
	[keys.fieldError]: 'Ошибка',
	[keys.fieldId]: 'ID',
	[keys.fieldStarted]: 'Начато',
	[keys.fieldLeaseExpires]: 'Аренда истекает',
	[keys.fieldScheduledFor]: 'Запланировано на',

	[keys.outcome]: 'Результат',
	[keys.noAttempts]: 'Попыток пока не зафиксировано.',
	[keys.copy]: 'Скопировать',
	[keys.copied]: 'Скопировано',
	[keys.jobSingular]: 'задание',
	[keys.jobPlural]: 'заданий',
	[keys.errorWorkflowTaskExclusive]:
		'Задание выполняет либо рабочий процесс, либо задачу, но не оба сразу.',
	[keys.cronBadge]: 'Cron',
	[keys.attemptsTooltip]: 'Попытки выполнения этого задания, включая повторы',
	[keys.inlineStep]: 'встроенный шаг: {{id}}',
}
