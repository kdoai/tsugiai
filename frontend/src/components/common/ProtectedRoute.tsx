/**
 * Protected Route - Redirects to login if not authenticated
 * Redirects to onboarding if user needs tenant setup
 */

import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  skipTenantCheck?: boolean;
}

export function ProtectedRoute({
  children,
  requireAdmin = false,
  skipTenantCheck = false,
}: ProtectedRouteProps) {
  const {
    isAuthenticated,
    isLoading,
    isAdmin,
    needsTenantSetup,
    needsTenantSelection,
  } = useAuth();
  const location = useLocation();

  // Show loading while checking auth state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <div className="size-8 spinner" />
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // Redirect to tenant selection if user has multiple tenants but none selected
  if (!skipTenantCheck && needsTenantSelection) {
    return <Navigate to="/select-tenant" state={{ from: location.pathname }} replace />;
  }

  // Redirect to onboarding if user needs tenant setup (no tenants at all)
  if (!skipTenantCheck && needsTenantSetup) {
    return <Navigate to="/onboarding" state={{ from: location.pathname }} replace />;
  }

  // Check admin requirement
  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
