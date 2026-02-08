import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/common/Layout";
import { ProtectedRoute } from "./components/common/ProtectedRoute";
// LoginPage is kept as static import for fastest initial load
import { LoginPage } from "./pages/LoginPage";

// Lazy-loaded pages
const HandoverHomePage = lazy(() => import("./pages/HandoverHomePage").then(m => ({ default: m.HandoverHomePage })));
const TemplatesPage = lazy(() => import("./pages/TemplatesPage").then(m => ({ default: m.TemplatesPage })));
const TemplateBuilderPage = lazy(() => import("./pages/TemplateBuilderPage").then(m => ({ default: m.TemplateBuilderPage })));
const CheckoutStartPage = lazy(() => import("./pages/CheckoutStartPage").then(m => ({ default: m.CheckoutStartPage })));
const CheckoutFlowPage = lazy(() => import("./pages/checkout").then(m => ({ default: m.CheckoutFlowPage })));
const VoiceCheckoutPage = lazy(() => import("./pages/VoiceCheckoutPage").then(m => ({ default: m.VoiceCheckoutPage })));
const HandoverPage = lazy(() => import("./pages/HandoverPage").then(m => ({ default: m.HandoverPage })));
const HandoverListPage = lazy(() => import("./pages/HandoverListPage").then(m => ({ default: m.HandoverListPage })));
const InboxPage = lazy(() => import("./pages/InboxPage").then(m => ({ default: m.InboxPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then(m => ({ default: m.SettingsPage })));
const TenantOnboardingPage = lazy(() => import("./pages/TenantOnboardingPage").then(m => ({ default: m.TenantOnboardingPage })));
const TenantSelectPage = lazy(() => import("./pages/TenantSelectPage").then(m => ({ default: m.TenantSelectPage })));
const TenantSettingsPage = lazy(() => import("./pages/TenantSettingsPage").then(m => ({ default: m.TenantSettingsPage })));
const AuthVerifyPage = lazy(() => import("./pages/AuthVerifyPage").then(m => ({ default: m.AuthVerifyPage })));

function App() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>}>
    <Routes>
      {/* Login Page - Public */}
      <Route path="/login" element={<LoginPage />} />

      {/* Auth Verify - Magic Link callback (Public) */}
      <Route path="/auth/verify" element={<AuthVerifyPage />} />

      {/* Tenant Selection - For users with multiple tenants (Protected but no tenant check) */}
      <Route
        path="/select-tenant"
        element={
          <ProtectedRoute skipTenantCheck>
            <TenantSelectPage />
          </ProtectedRoute>
        }
      />

      {/* Tenant Onboarding - For users without a tenant (Protected but no tenant check) */}
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute skipTenantCheck>
            <TenantOnboardingPage />
          </ProtectedRoute>
        }
      />

      {/* Accept Invitation - Handle invite token in URL (Protected but no tenant check) */}
      <Route
        path="/invite/:token"
        element={
          <ProtectedRoute skipTenantCheck>
            <TenantOnboardingPage />
          </ProtectedRoute>
        }
      />

      {/* Voice checkout - full screen without layout (Protected) */}
      <Route
        path="checkout/:sessionId/voice"
        element={
          <ProtectedRoute>
            <VoiceCheckoutPage />
          </ProtectedRoute>
        }
      />

      {/* Main Layout - All Protected */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        {/* Home */}
        <Route index element={<HandoverHomePage />} />

        {/* Template Management */}
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="templates/new" element={<TemplateBuilderPage />} />
        <Route path="templates/:templateId/edit" element={<TemplateBuilderPage />} />

        {/* Checkout Flow */}
        <Route path="checkout" element={<CheckoutStartPage />} />
        <Route path="checkout/:sessionId" element={<CheckoutFlowPage />} />

        {/* Handover Notes */}
        <Route path="handovers" element={<HandoverListPage />} />
        <Route path="handover/:handoverId" element={<HandoverPage />} />

        {/* Inbox */}
        <Route path="inbox" element={<InboxPage />} />

        {/* Settings (Admin only - access control in SettingsPage) */}
        <Route path="settings" element={<SettingsPage />} />

        {/* Tenant Settings (Tenant admins only - access control in TenantSettingsPage) */}
        <Route path="tenant-settings" element={<TenantSettingsPage />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

export default App;
