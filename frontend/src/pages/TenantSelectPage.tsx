/**
 * Tenant Selection Page - Choose which tenant to use after login
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { useAuth } from "../contexts/AuthContext";
import {
  getUserTenants,
  updateUserTenant,
  type TenantWithRole,
  type TenantRole,
} from "../lib/firebase";

const ROLE_LABELS: Record<TenantRole, string> = {
  owner: "オーナー",
  admin: "管理者",
  user: "一般ユーザー",
  viewer: "参照ユーザー",
};

const ROLE_COLORS: Record<TenantRole, string> = {
  owner: "bg-amber-100 text-amber-700 border-amber-200",
  admin: "bg-purple-100 text-purple-700 border-purple-200",
  user: "bg-green-100 text-green-700 border-green-200",
  viewer: "bg-blue-100 text-blue-700 border-blue-200",
};

export function TenantSelectPage() {
  const navigate = useNavigate();
  const { user, refreshTenantInfo, signOut, isLoading: authLoading } = useAuth();

  const [tenants, setTenants] = useState<TenantWithRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSelecting, setIsSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadTenants = async () => {
      if (!user) return;

      setIsLoading(true);
      setError(null);

      try {
        const userTenants = await getUserTenants(user.uid);
        setTenants(userTenants);

        // If user has no tenants, redirect to onboarding
        if (userTenants.length === 0) {
          navigate("/onboarding", { replace: true });
        }
      } catch (err) {
        console.error("Failed to load tenants:", err);
        setError("テナント情報の取得に失敗しました");
      } finally {
        setIsLoading(false);
      }
    };

    if (!authLoading && user) {
      loadTenants();
    }
  }, [user, authLoading, navigate]);

  const handleSelectTenant = async (tenantId: string) => {
    if (!user) return;

    setIsSelecting(tenantId);
    setError(null);

    try {
      // Update user's primary tenant
      await updateUserTenant(user.uid, tenantId);
      // Refresh auth context
      await refreshTenantInfo();
      // Navigate to home
      navigate("/", { replace: true });
    } catch (err) {
      console.error("Failed to select tenant:", err);
      setError("テナントの選択に失敗しました");
      setIsSelecting(null);
    }
  };

  const handleCreateNewTenant = () => {
    navigate("/onboarding");
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <div className="text-center">
          <div className="size-8 spinner mx-auto mb-4" />
          <p className="text-sm text-slate-500">テナント情報を読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    navigate("/login", { replace: true });
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
      <div className="w-full max-w-lg">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center size-16 bg-primary-600 text-white rounded-2xl mb-4">
            <svg className="size-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[#202124]">組織を選択</h1>
          <p className="text-[#5f6368] mt-2">
            使用する組織を選択してください
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Tenant List */}
        <div className="bg-white rounded-xl border border-[#dadce0] shadow-sm overflow-hidden">
          <div className="p-4 border-b border-[#dadce0] bg-slate-50">
            <p className="text-sm font-medium text-slate-700">
              所属している組織 ({tenants.length})
            </p>
          </div>

          {tenants.length === 0 ? (
            <div className="p-8 text-center">
              <svg className="size-12 text-slate-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <p className="text-sm text-slate-500">所属している組織がありません</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {tenants.map(({ tenant, role }) => {
                const isCurrentlySelecting = isSelecting === tenant.id;

                return (
                  <button
                    key={tenant.id}
                    onClick={() => handleSelectTenant(tenant.id)}
                    disabled={isSelecting !== null}
                    className={clsx(
                      "w-full p-4 flex items-center gap-4 text-left transition-colors",
                      "hover:bg-slate-50 focus:bg-slate-50 focus:outline-none",
                      isSelecting !== null && !isCurrentlySelecting && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {/* Tenant Icon */}
                    <div className="size-12 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                      <svg className="size-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </div>

                    {/* Tenant Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {tenant.name}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className={clsx(
                            "px-2 py-0.5 text-xs font-medium rounded-full border",
                            ROLE_COLORS[role]
                          )}
                        >
                          {ROLE_LABELS[role]}
                        </span>
                        <span className="text-xs text-slate-500">
                          {tenant.plan === "free" ? "無料プラン" :
                           tenant.plan === "starter" ? "スターター" :
                           tenant.plan === "professional" ? "プロ" :
                           tenant.plan === "enterprise" ? "エンタープライズ" : ""}
                        </span>
                      </div>
                    </div>

                    {/* Arrow / Loading */}
                    {isCurrentlySelecting ? (
                      <div className="size-5 spinner" />
                    ) : (
                      <svg className="size-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Create New Tenant Button */}
        <div className="mt-4">
          <button
            onClick={handleCreateNewTenant}
            disabled={isSelecting !== null}
            className={clsx(
              "w-full p-4 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300",
              "text-sm font-medium text-slate-600 transition-colors",
              "hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50",
              isSelecting !== null && "opacity-50 cursor-not-allowed"
            )}
          >
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            新しい組織を作成
          </button>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs text-[#9aa0a6] mb-3">
            ログイン中: {user.email}
          </p>
          <button
            onClick={() => signOut()}
            className="text-sm text-[#5f6368] hover:text-[#202124] underline"
          >
            ログアウト
          </button>
        </div>
      </div>
    </div>
  );
}
