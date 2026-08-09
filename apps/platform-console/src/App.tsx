import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth, RequireGuest } from '@/components/RequireAuth'
import { LoginPage } from '@/features/auth/LoginPage'
import { MfaSetupPage } from '@/features/auth/MfaSetupPage'
import { MfaChallengePage } from '@/features/auth/MfaChallengePage'
import { TenantsListPage } from '@/features/tenants/TenantsListPage'
import { TenantDetailPage } from '@/features/tenants/TenantDetailPage'
import { RiskQueuePage } from '@/features/risk-queue/RiskQueuePage'
import { MetricsPage } from '@/features/metrics/MetricsPage'
import { AppShell } from '@/layout/AppShell'

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RequireGuest>
            <LoginPage />
          </RequireGuest>
        }
      />
      <Route path="/mfa-setup" element={<MfaSetupPage />} />
      <Route path="/mfa-challenge" element={<MfaChallengePage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/tenants" element={<TenantsListPage />} />
        <Route path="/tenants/:id" element={<TenantDetailPage />} />
        <Route path="/risk-queue" element={<RiskQueuePage />} />
        <Route path="/metrics" element={<MetricsPage />} />
      </Route>

      <Route path="/" element={<Navigate to="/tenants" replace />} />
      <Route path="*" element={<Navigate to="/tenants" replace />} />
    </Routes>
  )
}
