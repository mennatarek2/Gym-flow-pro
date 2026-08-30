import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth, RequireGuest } from '@/components/RequireAuth'
import { LoginPage } from '@/features/auth/LoginPage'
import { MfaSetupPage } from '@/features/auth/MfaSetupPage'
import { MfaChallengePage } from '@/features/auth/MfaChallengePage'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { TenantsListPage } from '@/features/tenants/TenantsListPage'
import { TenantDetailPage } from '@/features/tenants/TenantDetailPage'
import { TrialsPage } from '@/features/trials/TrialsPage'
import { PlansPage } from '@/features/plans/PlansPage'
import { RiskQueuePage } from '@/features/risk-queue/RiskQueuePage'
import { MetricsPage } from '@/features/metrics/MetricsPage'
import { SubscriptionsPage } from '@/features/subscriptions/SubscriptionsPage'
import { UsagePage } from '@/features/usage/UsagePage'
import { AuditLogPage } from '@/features/audit/AuditLogPage'
import { PlatformUsersPage } from '@/features/platform-users/PlatformUsersPage'
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
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/tenants" element={<TenantsListPage />} />
        <Route path="/tenants/:id" element={<TenantDetailPage />} />
        <Route path="/trials" element={<TrialsPage />} />
        <Route path="/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/risk-queue" element={<RiskQueuePage />} />
        <Route path="/metrics" element={<MetricsPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/audit" element={<AuditLogPage />} />
        <Route path="/platform-users" element={<PlatformUsersPage />} />
      </Route>

      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  )
}
