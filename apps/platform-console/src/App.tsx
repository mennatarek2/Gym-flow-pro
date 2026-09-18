import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { RequireAuth, RequireGuest } from '@/components/RequireAuth'
import { RequireRole } from '@/components/RequireRole'
import { LoginPage } from '@/features/auth/LoginPage'
import { MfaSetupPage } from '@/features/auth/MfaSetupPage'
import { MfaChallengePage } from '@/features/auth/MfaChallengePage'
import { TenantDetailPage } from '@/features/tenants/TenantDetailPage'
import { MetricsPage } from '@/features/metrics/MetricsPage'
import { AuditLogPage } from '@/features/audit/AuditLogPage'
import { PlatformUsersPage } from '@/features/platform-users/PlatformUsersPage'
import { LocalLicensesPage } from '@/features/local-licenses/LocalLicensesPage'
import { CustomerOnboardPage } from '@/features/customers/CustomerOnboardPage'
import { CatalogProductsPage } from '@/features/customers/CatalogProductsPage'
import { GymsPage } from '@/features/gyms/GymsPage'
import { SettingsHubPage } from '@/features/settings/SettingsHubPage'
import { PlansPage } from '@/features/plans/PlansPage'
import { AppShell } from '@/layout/AppShell'
import { isAdmin, isOpsOrAbove, isSalesOrAbove, isSupportOrAbove } from '@/lib/platform-roles'
import { OcShell } from '@/features/operation-center/OcShell'
import { OcRequireRole } from '@/features/operation-center/OcRequireRole'
import { OverviewPage } from '@/features/operation-center/pages/OverviewPage'
import { GymsPage as OcGymsPage } from '@/features/operation-center/pages/GymsPage'
import { LocalGymDetailPage } from '@/features/operation-center/pages/LocalGymDetailPage'
import { UnlinkedLicensePage } from '@/features/operation-center/pages/UnlinkedLicensePage'
import { CloudGymDetailPage } from '@/features/operation-center/pages/CloudGymDetailPage'
import { LocalLicenseRedirect } from '@/features/operation-center/pages/LocalLicenseRedirect'
import { SalesPage } from '@/features/operation-center/pages/SalesPage'
import { FeedbackInboxPage, PlaybookDetailPage, PlaybooksPage, RiskPage, SupportPage } from '@/features/operation-center/pages/SupportPage'
import { TicketDetailPage } from '@/features/operation-center/pages/TicketDetailPage'
import {
  AdministratorsPage,
  AuditSettingsPage,
  CatalogSettingsPage,
  MetricsSettingsPage,
  PlansSettingsPage,
  SalesContractTermsPage,
  SettingsPage as OcSettingsPage,
} from '@/features/operation-center/pages/SettingsPage'
import { IssueLicensePage } from '@/features/operation-center/pages/IssueLicensePage'

function RedirectToLocalGym() {
  const { id = '' } = useParams()
  return <Navigate to={`/oc/gyms/local/${id}`} replace />
}

