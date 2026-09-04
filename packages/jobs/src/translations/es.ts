import { keys, type TranslationKey } from './keys'

export const es: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Trabajos',

	[keys.statusQueued]: 'En cola',
	[keys.statusScheduled]: 'Programado',
	[keys.statusRetrying]: 'Reintentando',
	[keys.statusRunning]: 'En ejecución',
	[keys.statusSucceeded]: 'Exitoso',
	[keys.statusFailed]: 'Fallido',
	[keys.statusCancelled]: 'Cancelado',

	[keys.fieldStatus]: 'Estado',
	[keys.fieldWorkflow]: 'Flujo de trabajo',
	[keys.fieldTask]: 'Tarea',
	[keys.fieldJob]: 'Trabajo',
	[keys.fieldQueue]: 'Cola',
	[keys.fieldAttempts]: 'Intentos',
	[keys.fieldCreated]: 'Creado',
	[keys.fieldUpdated]: 'Actualizado',
	[keys.fieldCompleted]: 'Completado',
	[keys.fieldExecuted]: 'Ejecutado',
	[keys.fieldTaskId]: 'ID de tarea',
	[keys.fieldInput]: 'Entrada',
	[keys.fieldOutput]: 'Salida',
	[keys.fieldError]: 'Error',
	[keys.fieldId]: 'ID',
	[keys.fieldStarted]: 'Iniciado',
	[keys.fieldLeaseExpires]: 'Vencimiento de la concesión',
	[keys.fieldScheduledFor]: 'Programado para',

	[keys.outcome]: 'Resultado',
	[keys.noAttempts]: 'Aún no hay intentos registrados.',
	[keys.copy]: 'Copiar',
	[keys.copied]: 'Copiado',
	[keys.jobSingular]: 'trabajo',
	[keys.jobPlural]: 'trabajos',
	[keys.errorWorkflowTaskExclusive]:
		'Un trabajo ejecuta un flujo de trabajo o una tarea, no ambos.',
	[keys.cronBadge]: 'Cron',
	[keys.attemptsTooltip]: 'Intentos de ejecución de este trabajo, incluidos los reintentos',
	[keys.inlineStep]: 'en línea: {{id}}',
}
