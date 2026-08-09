import { apiRequest } from './client'
import {
  TENANT_ENDPOINTS,
  type CreateCouponRequest,
  type ExtendTrialRequest,
  type FeatureOverrideDto,
  type ForceReactivateRequest,
  type ForceSuspendRequest,
  type ImpersonateRequest,
  type ImpersonationResponse,
  type PlatformActionResult,
  type SubscriptionStatusDto,
  type UpsertFeatureOverrideRequest,
} from './types'

export function forceSuspendTenant(tenantId: string, body: ForceSuspendRequest) {
  return apiRequest<SubscriptionStatusDto>({
    method: 'POST',
    url: TENANT_ENDPOINTS.forceSuspend(tenantId),
    data: body,
  })
}

export function forceReactivateTenant(tenantId: string, body: ForceReactivateRequest) {
  return apiRequest<SubscriptionStatusDto>({
    method: 'POST',
    url: TENANT_ENDPOINTS.forceReactivate(tenantId),
    data: body,
  })
}

export function extendTrialTenant(tenantId: string, body: ExtendTrialRequest) {
  return apiRequest<SubscriptionStatusDto>({
    method: 'POST',
    url: TENANT_ENDPOINTS.extendTrial(tenantId),
    data: body,
  })
}

export function applyCoupon(tenantId: string, body: CreateCouponRequest) {
  return apiRequest<PlatformActionResult>({
    method: 'POST',
    url: TENANT_ENDPOINTS.coupon(tenantId),
    data: body,
  })
}

export function upsertFeatureOverride(tenantId: string, body: UpsertFeatureOverrideRequest) {
  return apiRequest<FeatureOverrideDto>({
    method: 'POST',
    url: TENANT_ENDPOINTS.featureOverrides(tenantId),
    data: body,
  })
}

export function deleteFeatureOverride(tenantId: string, overrideId: string) {
  return apiRequest<PlatformActionResult>({
    method: 'DELETE',
    url: TENANT_ENDPOINTS.featureOverride(tenantId, overrideId),
  })
}

export function impersonateTenant(tenantId: string, body: ImpersonateRequest) {
  return apiRequest<ImpersonationResponse>({
    method: 'POST',
    url: TENANT_ENDPOINTS.impersonate(tenantId),
    data: body,
  })
}
