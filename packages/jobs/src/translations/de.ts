import { keys, type TranslationKey } from './keys'

export const de: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Jobs',

	[keys.statusQueued]: 'In Warteschlange',
	[keys.statusScheduled]: 'Geplant',
	[keys.statusRetrying]: 'Wiederholung',
	[keys.statusRunning]: 'Läuft',
	[keys.statusSucceeded]: 'Erfolgreich',
	[keys.statusFailed]: 'Fehlgeschlagen',
	[keys.statusCancelled]: 'Abgebrochen',

	[keys.fieldStatus]: 'Status',
	[keys.fieldWorkflow]: 'Workflow',
	[keys.fieldTask]: 'Aufgabe',
	[keys.fieldJob]: 'Job',
	[keys.fieldQueue]: 'Warteschlange',
	[keys.fieldAttempts]: 'Versuche',
	[keys.fieldCreated]: 'Erstellt',
	[keys.fieldUpdated]: 'Aktualisiert',
	[keys.fieldCompleted]: 'Abgeschlossen',
	[keys.fieldExecuted]: 'Ausgeführt',
	[keys.fieldTaskId]: 'Aufgaben-ID',
	[keys.fieldInput]: 'Eingabe',
	[keys.fieldOutput]: 'Ausgabe',
	[keys.fieldError]: 'Fehler',
	[keys.fieldId]: 'ID',
	[keys.fieldStarted]: 'Gestartet',
	[keys.fieldLeaseExpires]: 'Lease läuft ab',
	[keys.fieldScheduledFor]: 'Geplant für',

	[keys.outcome]: 'Ergebnis',
	[keys.noAttempts]: 'Noch keine Versuche aufgezeichnet.',
	[keys.copy]: 'Kopieren',
	[keys.copied]: 'Kopiert',
	[keys.jobSingular]: 'Job',
	[keys.jobPlural]: 'Jobs',
	[keys.errorWorkflowTaskExclusive]:
		'Ein Job führt einen Workflow oder eine Aufgabe aus, nicht beides.',
	[keys.cronBadge]: 'Cron',
	[keys.attemptsTooltip]: 'Ausführungsversuche für diesen Job, einschließlich Wiederholungen',
	[keys.inlineStep]: 'inline: {{id}}',
}
