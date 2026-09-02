import { keys, type TranslationKey } from './keys'

export const ko: Record<TranslationKey, string> = {
	[keys.pluginName]: '작업',

	[keys.statusQueued]: '대기 중',
	[keys.statusScheduled]: '예약됨',
	[keys.statusRetrying]: '재시도 중',
	[keys.statusRunning]: '실행 중',
	[keys.statusSucceeded]: '성공',
	[keys.statusFailed]: '실패',
	[keys.statusCancelled]: '취소됨',

	[keys.fieldStatus]: '상태',
	[keys.fieldWorkflow]: '워크플로',
	[keys.fieldTask]: '태스크',
	[keys.fieldJob]: '작업',
	[keys.fieldQueue]: '대기열',
	[keys.fieldAttempts]: '시도 횟수',
	[keys.fieldCreated]: '생성 일시',
	[keys.fieldUpdated]: '업데이트 일시',
	[keys.fieldCompleted]: '완료 일시',
	[keys.fieldExecuted]: '실행 일시',
	[keys.fieldTaskId]: '태스크 ID',
	[keys.fieldInput]: '입력',
	[keys.fieldOutput]: '출력',
	[keys.fieldError]: '오류',
	[keys.fieldId]: 'ID',
	[keys.fieldStarted]: '시작 일시',
	[keys.fieldLeaseExpires]: '리스 만료 일시',
	[keys.fieldScheduledFor]: '예약 일시',

	[keys.outcome]: '결과',
	[keys.noAttempts]: '아직 기록된 시도가 없습니다.',
	[keys.copy]: '복사',
	[keys.copied]: '복사됨',
	[keys.jobSingular]: '작업',
	[keys.jobPlural]: '작업',
	[keys.errorWorkflowTaskExclusive]:
		'작업은 워크플로 또는 태스크 중 하나만 실행하며, 둘 다 실행할 수는 없습니다.',
	[keys.cronBadge]: 'Cron',
	[keys.attemptsTooltip]: '재시도를 포함한 이 작업의 실행 시도',
	[keys.inlineStep]: '인라인: {{id}}',
}
