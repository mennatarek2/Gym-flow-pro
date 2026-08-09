import { apiRequest } from './client'
import {
  TENANT_ENDPOINTS,
  type PlatformInvoiceDto,
  type PlatformPagedResult,
  type PlatformTenantDetailDto,
  type PlatformTenantListItemDto,
  type ProvisionTenantRequest,
  type ProvisionTenantResponse,
  type SubscriptionChangeDto,
} from './types'

export interface TenantListParams {
  status?: string
  tier?: string
  /** CSV of healthy|watch|at_risk|critical — same ParseCsv as status/tier on the API. */
  riskBand?: string
  search?: string
  page?: number
  pageSize?: number
}

export function fetchTenants(params: TenantListParams) {
  return apiRequest<PlatformPagedResult<PlatformTenantListItemDto>>({
    method: 'GET',
    url: TENANT_ENDPOINTS.list,
    params,
  })
}

export function fetchTenantDetail(id: string) {
  return apiRequest<PlatformTenantDetailDto>({
    method: 'GET',
    url: TENANT_ENDPOINTS.detail(id),
  })
}

export function fetchSubscriptionChanges(id: string) {
  return apiRequest<SubscriptionChangeDto[]>({
    method: 'GET',
    url: TENANT_ENDPOINTS.changes(id),
  })
}

export function fetchTenantInvoices(id: string) {
  return apiRequest<PlatformInvoiceDto[]>({
    method: 'GET',
    url: TENANT_ENDPOINTS.invoices(id),
  })
}

/** Ops+ only — creates Tenant + Owner + StartTrial. Never log `ownerPassword`. */
export function provisionTenant(body: ProvisionTenantRequest) {
  return apiRequest<ProvisionTenantResponse>({
    method: 'POST',
    url: TENANT_ENDPOINTS.provision,
    data: body,
  })
}