function RedirectToOcPlaybook() {
  const { id = '' } = useParams()
  return <Navigate to={`/oc/support/playbooks/${id}`} replace />
}

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
        path="/oc"
        element={
          <RequireAuth>
            <OcShell />
          </RequireAuth>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="gyms" element={<OcGymsPage />} />
        <Route path="gyms/local/:id" element={<LocalGymDetailPage />} />
        <Route path="gyms/licenses/:id" element={<UnlinkedLicensePage />} />
        <Route
          path="gyms/cloud/:id"
          element={
            <OcRequireRole allow={isSupportOrAbove}>
              <CloudGymDetailPage />
            </OcRequireRole>
          }
        />
        <Route
          path="sales"
          element={
            <OcRequireRole allow={isSalesOrAbove}>
              <SalesPage />
            </OcRequireRole>
          }
        />
        <Route
          path="sales/onboard"
          element={
            <OcRequireRole allow={isSalesOrAbove}>
              <CustomerOnboardPage />
            </OcRequireRole>
          }
        />
        <Route path="support" element={<SupportPage />} />
        <Route path="support/feedback" element={<FeedbackInboxPage />} />
        <Route
          path="support/risk"
          element={
            <OcRequireRole allow={isSupportOrAbove}>
              <RiskPage />
            </OcRequireRole>
          }
        />
        <Route path="support/playbooks" element={<PlaybooksPage />} />
        <Route path="support/playbooks/:id" element={<PlaybookDetailPage />} />
        <Route path="support/tickets/:id" element={<TicketDetailPage />} />
        <Route path="settings" element={<OcSettingsPage />} />
        <Route
          path="settings/users"
          element={
            <OcRequireRole allow={isAdmin}>
              <AdministratorsPage />
            </OcRequireRole>
          }
        />
        <Route path="settings/plans" element={<PlansSettingsPage />} />
        <Route path="settings/catalog" element={<CatalogSettingsPage />} />
        <Route
          path="settings/sales-contract-terms"
          element={
            <OcRequireRole allow={isAdmin}>
              <SalesContractTermsPage />
            </OcRequireRole>
          }
        />
        <Route path="settings/metrics" element={<MetricsSettingsPage />} />
        <Route
          path="settings/audit"
          element={
            <OcRequireRole allow={isSupportOrAbove}>
              <AuditSettingsPage />
            </OcRequireRole>
          }
        />
        <Route
          path="settings/licenses"
          element={
            <OcRequireRole allow={isOpsOrAbove}>
              <IssueLicensePage />
            </OcRequireRole>
          }
        />
      </Route>

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        {/* Admin Control Plane — deep tools intentionally kept live */}
        <Route path="/gyms" element={<GymsPage />} />
        <Route path="/settings" element={<SettingsHubPage />} />
        <Route
          path="/settings/users"
          element={
            <RequireRole allow={isAdmin}>
              <PlatformUsersPage />
            </RequireRole>
          }
        />
        <Route path="/settings/plans" element={<PlansPage />} />
        <Route path="/settings/catalog" element={<CatalogProductsPage />} />
        <Route path="/settings/metrics" element={<MetricsPage />} />
        <Route path="/settings/audit" element={<AuditLogPage />} />
        <Route path="/settings/licenses" element={<LocalLicensesPage />} />
        <Route
          path="/tenants/:id"
          element={
            <RequireRole allow={isSupportOrAbove}>
              <TenantDetailPage />
            </RequireRole>
          }
        />
      </Route>

      {/* Phase 5 compatibility redirects — outside AppShell to avoid flashing CP chrome */}
      <Route
        path="/customers/:id"
        element={
          <RequireAuth>
            <RedirectToLocalGym />
          </RequireAuth>
        }
      />
      <Route
        path="/local-licenses/:id"
        element={
          <RequireAuth>
            <LocalLicenseRedirect />
          </RequireAuth>
        }
      />
      <Route path="/sales/onboard" element={<Navigate to="/oc/sales/onboard" replace />} />
      <Route path="/support" element={<Navigate to="/oc/support" replace />} />
      <Route path="/support-tickets" element={<Navigate to="/oc/support" replace />} />
      <Route path="/ops-playbooks" element={<Navigate to="/oc/support/playbooks" replace />} />
      <Route
        path="/ops-playbooks/:id"
        element={
          <RequireAuth>
            <RedirectToOcPlaybook />
          </RequireAuth>
        }
      />
      <Route path="/overview" element={<Navigate to="/oc" replace />} />
      <Route path="/sales" element={<Navigate to="/oc/sales" replace />} />
      <Route path="/tenants" element={<Navigate to="/oc/gyms?mode=cloud" replace />} />
      <Route path="/trials" element={<Navigate to="/oc/gyms?mode=cloud&status=trialing" replace />} />
      <Route path="/subscriptions" element={<Navigate to="/oc/gyms?mode=cloud" replace />} />
      <Route path="/risk-queue" element={<Navigate to="/oc/support/risk" replace />} />
      <Route path="/metrics" element={<Navigate to="/settings/metrics" replace />} />
      <Route path="/usage" element={<Navigate to="/oc/gyms" replace />} />
      <Route path="/plans" element={<Navigate to="/settings/plans" replace />} />
      <Route path="/customers" element={<Navigate to="/oc/gyms" replace />} />
      <Route path="/customers/onboard" element={<Navigate to="/oc/sales/onboard" replace />} />
      <Route path="/contracts" element={<Navigate to="/oc/gyms" replace />} />
      <Route path="/payments" element={<Navigate to="/oc/gyms" replace />} />
      <Route path="/catalog-products" element={<Navigate to="/settings/catalog" replace />} />
      <Route path="/audit" element={<Navigate to="/settings/audit" replace />} />
      <Route path="/platform-users" element={<Navigate to="/settings/users" replace />} />
      <Route path="/local-licenses" element={<Navigate to="/oc/gyms?filter=unlinked" replace />} />

      <Route path="/" element={<Navigate to="/oc" replace />} />
      <Route path="*" element={<Navigate to="/oc" replace />} />
    </Routes>
  )
}
