/**
 * Tenant Onboarding Page - Create or join a tenant
 */

import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { clsx } from "clsx";
import { useAuth } from "../contexts/AuthContext";
import {
  createTenant,
  getInvitationByToken,
  acceptInvitation,
  type Invitation,
} from "../lib/firebase";

type OnboardingTab = "create" | "join";

export function TenantOnboardingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, tenant, needsTenantSetup, refreshUserRole, refreshUserTenants, signOut, isLoading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<OnboardingTab>("create");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create tenant form state
  const [tenantName, setTenantName] = useState("");

  // Join tenant form state
  const [inviteToken, setInviteToken] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [isLoadingInvitation, setIsLoadingInvitation] = useState(false);

  // Check for invite token in URL
  useEffect(() => {
    const token = searchParams.get("token");
    if (token) {
      setInviteToken(token);
      setActiveTab("join");
      loadInvitation(token);
    }
  }, [searchParams]);

  // Redirect if user already has a tenant
  useEffect(() => {
    if (!authLoading && tenant && !needsTenantSetup) {
      navigate("/", { replace: true });
    }
  }, [authLoading, tenant, needsTenantSetup, navigate]);

  const loadInvitation = async (token: string) => {
    setIsLoadingInvitation(true);
    setError(null);
    setInvitation(null);

    try {
      const result = await getInvitationByToken(token);
      if (result) {
        setInvitation(result);
      } else {
        setError("招待が見つからないか、有効期限が切れています");
      }
    } catch (err: any) {
      console.error("Failed to load invitation:", err);
      setError(err.message || "招待の読み込みに失敗しました");
    } finally {
      setIsLoadingInvitation(false);
    }
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantName.trim()) {
      setError("組織名を入力してください");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await createTenant(tenantName.trim());
      setSuccess("組織を作成しました");
      await refreshUserRole();       // 最新のuserRecordを取得→tenantId付きでテナント情報更新
      await refreshUserTenants();    // userTenantsリスト更新→needsTenantSetup=false
      // useEffectが自動的に"/"へ遷移
    } catch (err: any) {
      console.error("Failed to create tenant:", err);
      setError(err.message || "組織の作成に失敗しました");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAcceptInvitation = async () => {
    if (!inviteToken) {
      setError("招待トークンを入力してください");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await acceptInvitation(inviteToken);
      setSuccess("組織に参加しました");
      await refreshUserRole();       // 最新のuserRecordを取得→tenantId付きでテナント情報更新
      await refreshUserTenants();    // userTenantsリスト更新→needsTenantSetup=false
      // useEffectが自動的に"/"へ遷移
    } catch (err: any) {
      console.error("Failed to accept invitation:", err);
      setError(err.message || "招待の受諾に失敗しました");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTokenChange = (token: string) => {
    setInviteToken(token);
    setInvitation(null);
    setError(null);
  };

  const handleLookupInvitation = () => {
    if (inviteToken.trim()) {
      loadInvitation(inviteToken.trim());
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <div className="size-8 spinner" />
      </div>
    );
  }

  if (!user) {
    navigate("/login", { replace: true });
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
      <div className="w-full max-w-md">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center size-16 bg-primary-600 text-white rounded-2xl mb-4">
            <svg className="size-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[#202124]">組織の設定</h1>
          <p className="text-[#5f6368] mt-2">
            新しい組織を作成するか、招待を受けて参加してください
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl border border-[#dadce0] shadow-sm overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-[#dadce0]">
            <button
              onClick={() => { setActiveTab("create"); setError(null); setSuccess(null); }}
              className={clsx(
                "flex-1 py-3 text-sm font-medium transition-colors",
                activeTab === "create"
                  ? "text-primary-600 border-b-2 border-primary-600 bg-primary-50/50"
                  : "text-[#5f6368] hover:text-[#202124] hover:bg-[#f8f9fa]"
              )}
            >
              新規作成
            </button>
            <button
              onClick={() => { setActiveTab("join"); setError(null); setSuccess(null); }}
              className={clsx(
                "flex-1 py-3 text-sm font-medium transition-colors",
                activeTab === "join"
                  ? "text-primary-600 border-b-2 border-primary-600 bg-primary-50/50"
                  : "text-[#5f6368] hover:text-[#202124] hover:bg-[#f8f9fa]"
              )}
            >
              招待から参加
            </button>
          </div>

          <div className="p-6">
            {/* Error Message */}
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-[#d93025]">
                {error}
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                {success}
              </div>
            )}

            {activeTab === "create" ? (
              <>
                <h2 className="text-lg font-medium text-[#202124] text-center mb-6">
                  新しい組織を作成
                </h2>

                <form onSubmit={handleCreateTenant} className="space-y-4">
                  <div>
                    <label htmlFor="tenantName" className="block text-sm font-medium text-[#202124] mb-1">
                      組織名
                    </label>
                    <input
                      id="tenantName"
                      type="text"
                      value={tenantName}
                      onChange={(e) => setTenantName(e.target.value)}
                      placeholder="例: 株式会社サンプル"
                      className="input"
                      disabled={isSubmitting}
                    />
                    <p className="mt-1 text-xs text-[#5f6368]">
                      組織名は後から変更できます
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting || !tenantName.trim()}
                    className="w-full btn btn-primary py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="size-4 spinner border-white/30 border-t-white" />
                        作成中...
                      </span>
                    ) : (
                      "組織を作成"
                    )}
                  </button>
                </form>

                <div className="mt-4 p-3 bg-[#f8f9fa] rounded-lg">
                  <p className="text-xs text-[#5f6368]">
                    <strong>組織を作成すると:</strong>
                  </p>
                  <ul className="mt-2 text-xs text-[#5f6368] space-y-1">
                    <li>・ あなたが組織のオーナーになります</li>
                    <li>・ 他のメンバーを招待できます</li>
                    <li>・ テンプレートやデータを管理できます</li>
                  </ul>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-medium text-[#202124] text-center mb-6">
                  招待から組織に参加
                </h2>

                <div className="space-y-4">
                  <div>
                    <label htmlFor="inviteToken" className="block text-sm font-medium text-[#202124] mb-1">
                      招待トークン
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="inviteToken"
                        type="text"
                        value={inviteToken}
                        onChange={(e) => handleTokenChange(e.target.value)}
                        placeholder="招待トークンを入力"
                        className="input flex-1"
                        disabled={isSubmitting || isLoadingInvitation}
                      />
                      <button
                        type="button"
                        onClick={handleLookupInvitation}
                        disabled={isSubmitting || isLoadingInvitation || !inviteToken.trim()}
                        className="btn btn-secondary disabled:opacity-50"
                      >
                        {isLoadingInvitation ? (
                          <div className="size-4 spinner" />
                        ) : (
                          "確認"
                        )}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-[#5f6368]">
                      管理者から受け取った招待トークンを入力してください
                    </p>
                  </div>

                  {/* Invitation Details */}
                  {invitation && (
                    <div className="p-4 bg-[#f8f9fa] border border-[#dadce0] rounded-lg">
                      <h3 className="text-sm font-medium text-[#202124] mb-2">
                        招待の詳細
                      </h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-[#5f6368]">組織名:</span>
                          <span className="text-[#202124] font-medium">
                            {invitation.tenantName || invitation.tenantId}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#5f6368]">権限:</span>
                          <span className="text-[#202124]">
                            {invitation.role === "admin" ? "管理者" :
                             invitation.role === "user" ? "一般ユーザー" : "参照ユーザー"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#5f6368]">有効期限:</span>
                          <span className="text-[#202124]">
                            {new Date(invitation.expiresAt).toLocaleString("ja-JP")}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleAcceptInvitation}
                    disabled={isSubmitting || !invitation}
                    className="w-full btn btn-primary py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="size-4 spinner border-white/30 border-t-white" />
                        参加中...
                      </span>
                    ) : (
                      "組織に参加"
                    )}
                  </button>
                </div>

                <div className="mt-4 p-3 bg-[#f8f9fa] rounded-lg">
                  <p className="text-xs text-[#5f6368]">
                    <strong>招待トークンについて:</strong>
                  </p>
                  <ul className="mt-2 text-xs text-[#5f6368] space-y-1">
                    <li>・ 組織の管理者から招待トークンを受け取ります</li>
                    <li>・ トークンには有効期限があります</li>
                    <li>・ 参加後は指定された権限でアクセスできます</li>
                  </ul>
                </div>
              </>
            )}
          </div>
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
