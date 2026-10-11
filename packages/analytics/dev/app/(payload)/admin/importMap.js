import { AnalyticsStatField as AnalyticsStatField_e33bd2cebc5cb3736daaf4c0c56bb68c } from '@10x-media/analytics/rsc'
import { GoalSelectFieldServer as GoalSelectFieldServer_e33bd2cebc5cb3736daaf4c0c56bb68c } from '@10x-media/analytics/rsc'
import { AnalyticsPanelField as AnalyticsPanelField_e33bd2cebc5cb3736daaf4c0c56bb68c } from '@10x-media/analytics/rsc'
import { WatchTenantCollection as WatchTenantCollection_1d0591e3cf4f332c83a86da13a0de59a } from '@payloadcms/plugin-multi-tenant/client'
import { TenantField as TenantField_1d0591e3cf4f332c83a86da13a0de59a } from '@payloadcms/plugin-multi-tenant/client'
import { AssignTenantFieldTrigger as AssignTenantFieldTrigger_1d0591e3cf4f332c83a86da13a0de59a } from '@payloadcms/plugin-multi-tenant/client'
import { ProtectedCell as ProtectedCell_cf1583332d9c5fb967cd4249af29ce12 } from '@10x-media/fields/rsc'
import { ProtectedField as ProtectedField_02043ee4f38853ef8c4ef9fd50352514 } from '@10x-media/fields/client'
import { GoalAmountField as GoalAmountField_cf3604008f3ebbc369f9463262b1f9eb } from '@10x-media/analytics/client'
import { AnalyticsNavLink as AnalyticsNavLink_cf3604008f3ebbc369f9463262b1f9eb } from '@10x-media/analytics/client'
import { TenantSelector as TenantSelector_d6d5f193a167989e2ee7d14202901e62 } from '@payloadcms/plugin-multi-tenant/rsc'
import { MeasurementUnitsProvider as MeasurementUnitsProvider_02043ee4f38853ef8c4ef9fd50352514 } from '@10x-media/fields/client'
import { TenantSelectionProvider as TenantSelectionProvider_d6d5f193a167989e2ee7d14202901e62 } from '@payloadcms/plugin-multi-tenant/rsc'
import { AnalyticsView as AnalyticsView_e33bd2cebc5cb3736daaf4c0c56bb68c } from '@10x-media/analytics/rsc'
import { AnalyticsMetricWidget as AnalyticsMetricWidget_e33bd2cebc5cb3736daaf4c0c56bb68c } from '@10x-media/analytics/rsc'
import { MetricSelectFieldServer as MetricSelectFieldServer_e33bd2cebc5cb3736daaf4c0c56bb68c } from '@10x-media/analytics/rsc'
import { DateRangeField as DateRangeField_cf3604008f3ebbc369f9463262b1f9eb } from '@10x-media/analytics/client'
import { SourceSelectFieldServer as SourceSelectFieldServer_e33bd2cebc5cb3736daaf4c0c56bb68c } from '@10x-media/analytics/rsc'
import { FilterDimensionSelectFieldServer as FilterDimensionSelectFieldServer_e33bd2cebc5cb3736daaf4c0c56bb68c } from '@10x-media/analytics/rsc'
import { FilterOperatorSelectFieldServer as FilterOperatorSelectFieldServer_e33bd2cebc5cb3736daaf4c0c56bb68c } from '@10x-media/analytics/rsc'
import { FilterValueFieldServer as FilterValueFieldServer_e33bd2cebc5cb3736daaf4c0c56bb68c } from '@10x-media/analytics/rsc'
import { AnalyticsTrendWidget as AnalyticsTrendWidget_e33bd2cebc5cb3736daaf4c0c56bb68c } from '@10x-media/analytics/rsc'
import { AnalyticsRealtimeWidget as AnalyticsRealtimeWidget_e33bd2cebc5cb3736daaf4c0c56bb68c } from '@10x-media/analytics/rsc'
import { AnalyticsGoalsWidget as AnalyticsGoalsWidget_e33bd2cebc5cb3736daaf4c0c56bb68c } from '@10x-media/analytics/rsc'
import { AnalyticsBreakdownWidget as AnalyticsBreakdownWidget_e33bd2cebc5cb3736daaf4c0c56bb68c } from '@10x-media/analytics/rsc'
import { default as default_62b74c0843cd3eb8c149dc2e5fc98b22 } from '../../../components/DevCustomWidget'
import { CollectionCards as CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1 } from '@payloadcms/next/rsc'
import { GlobalViewRedirect as GlobalViewRedirect_d6d5f193a167989e2ee7d14202901e62 } from '@payloadcms/plugin-multi-tenant/rsc'
import { DevCountryFlag as DevCountryFlag_eb2cd8e944b8768378b521281b6353b8 } from '../../../components/DevCountryFlag'
import { DevAnalyticsView as DevAnalyticsView_ae6c2423c79731716b87c11da3ee43e6 } from '../../../components/DevAnalyticsView'

