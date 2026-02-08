/**
 * Settings Page - Account settings only
 * Note: User/member management is now handled in TenantSettingsPage for proper tenant separation
 */

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  updateUserDisplayName,
  getUserRecord,
} from "../lib/firebase";

export function SettingsPage() {
  const { user: currentUser, tenant, refreshUserRole } = useAuth();

  // Account settings state
  const [displayName, setDisplayName] = useState("");
  const [isUpdatingName, setIsUpdatingName] = useState(false);
  const [nameUpdateSuccess, setNameUpdateSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load display name from Firestore (saved name takes priority)
    const loadUserProfile = async () => {
      if (currentUser) {
        const userRecord = await getUserRecord(currentUser.uid);
        if (userRecord?.displayName) {
          setDisplayName(userRecord.displayName);
        } else if (currentUser.displayName) {
          setDisplayName(currentUser.displayName);
        }
      }
    };
    loadUserProfile();
  }, [currentUser]);

  const handleUpdateDisplayName = async () => {
    if (!currentUser || !displayName.trim()) return;

    setIsUpdatingName(true);
    setError(null);
    setNameUpdateSuccess(false);

    try {
      await updateUserDisplayName(currentUser.uid, displayName.trim());
      setNameUpdateSuccess(true);
      // Refresh user data
      await refreshUserRole();
      setTimeout(() => setNameUpdateSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to update display name:", err);
      setError("名前の更新に失敗しました");
    } finally {
      setIsUpdatingName(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">アカウント設定</h1>
        <p className="text-sm text-slate-500 mt-1">
          プロフィールと設定を管理
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* Profile Card */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="p-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">プロフィール</h2>
            <p className="text-sm text-slate-500 mt-1">
              あなたのアカウント情報
            </p>
          </div>

          <div className="p-4 space-y-4">
            {/* Current User Info */}
            <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg">
              {currentUser?.photoURL ? (
                <img
                  src={currentUser.photoURL}
                  alt={currentUser.displayName || "ユーザー"}
                  className="size-16 rounded-full border border-slate-200"
                />
              ) : (
                <div className="size-16 rounded-full bg-slate-200 flex items-center justify-center">
                  <span className="text-xl font-medium text-slate-600">
                    {displayName?.[0] || currentUser?.email?.[0] || "U"}
                  </span>
                </div>
              )}
              <div>
                <p className="text-sm text-slate-500">メールアドレス</p>
                <p className="text-sm font-medium text-slate-900">{currentUser?.email}</p>
              </div>
            </div>

            {/* Display Name Input */}
            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-slate-700 mb-1">
                表示名
              </label>
              <div className="flex gap-2">
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="あなたの名前"
                  className="input flex-1"
                  disabled={isUpdatingName}
                />
                <button
                  onClick={handleUpdateDisplayName}
                  disabled={isUpdatingName || !displayName.trim()}
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
              {nameUpdateSuccess && (
                <p className="mt-2 text-sm text-green-600">名前を更新しました</p>
              )}
            </div>
          </div>
        </div>

        {/* Tenant Info Card */}
        {tenant && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="p-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">組織情報</h2>
              <p className="text-sm text-slate-500 mt-1">
                現在所属している組織
              </p>
            </div>

            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                <div>
                  <p className="text-sm text-slate-500">組織名</p>
                  <p className="text-sm font-medium text-slate-900">{tenant.name}</p>
                </div>
                <Link
                  to="/tenant-settings"
                  className="btn btn-secondary text-sm"
                >
                  組織設定
                </Link>
              </div>
              <p className="text-xs text-slate-500">
                メンバー管理や組織の設定は「組織設定」ページで行えます
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
