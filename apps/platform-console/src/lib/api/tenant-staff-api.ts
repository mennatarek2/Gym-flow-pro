import { apiRequest } from './client'
import {
  TENANT_STAFF_ENDPOINTS,
  type ChangeTenantStaffRoleRequest,
  type CreateTenantStaffRequest,
  type DisableTenantStaffRequest,
  type ReactivateTenantStaffRequest,
  type TenantStaffDto,
} from './types'

/** PlatformSupportOrAbove. Reads are scoped to the tenant in the URL — backend enforces isolation. */
export function fetchTenantStaff(tenantId: string) {
  return apiRequest<TenantStaffDto[]>({
    method: 'GET',
    url: TENANT_STAFF_ENDPOINTS.list(tenantId),
  })
}

/** PlatformOpsOrAbove. Password is set directly for now (the existing AdminService contract) —
 * a future improvement would replace this with an owner-invitation flow. */
export function createTenantStaff(tenantId: string, body: CreateTenantStaffRequest) {
  return apiRequest<TenantStaffDto>({
    method: 'POST',
    url: TENANT_STAFF_ENDPOINTS.create(tenantId),
    data: body,
  })
}

/** PlatformOpsOrAbove. Reason is mandatory — written to the platform audit log. */
export function disableTenantStaff(tenantId: string, staffId: string, body: DisableTenantStaffRequest) {
  return apiRequest<TenantStaffDto>({
    method: 'POST',
    url: TENANT_STAFF_ENDPOINTS.disable(tenantId, staffId),
    data: body,
  })
}

export function reactivateTenantStaff(tenantId: string, staffId: string, body: ReactivateTenantStaffRequest) {
  return apiRequest<TenantStaffDto>({
    method: 'POST',
    url: TENANT_STAFF_ENDPOINTS.reactivate(tenantId, staffId),
    data: body,
  })
}

export function changeTenantStaffRole(tenantId: string, staffId: string, body: ChangeTenantStaffRoleRequest) {
  return apiRequest<TenantStaffDto>({
    method: 'PUT',
    url: TENANT_STAFF_ENDPOINTS.changeRole(tenantId, staffId),
    data: body,
  })
}