/** @type import('payload').ImportMap */
export const importMap = {
  "@10x-media/analytics/rsc#AnalyticsStatField": AnalyticsStatField_e33bd2cebc5cb3736daaf4c0c56bb68c,
  "@10x-media/analytics/rsc#GoalSelectFieldServer": GoalSelectFieldServer_e33bd2cebc5cb3736daaf4c0c56bb68c,
  "@10x-media/analytics/rsc#AnalyticsPanelField": AnalyticsPanelField_e33bd2cebc5cb3736daaf4c0c56bb68c,
  "@payloadcms/plugin-multi-tenant/client#WatchTenantCollection": WatchTenantCollection_1d0591e3cf4f332c83a86da13a0de59a,
  "@payloadcms/plugin-multi-tenant/client#TenantField": TenantField_1d0591e3cf4f332c83a86da13a0de59a,
  "@payloadcms/plugin-multi-tenant/client#AssignTenantFieldTrigger": AssignTenantFieldTrigger_1d0591e3cf4f332c83a86da13a0de59a,
  "@10x-media/fields/rsc#ProtectedCell": ProtectedCell_cf1583332d9c5fb967cd4249af29ce12,
  "@10x-media/fields/client#ProtectedField": ProtectedField_02043ee4f38853ef8c4ef9fd50352514,
  "@10x-media/analytics/client#GoalAmountField": GoalAmountField_cf3604008f3ebbc369f9463262b1f9eb,
  "@10x-media/analytics/client#AnalyticsNavLink": AnalyticsNavLink_cf3604008f3ebbc369f9463262b1f9eb,
  "@payloadcms/plugin-multi-tenant/rsc#TenantSelector": TenantSelector_d6d5f193a167989e2ee7d14202901e62,
  "@10x-media/fields/client#MeasurementUnitsProvider": MeasurementUnitsProvider_02043ee4f38853ef8c4ef9fd50352514,
  "@payloadcms/plugin-multi-tenant/rsc#TenantSelectionProvider": TenantSelectionProvider_d6d5f193a167989e2ee7d14202901e62,
  "@10x-media/analytics/rsc#AnalyticsView": AnalyticsView_e33bd2cebc5cb3736daaf4c0c56bb68c,
  "@10x-media/analytics/rsc#AnalyticsMetricWidget": AnalyticsMetricWidget_e33bd2cebc5cb3736daaf4c0c56bb68c,
  "@10x-media/analytics/rsc#MetricSelectFieldServer": MetricSelectFieldServer_e33bd2cebc5cb3736daaf4c0c56bb68c,
  "@10x-media/analytics/client#DateRangeField": DateRangeField_cf3604008f3ebbc369f9463262b1f9eb,
  "@10x-media/analytics/rsc#SourceSelectFieldServer": SourceSelectFieldServer_e33bd2cebc5cb3736daaf4c0c56bb68c,
  "@10x-media/analytics/rsc#FilterDimensionSelectFieldServer": FilterDimensionSelectFieldServer_e33bd2cebc5cb3736daaf4c0c56bb68c,
  "@10x-media/analytics/rsc#FilterOperatorSelectFieldServer": FilterOperatorSelectFieldServer_e33bd2cebc5cb3736daaf4c0c56bb68c,
  "@10x-media/analytics/rsc#FilterValueFieldServer": FilterValueFieldServer_e33bd2cebc5cb3736daaf4c0c56bb68c,
  "@10x-media/analytics/rsc#AnalyticsTrendWidget": AnalyticsTrendWidget_e33bd2cebc5cb3736daaf4c0c56bb68c,
  "@10x-media/analytics/rsc#AnalyticsRealtimeWidget": AnalyticsRealtimeWidget_e33bd2cebc5cb3736daaf4c0c56bb68c,
  "@10x-media/analytics/rsc#AnalyticsGoalsWidget": AnalyticsGoalsWidget_e33bd2cebc5cb3736daaf4c0c56bb68c,
  "@10x-media/analytics/rsc#AnalyticsBreakdownWidget": AnalyticsBreakdownWidget_e33bd2cebc5cb3736daaf4c0c56bb68c,
  "/components/DevCustomWidget#default": default_62b74c0843cd3eb8c149dc2e5fc98b22,
  "@payloadcms/next/rsc#CollectionCards": CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1,
  "@payloadcms/plugin-multi-tenant/rsc#GlobalViewRedirect": GlobalViewRedirect_d6d5f193a167989e2ee7d14202901e62,
  "/components/DevCountryFlag#DevCountryFlag": DevCountryFlag_eb2cd8e944b8768378b521281b6353b8,
  "/components/DevAnalyticsView#DevAnalyticsView": DevAnalyticsView_ae6c2423c79731716b87c11da3ee43e6
}
