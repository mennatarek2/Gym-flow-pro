export type PlatformRole = 'platform_support' | 'platform_ops' | 'platform_admin'

export interface PlatformAdminDto {
  id: string
  email: string
  fullName: string
  role: PlatformRole | string
  mfaEnabled: boolean
}

export interface PlatformLoginRequest {
  email: string
  password: string
  mfaCode?: string
}

export interface PlatformLoginResult {
  success: boolean
  errorCode?: string | null
  errorMessage?: string | null
  accessToken?: string | null
  expiresInSeconds: number
  mfaSetupRequired: boolean
  setupToken?: string | null
  otpAuthUri?: string | null
  mfaManualKey?: string | null
  user?: PlatformAdminDto | null
}

export interface PlatformMfaSetupRequest {
  setupToken: string
  mfaCode: string
}

export interface PlatformPagedResult<T> {
  items: T[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  hasNext: boolean
  hasPrevious: boolean
}

export type RiskBand = 'healthy' | 'watch' | 'at_risk' | 'critical' | (string & {})

export interface PlatformTenantListItemDto {
  id: string
  name: string
  gymCode: string
  planTier?: string | null
  status?: string | null
  billingCycle?: string | null
  currentPeriodEnd?: string | null
  priceEgp?: number | null
  /** CP7 list seam — null until health scores are populated. */
  riskBand?: RiskBand | null
  healthScore?: number | null
  lastLoginAtUtc?: string | null
}

export interface SubscriptionStatusDto {
  id: string
  tenantId: string
  planTier: string
  status: string
  billingCycle: string
  priceEgp: number
  currentPeriodStart: string
  currentPeriodEnd: string
  trialEndsAtUtc?: string | null
  cancelAtPeriodEnd: boolean
  cancelledAtUtc?: string | null
  updatedAtUtc: string
  pendingDowngradeTier?: string | null
}

/** CP4 usage metric keys from platform.usage_counters. */
export type UsageMetricKey =
  | 'active_members'
  | 'whatsapp_messages'
  | 'staff_seats'
  | 'branches'
  | (string & {})

/** Flat row from GET /platform-api/tenants/{id} → usageCounters (live API shape). */
export interface UsageCounterDto {
  period: string // YYYY-MM
  metric: UsageMetricKey
  count: number
  cap: number | null
  overageBilledEgp: number | null
  updatedAtUtc: string
}

/**
 * View model for the Usage panel — derived client-side from usageCounters[].
 * Do not expect this nested shape on the wire.
 */
export interface TenantUsageView {
  period: string
  metrics: Array<{
    metric: UsageMetricKey
    count: number
    cap: number | null
    overageBilledEgp: number | null
  }>
  /** Newest counter UpdatedAtUtc — for snapshot "as of" label. */
  asOfUtc: string | null
}

export interface PlatformTenantDetailDto {
  id: string
  name: string
  nameAr: string
  gymCode: string
  city: string
  phoneNumber: string
  email: string
  isActive: boolean
  subscription?: SubscriptionStatusDto | null
  /** Current Cairo-month rollup rows (same period), empty if none rolled up yet. */
  usageCounters?: UsageCounterDto[]
  /** CP7 rules-based health — null when not yet computed for this tenant. */
  health?: TenantHealthScoreDto | null
  /** Active feature overrides (CP4/CP6) — includes from detail payload. */
  featureOverrides?: FeatureOverrideDto[]
  /** Active / recent price overrides (coupons). */
  priceOverrides?: PriceOverrideDto[]
  /** Recent platform_audit_log rows for this tenant (CP6). */
  recentAudit?: PlatformAuditLogDto[]
}

export interface PlatformAuditLogDto {
  id: string
  actorPlatformUserId: string
  actorName?: string | null
  action: string
  tenantId?: string | null
  beforeJson?: string | null
  afterJson?: string | null
  createdAtUtc: string
}

export interface ImpersonateRequest {
  reason: string
}

export interface ImpersonationResponse {
  accessToken: string
  expiresAtUtc: string
  tenantId: string
  gymCode: string
  impersonatedUserId: string
  impersonatedEmail: string
  refreshAllowed: boolean
}

export interface FeatureOverrideDto {
  id: string
  tenantId: string
  featureKey: string
  enabled: boolean
  reason: string
  grantedByPlatformUserId: string
  expiresAtUtc?: string | null
  createdAtUtc: string
}

export interface PriceOverrideDto {
  id: string
  tenantId: string
  discountType: string
  value: number
  expiresAtUtc: string
  reason: string
  grantedByPlatformUserId: string
  createdAtUtc: string
  isActive?: boolean
}

export interface ForceSuspendRequest {
  reason: string
}

export interface ForceReactivateRequest {
  reason: string
}

export interface ExtendTrialRequest {
  days: number
  reason: string
}

export interface CreateCouponRequest {
  discountType: 'percent' | 'fixed'
  value: number
  expiresAtUtc: string
  reason: string
}

export interface UpsertFeatureOverrideRequest {
  featureKey: string
  enabled: boolean
  reason: string
  expiresAtUtc?: string | null
}

export interface PlatformActionResult {
  success: boolean
  errorCode?: string | null
  errorMessage?: string | null
}

/**
 * Known feature keys for overrides.
 * Authoritative Phase A modules from backend FeatureKeys; plus planned Stage 2 keys
 * (upsert accepts any string key — list is for the select UX).
 */
export const KNOWN_FEATURE_KEYS = [
  'sales',
  'shifts',
  'trials',
  'refunds',
  'debtors',
  'imports',
  'digital_waivers',
  'presence_verification',
  'crm',
  'online_joining',
  'marketing_broadcasts',
  'retention_automation',
  'referrals',
  'eta_invoicing',
  'pt_booking',
] as const

export type KnownFeatureKey = (typeof KNOWN_FEATURE_KEYS)[number]

export type FactorImpact = 'positive' | 'negative' | 'neutral'

/** Wire shape from GET /tenants/{id}.health (camelCase JSON). */
export interface TenantHealthScoreDto {
  riskBand: RiskBand
  score: number
  /** rules_v1 JSON string — parse client-side into contributing factors. */
  contributingFactorsJson?: string | null
  /** Alias some responses may still emit. */
  breakdownJson?: string | null
  computedAtUtc: string
  updatedAtUtc?: string
  assignedPlatformUserId?: string | null
  confidence?: number | null
  summary?: string | null
}

/** One factor row after parsing contributingFactorsJson.signals. */
export interface HealthFactorView {
  factor: string
  label: string
  weight: number
  signalValue: string
  impact: FactorImpact
  available: boolean
  score: number | null
}

/**
 * View model for the Health panel — derived from health + JSON.
 * Do not expect the task's nested healthScore shape on the wire.
 */
export interface HealthScoreView {
  score: number
  riskBand: RiskBand
  computedAt: string
  summary: string | null
  confidence: number | null
  contributingFactors: HealthFactorView[]
}

export interface SubscriptionChangeDto {
  id: string
  tenantId: string
  subscriptionId: string
  changeType: string
  fromTier?: string | null
  toTier?: string | null
  effectiveAtUtc: string
  proratedAmountEgp?: number | null
  initiatedBy: string
  platformAdminUserId?: string | null
  reason?: string | null
  createdAtUtc: string
}

export interface PlatformInvoiceDto {
  id: string
  tenantId: string
  subscriptionId: string
  invoiceNumber: string
  periodStart: string
  periodEnd: string
  subtotal: number
  vatAmount: number
  total: number
  currency: string
  status: string
  dueDate: string
  paidAtUtc?: string | null
  paymentMethod?: string | null
  etaUuid?: string | null
  pdfUrl?: string | null
  createdAtUtc: string
}

export const AUTH_ENDPOINTS = {
  login: '/platform-api/auth/login',
  mfaSetup: '/platform-api/auth/mfa/setup',
} as const

export interface ProvisionTenantRequest {
  name: string
  nameAr?: string
  city: string
  address?: string
  phoneNumber: string
  email: string
  gymCode?: string
  timeZone?: string
  ownerFullName: string
  ownerEmail: string
  ownerPassword: string
  /** default growth */
  tier?: string
}

export interface ProvisionTenantResponse {
  tenantId: string
  gymCode: string
  ownerUserId: string
  ownerEmail: string
  trialStarted: boolean
  trialError?: string | null
}

export const TENANT_ENDPOINTS = {
  list: '/platform-api/tenants',
  provision: '/platform-api/tenants/provision',
  detail: (id: string) => `/platform-api/tenants/${id}`,
  changes: (id: string) => `/platform-api/tenants/${id}/subscription/changes`,
  invoices: (id: string) => `/platform-api/tenants/${id}/invoices`,
  forceSuspend: (id: string) => `/platform-api/tenants/${id}/force-suspend`,
  forceReactivate: (id: string) => `/platform-api/tenants/${id}/force-reactivate`,
  extendTrial: (id: string) => `/platform-api/tenants/${id}/extend-trial`,
  coupon: (id: string) => `/platform-api/tenants/${id}/coupon`,
  featureOverrides: (id: string) => `/platform-api/tenants/${id}/feature-overrides`,
  featureOverride: (id: string, overrideId: string) =>
    `/platform-api/tenants/${id}/feature-overrides/${overrideId}`,
  impersonate: (id: string) => `/platform-api/tenants/${id}/impersonate`,
} as const

export type RiskQueueOutcomeValue =
  | 'contacted'
  | 'retained'
  | 'churned'
  | 'no_answer'
  | 'watching'

export const RISK_QUEUE_OUTCOMES: RiskQueueOutcomeValue[] = [
  'contacted',
  'retained',
  'churned',
  'no_answer',
  'watching',
]

export const RISK_QUEUE_BANDS = ['healthy', 'watch', 'at_risk', 'critical'] as const

export interface RiskQueueOutcomeDto {
  id: string
  tenantId: string
  platformUserId: string
  outcome: string
  note?: string | null
  createdAtUtc: string
}

export interface RiskQueueItemDto {
  tenantId: string
  name: string
  gymCode: string
  planTier?: string | null
  subscriptionStatus?: string | null
  score: number
  riskBand: string
  computedAtUtc: string
  assignedPlatformUserId?: string | null
  assignedAtUtc?: string | null
  contributingFactorsJson?: string | null
  summary?: string | null
  recentOutcomes: RiskQueueOutcomeDto[]
}

export interface AssignRiskQueueRequest {
  assignedPlatformUserId?: string | null
}

export interface RecordRiskQueueOutcomeRequest {
  outcome: string
  note?: string
}

export const RISK_QUEUE_ENDPOINTS = {
  list: '/platform-api/risk-queue',
  assign: (tenantId: string) => `/platform-api/risk-queue/${tenantId}/assign`,
  outcome: (tenantId: string) => `/platform-api/risk-queue/${tenantId}/outcome`,
} as const

/** CP8 SaaS metrics — DateOnly fields arrive as yyyy-MM-dd strings. */
export interface MrrSnapshotDto {
  asOf: string
  mrrEgp: number
  arrEgp: number
  payingTenantCount: number
  computedAtUtc: string
  currency: string
}

export interface MrrMovementDto {
  from: string
  to: string
  startingMrrEgp: number
  newMrrEgp: number
  expansionMrrEgp: number
  contractionMrrEgp: number
  churnedMrrEgp: number
  endingMrrEgp: number
  endingMrrDirectEgp: number
  reconciles: boolean
  computedAtUtc: string
}

export interface CohortRetentionDto {
  cohortMonth: string
  signedUp: number
  retainedPaying: number
  retentionRate: number
}

export interface ChurnMetricsDto {
  from: string
  to: string
  grossChurnRate: number
  startingMrrEgp: number
  churnedMrrEgp: number
  startingPayingTenants: number
  churnedTenants: number
  cohorts: CohortRetentionDto[]
  computedAtUtc: string
}

export interface ConversionMetricsDto {
  from: string
  to: string
  trialsStarted: number
  convertedToPaid: number
  conversionRate: number
  computedAtUtc: string
}

export interface TierDistributionRowDto {
  planTier: string
  tenantCount: number
  mrrEgp: number
}

export interface TierDistributionDto {
  asOf: string
  tiers: TierDistributionRowDto[]
  totalMrrEgp: number
  totalPayingTenants: number
  computedAtUtc: string
}

export const METRICS_ENDPOINTS = {
  mrr: '/platform-api/metrics/mrr',
  movement: '/platform-api/metrics/movement',
  churn: '/platform-api/metrics/churn',
  conversion: '/platform-api/metrics/conversion',
  tierDistribution: '/platform-api/metrics/tier-distribution',
} as const
