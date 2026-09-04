import { keys, type TranslationKey } from './keys'

export const pt: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Trabalhos',

	[keys.statusQueued]: 'Na fila',
	[keys.statusScheduled]: 'Agendado',
	[keys.statusRetrying]: 'A tentar novamente',
	[keys.statusRunning]: 'Em execução',
	[keys.statusSucceeded]: 'Bem-sucedido',
	[keys.statusFailed]: 'Falhou',
	[keys.statusCancelled]: 'Cancelado',

	[keys.fieldStatus]: 'Estado',
	[keys.fieldWorkflow]: 'Fluxo de trabalho',
	[keys.fieldTask]: 'Tarefa',
	[keys.fieldJob]: 'Trabalho',
	[keys.fieldQueue]: 'Fila',
	[keys.fieldAttempts]: 'Tentativas',
	[keys.fieldCreated]: 'Criado',
	[keys.fieldUpdated]: 'Atualizado',
	[keys.fieldCompleted]: 'Concluído',
	[keys.fieldExecuted]: 'Executado',
	[keys.fieldTaskId]: 'ID da tarefa',
	[keys.fieldInput]: 'Entrada',
	[keys.fieldOutput]: 'Saída',
	[keys.fieldError]: 'Erro',
	[keys.fieldId]: 'ID',
	[keys.fieldStarted]: 'Iniciado',
	[keys.fieldLeaseExpires]: 'Expiração da concessão',
	[keys.fieldScheduledFor]: 'Agendado para',

	[keys.outcome]: 'Resultado',
	[keys.noAttempts]: 'Nenhuma tentativa registada ainda.',
	[keys.copy]: 'Copiar',
	[keys.copied]: 'Copiado',
	[keys.jobSingular]: 'trabalho',
	[keys.jobPlural]: 'trabalhos',
	[keys.errorWorkflowTaskExclusive]:
		'Um trabalho executa um fluxo de trabalho ou uma tarefa, não ambos.',
	[keys.cronBadge]: 'Cron',
	[keys.attemptsTooltip]: 'Tentativas de execução deste trabalho, incluindo novas tentativas',
	[keys.inlineStep]: 'em linha: {{id}}',
}
