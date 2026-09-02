import { keys, type TranslationKey } from './keys'

export const zh: Record<TranslationKey, string> = {
	[keys.pluginName]: '审计日志',
	// View header
	[keys.title]: '审计日志',
	[keys.entries]: '{{count}} 条记录',

	// Breadcrumb / step nav
	[keys.breadcrumb]: '审计日志',

	// Access messages (server-rendered)
	[keys.selectTenant]: '请选择租户以查看审计日志。',

	// Empty state
	[keys.noEntries]: '未找到审计日志记录。',

	// Pagination
	[keys.paginationInfo]: '{{from}}–{{to}}，共 {{total}} 条',

	// Debug bar
	[keys.debug]: '调试',
	[keys.queuing]: '正在排队…',
	[keys.runArchive]: '运行归档',
	[keys.runDelete]: '运行删除',

	// Filter bar
	[keys.filterCollection]: '集合',
	[keys.filterGlobal]: '全局',
	[keys.filterOperation]: '操作',
	[keys.filterTenant]: '租户',
	[keys.filterUser]: '用户',
	[keys.filterDocument]: '文档',
	[keys.filterEventType]: '事件类型',
	[keys.filterChangedPath]: '变更路径',
	[keys.filterGroup]: '分组',
	[keys.groupFilterBtn]: '按分组筛选',
	[keys.filterDate]: '日期',
	[keys.filterDateRange]: '日期范围',
	[keys.addFilter]: '+ 添加筛选',
	[keys.apply]: '应用',
	[keys.clearAll]: '清除全部',

	// Editors shared
	[keys.selectPlaceholder]: '— 请选择 —',
	[keys.done]: '完成',

	// Date range editor
	[keys.dateFrom]: '从',
	[keys.dateTo]: '至',
	[keys.startDate]: '开始日期…',
	[keys.endDate]: '结束日期…',

	// Single value editor
	[keys.groupPlaceholder]: '分组 ID…',
	[keys.orEnterId]: '或手动输入 ID',
	[keys.selectCollectionHint]: '选择集合筛选以启用搜索',
	[keys.documentIdPlaceholder]: '文档 ID…',
	[keys.update]: '更新',
	[keys.add]: '添加',
	[keys.selectEventPlaceholder]: '— 选择事件 —',
	[keys.eventTypePlaceholder]: '事件类型…',
	[keys.fieldPathPlaceholder]: '字段路径…',

	// User filter editor
	[keys.selectCollectionPlaceholder]: '选择集合…',
	[keys.userIdPlaceholder]: '用户 ID…',

	// Doc select
	[keys.searchPlaceholder]: '搜索…',

	// Log row
	[keys.metaIp]: 'IP',
	[keys.metaUa]: 'UA',
	[keys.metaLocale]: '语言',
	[keys.sectionSnapshot]: '快照',
	[keys.sectionAuthEvent]: '认证事件',
	[keys.sectionCustomEvent]: '自定义事件',
	[keys.viewGlobal]: '查看全局 →',
	[keys.viewDocument]: '查看文档 →',
	[keys.fieldsChanged]: '{{count}} 个字段',
	[keys.fieldsChangedPlural]: '{{count}} 个字段',

	// Diff viewer
	[keys.diffPath]: '路径',
	[keys.diffBefore]: '变更前',
	[keys.diffAfter]: '变更后',

	// Auth events
	[keys.authEventLogin]: '登录',
	[keys.authEventForgotPassword]: '忘记密码',
	[keys.authEventFailedLogin]: '登录失败',
}
