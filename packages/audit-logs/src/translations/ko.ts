import { keys, type TranslationKey } from './keys'

export const ko: Record<TranslationKey, string> = {
	[keys.pluginName]: '감사 로그',
	// View header
	[keys.title]: '감사 로그',
	[keys.entries]: '항목 {{count}}개',

	// Breadcrumb / step nav
	[keys.breadcrumb]: '감사 로그',

	// Access messages (server-rendered)
	[keys.selectTenant]: '감사 로그를 보려면 테넌트를 선택하세요.',

	// Empty state
	[keys.noEntries]: '감사 로그 항목이 없습니다.',

	// Pagination
	[keys.paginationInfo]: '{{total}}개 중 {{from}}–{{to}}',

	// Debug bar
	[keys.debug]: '디버그',
	[keys.queuing]: '대기열에 추가하는 중…',
	[keys.runArchive]: '아카이브 실행',
	[keys.runDelete]: '삭제 실행',

	// Filter bar
	[keys.filterCollection]: '컬렉션',
	[keys.filterGlobal]: '글로벌',
	[keys.filterOperation]: '작업',
	[keys.filterTenant]: '테넌트',
	[keys.filterUser]: '사용자',
	[keys.filterDocument]: '문서',
	[keys.filterEventType]: '이벤트 유형',
	[keys.filterChangedPath]: '변경된 경로',
	[keys.filterGroup]: '그룹',
	[keys.groupFilterBtn]: '그룹으로 필터링',
	[keys.filterDate]: '날짜',
	[keys.filterDateRange]: '날짜 범위',
	[keys.addFilter]: '+ 필터 추가',
	[keys.apply]: '적용',
	[keys.clearAll]: '모두 지우기',

	// Editors shared
	[keys.selectPlaceholder]: '— 선택 —',
	[keys.done]: '완료',

	// Date range editor
	[keys.dateFrom]: '시작',
	[keys.dateTo]: '종료',
	[keys.startDate]: '시작 날짜…',
	[keys.endDate]: '종료 날짜…',

	// Single value editor
	[keys.groupPlaceholder]: '그룹 ID…',
	[keys.orEnterId]: '또는 ID를 직접 입력',
	[keys.selectCollectionHint]: '검색하려면 컬렉션 필터를 선택하세요',
	[keys.documentIdPlaceholder]: '문서 ID…',
	[keys.update]: '업데이트',
	[keys.add]: '추가',
	[keys.selectEventPlaceholder]: '— 이벤트 선택 —',
	[keys.eventTypePlaceholder]: '이벤트 유형…',
	[keys.fieldPathPlaceholder]: '필드 경로…',

	// User filter editor
	[keys.selectCollectionPlaceholder]: '컬렉션 선택…',
	[keys.userIdPlaceholder]: '사용자 ID…',

	// Doc select
	[keys.searchPlaceholder]: '검색…',

	// Log row
	[keys.metaIp]: 'IP',
	[keys.metaUa]: 'UA',
	[keys.metaLocale]: '언어',
	[keys.sectionSnapshot]: '스냅샷',
	[keys.sectionAuthEvent]: '인증 이벤트',
	[keys.sectionCustomEvent]: '사용자 정의 이벤트',
	[keys.viewGlobal]: '글로벌 보기 →',
	[keys.viewDocument]: '문서 보기 →',
	[keys.fieldsChanged]: '필드 {{count}}개',
	[keys.fieldsChangedPlural]: '필드 {{count}}개',

	// Diff viewer
	[keys.diffPath]: '경로',
	[keys.diffBefore]: '이전',
	[keys.diffAfter]: '이후',

	// Auth events
	[keys.authEventLogin]: '로그인',
	[keys.authEventForgotPassword]: '비밀번호 찾기',
	[keys.authEventFailedLogin]: '로그인 실패',
}
