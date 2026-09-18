import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('Phase 5 legacy redirects', () => {
  const app = readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8')

  it('redirects legacy customer detail to Operation Center Local Gym360', () => {
    expect(app).toContain('path="/customers/:id"')
    expect(app).toContain('RedirectToLocalGym')
    expect(app).toContain('`/oc/gyms/local/${id}`')
  })

  it('redirects Control Plane support and playbooks into Operation Center', () => {
    expect(app).toContain('path="/support" element={<Navigate to="/oc/support" replace />}')
    expect(app).toContain('path="/ops-playbooks" element={<Navigate to="/oc/support/playbooks" replace />}')
    expect(app).toContain('RedirectToOcPlaybook')
    expect(app).toContain('`/oc/support/playbooks/${id}`')
  })

  it('sends legacy sales and cloud list aliases to Operation Center', () => {
    expect(app).toContain('path="/sales" element={<Navigate to="/oc/sales" replace />}')
    expect(app).toContain('path="/tenants" element={<Navigate to="/oc/gyms?mode=cloud" replace />}')
    expect(app).toContain('path="/risk-queue" element={<Navigate to="/oc/support/risk" replace />}')
  })

  it('keeps Admin Control Plane gyms and settings editors live', () => {
    expect(app).toContain('path="/gyms" element={<GymsPage />}')
    expect(app).toContain('path="/settings/plans" element={<PlansPage />}')
    expect(app).toContain('path="/settings/users"')
  })

  it('keeps Cloud tenant Admin detail behind Support+ (no Sales bypass)', () => {
    expect(app).toContain('path="/tenants/:id"')
    expect(app).toContain('TenantDetailPage')
    expect(app).toContain('path="gyms/cloud/:id"')
    expect(app).toContain('OcRequireRole allow={isSupportOrAbove}')
  })

  it('uses LocalLicenseRedirect for legacy license detail URLs', () => {
    expect(app).toContain('path="/local-licenses/:id"')
    expect(app).toContain('LocalLicenseRedirect')
  })
})
