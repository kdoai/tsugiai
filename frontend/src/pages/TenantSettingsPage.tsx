/**
 * Tenant Settings Page - Manage tenant members and settings
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { useAuth } from "../contexts/AuthContext";
import {
  getTenantMembers,
  getTenantInvitations,
  inviteUser,
  cancelInvitation,
  updateTenantMemberRole,
  removeTenantMember,
  updateTenantName,
  type TenantMember,
  type TenantRole,
  type Invitation,
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

type TabType = "members" | "invitations" | "settings";

export function TenantSettingsPage() {
  const navigate = useNavigate();
  const {
    user: currentUser,
    tenant,
    tenantId,
    isTenantOwner,
    isTenantAdmin,
    needsTenantSetup,
    refreshTenantInfo,
    isLoading: authLoading,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<TabType>("members");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Members state
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  // Invitations state
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [cancellingInvitationId, setCancellingInvitationId] = useState<string | null>(null);
  const [showTokenInvitationId, setShowTokenInvitationId] = useState<string | null>(null);

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TenantRole>("user");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  // Settings state
  const [tenantName, setTenantName] = useState("");
  const [isUpdatingName, setIsUpdatingName] = useState(false);

  // Redirect if user needs tenant setup
  useEffect(() => {
    if (!authLoading && needsTenantSetup) {
      navigate("/onboarding", { replace: true });
    }
  }, [authLoading, needsTenantSetup, navigate]);

  // Load data on mount
  useEffect(() => {
    if (tenantId && !needsTenantSetup) {
      loadData();
    }
  }, [tenantId, needsTenantSetup]);

  // Set tenant name from context
  useEffect(() => {
    if (tenant) {
      setTenantName(tenant.name);
    }
  }, [tenant]);

  const loadData = async () => {
    if (!tenantId) return;

    setIsLoading(true);
    setError(null);

    try {
      const [membersData, invitationsData] = await Promise.all([
        getTenantMembers(tenantId),
        isTenantAdmin ? getTenantInvitations(tenantId) : Promise.resolve([]),
      ]);

      setMembers(membersData);
      setInvitations(invitationsData);
    } catch (err) {
      console.error("Failed to load data:", err);
      setError("データの読み込みに失敗しました");
    } finally {
      setIsLoading(false);
    }
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !tenantId) {
      setError("メールアドレスを入力してください");
      return;
    }

    setIsInviting(true);
    setError(null);
    setInviteToken(null);

    try {
      const result = await inviteUser(tenantId, inviteEmail.trim(), inviteRole);
      setInviteToken(result.token);
      setSuccess(`${inviteEmail} を招待しました`);
      setInviteEmail("");
      // Reload invitations
      const invitationsData = await getTenantInvitations(tenantId);
      setInvitations(invitationsData);
    } catch (err: any) {
      console.error("Failed to invite user:", err);
      setError(err.message || "招待に失敗しました");
    } finally {
      setIsInviting(false);
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    if (!tenantId) return;

    const confirmed = window.confirm("この招待をキャンセルしますか？");
    if (!confirmed) return;

    setCancellingInvitationId(invitationId);
    setError(null);

    try {
      await cancelInvitation(invitationId);
      setInvitations((prev) => prev.filter((i) => i.id !== invitationId));
      setSuccess("招待をキャンセルしました");
    } catch (err: any) {
      console.error("Failed to cancel invitation:", err);
      setError(err.message || "招待のキャンセルに失敗しました");
    } finally {
      setCancellingInvitationId(null);
    }
  };

  const handleRoleChange = async (userId: string, newRole: TenantRole) => {
    if (!tenantId) return;

    // Prevent changing owner role
    if (newRole === "owner") {
      setError("オーナー権限は直接変更できません");
      return;
    }

    // Confirm if changing own role
    if (userId === currentUser?.uid) {
      const confirmed = window.confirm(
        `自分自身の権限を「${ROLE_LABELS[newRole]}」に変更しますか？\n\n` +
        "注意: 権限を下げると、この設定ページにアクセスできなくなる可能性があります。"
      );
      if (!confirmed) return;
    }

    setUpdatingMemberId(userId);
    setError(null);

    try {
      await updateTenantMemberRole(tenantId, userId, newRole);
      setMembers((prev) =>
        prev.map((m) => (m.userId === userId ? { ...m, role: newRole } : m))
      );
      setSuccess("権限を更新しました");
      // Refresh if updating own role
      if (userId === currentUser?.uid) {
        await refreshTenantInfo();
      }
    } catch (err: any) {
      console.error("Failed to update role:", err);
      setError(err.message || "権限の更新に失敗しました");
    } finally {
      setUpdatingMemberId(null);
    }
  };

  const handleRemoveMember = async (member: TenantMember) => {
    if (!tenantId) return;

    if (member.role === "owner") {
      setError("オーナーは削除できません");
      return;
    }

    if (member.userId === currentUser?.uid) {
      setError("自分自身を削除することはできません");
      return;
    }

    const confirmed = window.confirm(
      `「${member.displayName || member.email}」を組織から削除しますか？`
    );
    if (!confirmed) return;

    setRemovingMemberId(member.userId);
    setError(null);

    try {
      await removeTenantMember(tenantId, member.userId);
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
      setSuccess("メンバーを削除しました");
    } catch (err: any) {
      console.error("Failed to remove member:", err);
      setError(err.message || "メンバーの削除に失敗しました");
    } finally {
      setRemovingMemberId(null);
    }
  };

  const handleUpdateTenantName = async () => {
    if (!tenantId || !tenantName.trim()) {
      setError("組織名を入力してください");
      return;
    }

    setIsUpdatingName(true);
    setError(null);

    try {
      await updateTenantName(tenantId, tenantName.trim());
      setSuccess("組織名を更新しました");
      await refreshTenantInfo();
    } catch (err: any) {
      console.error("Failed to update tenant name:", err);
      setError(err.message || "組織名の更新に失敗しました");
    } finally {
      setIsUpdatingName(false);
    }
  };

  const copyInviteToken = () => {
    if (inviteToken) {
      navigator.clipboard.writeText(inviteToken);
      setSuccess("トークンをコピーしました");
    }
  };

  const copyInviteUrl = () => {
    if (inviteToken) {
      const inviteUrl = `${window.location.origin}/onboarding?token=${inviteToken}`;
      navigator.clipboard.writeText(inviteUrl);
      setSuccess("招待URLをコピーしました");
    }
  };

  const copyInvitationUrl = (token: string) => {
    const inviteUrl = `${window.location.origin}/onboarding?token=${token}`;
    navigator.clipboard.writeText(inviteUrl);
    setSuccess("招待URLをコピーしました");
  };

  // Helper function to format Firestore Timestamp or date string
  const formatDate = (dateValue: any): string => {
    if (!dateValue) return "不明";
    try {
      // Handle Firestore Timestamp object
      if (dateValue && typeof dateValue.toDate === "function") {
        return dateValue.toDate().toLocaleString("ja-JP");
      }
      // Handle Firestore Timestamp as plain object with seconds
      if (dateValue && typeof dateValue.seconds === "number") {
        return new Date(dateValue.seconds * 1000).toLocaleString("ja-JP");
      }
      // Handle string or Date
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) return "不明";
      return date.toLocaleString("ja-JP");
    } catch {
      return "不明";
    }
  };

  // Helper function to check if date is expired
  const isDateExpired = (dateValue: any): boolean => {
    if (!dateValue) return false;
    try {
      let date: Date;
      if (dateValue && typeof dateValue.toDate === "function") {
        date = dateValue.toDate();
      } else if (dateValue && typeof dateValue.seconds === "number") {
        date = new Date(dateValue.seconds * 1000);
      } else {
        date = new Date(dateValue);
      }
      return date < new Date();
    } catch {
      return false;
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <div className="size-8 spinner" />
      </div>
    );
  }

  if (!currentUser || !tenantId) {
    return null;
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">組織設定</h1>
        <p className="text-sm text-slate-500 mt-1">
          {tenant?.name || "組織"} のメンバーと設定を管理
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 mb-6">
        <nav className="flex gap-4" aria-label="Tabs">
          <button
            onClick={() => { setActiveTab("members"); setError(null); setSuccess(null); }}
            className={clsx(
              "py-3 px-1 border-b-2 text-sm font-medium transition-colors",
              activeTab === "members"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
            )}
          >
            メンバー
          </button>
          {isTenantAdmin && (
            <button
              onClick={() => { setActiveTab("invitations"); setError(null); setSuccess(null); }}
              className={clsx(
                "py-3 px-1 border-b-2 text-sm font-medium transition-colors",
                activeTab === "invitations"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              )}
            >
              招待
              {invitations.length > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">
                  {invitations.length}
                </span>
              )}
            </button>
          )}
          {isTenantOwner && (
            <button
              onClick={() => { setActiveTab("settings"); setError(null); setSuccess(null); }}
              className={clsx(
                "py-3 px-1 border-b-2 text-sm font-medium transition-colors",
                activeTab === "settings"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              )}
            >
              組織設定
            </button>
          )}
        </nav>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          {success}
        </div>
      )}

      {/* Members Tab */}
      {activeTab === "members" && (
        <div className="space-y-6">
          {/* Member List Card */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">メンバー一覧</h2>
                <p className="text-sm text-slate-500 mt-1">
                  {members.length} 人のメンバー
                </p>
              </div>
              {isTenantAdmin && (
                <button
                  onClick={() => setActiveTab("invitations")}
                  className="btn btn-primary text-sm"
                >
                  <svg className="size-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  メンバーを招待
                </button>
              )}
            </div>

            {members.length === 0 ? (
              <div className="p-8 text-center">
                <svg className="size-12 text-slate-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <p className="text-sm text-slate-500">メンバーがいません</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {members.map((member) => {
                  const isCurrentUser = member.userId === currentUser?.uid;
                  const isOwner = member.role === "owner";
                  const isUpdating = updatingMemberId === member.userId;
                  const isRemoving = removingMemberId === member.userId;
                  const canEdit = isTenantAdmin && !isOwner;

                  return (
                    <div
                      key={member.userId}
                      className={clsx(
                        "p-4 flex items-center gap-4",
                        isCurrentUser && "bg-blue-50/50"
                      )}
                    >
                      {/* Avatar */}
                      <div className="size-10 rounded-full bg-slate-200 flex items-center justify-center">
                        <span className="text-sm font-medium text-slate-600">
                          {member.displayName?.[0] || member.email?.[0] || "U"}
                        </span>
                      </div>

                      {/* User Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-900 truncate">
                            {member.displayName || "名前未設定"}
                          </p>
                          {isCurrentUser && (
                            <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                              あなた
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 truncate">
                          {member.email}
                        </p>
                      </div>

                      {/* Role Badge */}
                      <span
                        className={clsx(
                          "px-2.5 py-1 text-xs font-medium rounded-full border",
                          ROLE_COLORS[member.role]
                        )}
                      >
                        {ROLE_LABELS[member.role]}
                      </span>

                      {/* Role Selector (for admins) */}
                      {canEdit && (
                        <div className="relative">
                          <select
                            value={member.role}
                            onChange={(e) => handleRoleChange(member.userId, e.target.value as TenantRole)}
                            disabled={isUpdating || isRemoving}
                            className={clsx(
                              "text-sm border border-slate-300 rounded-lg px-3 py-1.5 pr-8 bg-white appearance-none cursor-pointer",
                              "focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500",
                              (isUpdating || isRemoving) && "opacity-50 cursor-not-allowed"
                            )}
                          >
                            <option value="admin">管理者</option>
                            <option value="user">一般ユーザー</option>
                            <option value="viewer">参照ユーザー</option>
                          </select>
                          {isUpdating ? (
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 size-4 spinner" />
                          ) : (
                            <svg
                              className="absolute right-2 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                        </div>
                      )}

                      {/* Remove Button */}
                      {canEdit && !isCurrentUser && (
                        <button
                          onClick={() => handleRemoveMember(member)}
                          disabled={isRemoving || isUpdating}
                          className={clsx(
                            "p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors",
                            (isRemoving || isUpdating) && "opacity-50 cursor-not-allowed"
                          )}
                          title="メンバーを削除"
                        >
                          {isRemoving ? (
                            <div className="size-4 spinner border-red-300 border-t-red-600" />
                          ) : (
                            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Role Legend */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-slate-700 mb-3">権限の説明</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-3">
                <span className={clsx("px-2 py-0.5 rounded-full border text-xs font-medium shrink-0", ROLE_COLORS.owner)}>
                  オーナー
                </span>
                <span className="text-slate-600">
                  組織の所有者。すべての権限を持ち、組織を削除できます。
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className={clsx("px-2 py-0.5 rounded-full border text-xs font-medium shrink-0", ROLE_COLORS.admin)}>
                  管理者
                </span>
                <span className="text-slate-600">
                  メンバーの招待・管理、テンプレートの作成・編集ができます。
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className={clsx("px-2 py-0.5 rounded-full border text-xs font-medium shrink-0", ROLE_COLORS.user)}>
                  一般ユーザー
                </span>
                <span className="text-slate-600">
                  チェックアウト、引継ぎの作成・閲覧ができます。
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className={clsx("px-2 py-0.5 rounded-full border text-xs font-medium shrink-0", ROLE_COLORS.viewer)}>
                  参照ユーザー
                </span>
                <span className="text-slate-600">
                  閲覧のみ可能。作成・編集はできません。
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invitations Tab */}
      {activeTab === "invitations" && isTenantAdmin && (
        <div className="space-y-6">
          {/* Invite Form */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="p-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">メンバーを招待</h2>
              <p className="text-sm text-slate-500 mt-1">
                メールアドレスと権限を指定して招待トークンを発行します
              </p>
            </div>

            <div className="p-4">
              <form onSubmit={handleInviteUser} className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label htmlFor="inviteEmail" className="block text-sm font-medium text-slate-700 mb-1">
                      メールアドレス
                    </label>
                    <input
                      id="inviteEmail"
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="user@example.com"
                      className="input"
                      disabled={isInviting}
                    />
                  </div>
                  <div>
                    <label htmlFor="inviteRole" className="block text-sm font-medium text-slate-700 mb-1">
                      権限
                    </label>
                    <select
                      id="inviteRole"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as TenantRole)}
                      className="input"
                      disabled={isInviting}
                    >
                      <option value="admin">管理者</option>
                      <option value="user">一般ユーザー</option>
                      <option value="viewer">参照ユーザー</option>
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isInviting || !inviteEmail.trim()}
                  className="btn btn-primary disabled:opacity-50"
                >
                  {isInviting ? (
                    <span className="flex items-center gap-2">
                      <div className="size-4 spinner border-white/30 border-t-white" />
                      招待中...
                    </span>
                  ) : (
                    "招待トークンを発行"
                  )}
                </button>
              </form>

              {/* Generated Invite */}
              {inviteToken && (
                <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm font-medium text-green-800 mb-3">
                    招待を発行しました
                  </p>

                  {/* Invite URL */}
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-green-700 mb-1">招待URL</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 p-2 bg-white border border-green-300 rounded text-xs font-mono break-all">
                        {`${window.location.origin}/onboarding?token=${inviteToken}`}
                      </code>
                      <button
                        onClick={copyInviteUrl}
                        className="btn btn-primary text-sm shrink-0"
                      >
                        URLをコピー
                      </button>
                    </div>
                  </div>

                  {/* Invite Token */}
                  <div>
                    <label className="block text-xs font-medium text-green-700 mb-1">招待トークン</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 p-2 bg-white border border-green-300 rounded text-xs font-mono break-all">
                        {inviteToken}
                      </code>
                      <button
                        onClick={copyInviteToken}
                        className="btn btn-secondary text-sm shrink-0"
                      >
                        コピー
                      </button>
                    </div>
                  </div>

                  <p className="mt-3 text-xs text-green-700">
                    招待URLまたはトークンを招待したいユーザーに共有してください。有効期限は7日間です。
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Pending Invitations */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="p-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">保留中の招待</h2>
              <p className="text-sm text-slate-500 mt-1">
                まだ受諾されていない招待
              </p>
            </div>

            {invitations.length === 0 ? (
              <div className="p-8 text-center">
                <svg className="size-12 text-slate-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <p className="text-sm text-slate-500">保留中の招待はありません</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {invitations.map((invitation) => {
                  const isCancelling = cancellingInvitationId === invitation.id;
                  const isExpired = isDateExpired(invitation.expiresAt);
                  const isShowingToken = showTokenInvitationId === invitation.id;

                  return (
                    <div key={invitation.id} className="p-4">
                      <div className="flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">
                            {invitation.email}
                          </p>
                          <p className="text-xs text-slate-500">
                            有効期限: {formatDate(invitation.expiresAt)}
                          </p>
                        </div>

                        {/* Role Badge */}
                        <span
                          className={clsx(
                            "px-2.5 py-1 text-xs font-medium rounded-full border",
                            ROLE_COLORS[invitation.role]
                          )}
                        >
                          {ROLE_LABELS[invitation.role]}
                        </span>

                        {/* Status Badge */}
                        {isExpired ? (
                          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700 border border-red-200">
                            期限切れ
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-700 border border-yellow-200">
                            保留中
                          </span>
                        )}

                        {/* Show Token Button */}
                        <button
                          onClick={() => setShowTokenInvitationId(isShowingToken ? null : invitation.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          title={isShowingToken ? "トークンを隠す" : "トークンを表示"}
                        >
                          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            {isShowingToken ? (
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                            ) : (
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            )}
                          </svg>
                        </button>

                        {/* Cancel Button */}
                        <button
                          onClick={() => handleCancelInvitation(invitation.id)}
                          disabled={isCancelling}
                          className={clsx(
                            "p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors",
                            isCancelling && "opacity-50 cursor-not-allowed"
                          )}
                          title="招待をキャンセル"
                        >
                          {isCancelling ? (
                            <div className="size-4 spinner border-red-300 border-t-red-600" />
                          ) : (
                            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          )}
                        </button>
                      </div>

                      {/* Token Details (expandable) */}
                      {isShowingToken && (
                        <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                          <div className="mb-2">
                            <label className="block text-xs font-medium text-slate-600 mb-1">招待URL</label>
                            <div className="flex items-center gap-2">
                              <code className="flex-1 p-2 bg-white border border-slate-300 rounded text-xs font-mono break-all">
                                {`${window.location.origin}/onboarding?token=${invitation.token}`}
                              </code>
                              <button
                                onClick={() => copyInvitationUrl(invitation.token)}
                                className="btn btn-primary text-xs py-1.5 px-3 shrink-0"
                              >
                                コピー
                              </button>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">トークン</label>
                            <code className="block p-2 bg-white border border-slate-300 rounded text-xs font-mono break-all">
                              {invitation.token}
                            </code>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === "settings" && isTenantOwner && (
        <div className="space-y-6">
          {/* Tenant Info */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="p-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">組織情報</h2>
              <p className="text-sm text-slate-500 mt-1">
                組織の基本情報を編集
              </p>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label htmlFor="tenantName" className="block text-sm font-medium text-slate-700 mb-1">
                  組織名
                </label>
                <div className="flex gap-2">
                  <input
                    id="tenantName"
                    type="text"
                    value={tenantName}
                    onChange={(e) => setTenantName(e.target.value)}
                    placeholder="組織名"
                    className="input flex-1"
                    disabled={isUpdatingName}
                  />
                  <button
                    onClick={handleUpdateTenantName}
                    disabled={isUpdatingName || !tenantName.trim()}
                    className="btn btn-primary disabled:opacity-50"
                  >
                    {isUpdatingName ? (
                      <span className="flex items-center gap-2">
                        <div className="size-4 spinner border-white/30 border-t-white" />
                        保存中...
                      </span>
                    ) : (
                      "保存"
                    )}
                  </button>
                </div>
              </div>

              {/* Tenant ID (read-only) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  組織ID
                </label>
                <input
                  type="text"
                  value={tenantId}
                  readOnly
                  className="input bg-slate-50 text-slate-500"
                />
                <p className="mt-1 text-xs text-slate-500">
                  組織の一意な識別子です（変更不可）
                </p>
              </div>

              {/* Tenant Plan */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  プラン
                </label>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-100 text-blue-700 border border-blue-200">
                    {tenant?.plan === "free" ? "無料プラン" :
                     tenant?.plan === "starter" ? "スタータープラン" :
                     tenant?.plan === "professional" ? "プロフェッショナルプラン" :
                     tenant?.plan === "enterprise" ? "エンタープライズプラン" : "無料プラン"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="bg-white border border-red-200 rounded-xl shadow-sm">
            <div className="p-4 border-b border-red-200 bg-red-50">
              <h2 className="text-lg font-semibold text-red-900">危険な操作</h2>
              <p className="text-sm text-red-700 mt-1">
                以下の操作は取り消せません。十分注意してください。
              </p>
            </div>

            <div className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">組織を削除</p>
                  <p className="text-xs text-slate-500">
                    組織とすべてのデータが完全に削除されます
                  </p>
                </div>
                <button
                  className="btn text-sm bg-red-100 text-red-700 border-red-200 hover:bg-red-200"
                  onClick={() => alert("この機能は現在実装中です")}
                >
                  組織を削除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
