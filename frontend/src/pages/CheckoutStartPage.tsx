/**
 * Checkout Start Page - Select template and start checkout session
 */

import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { clsx } from "clsx";
import { templateApi, checkoutApi } from "../services/handoverApi";
import { useAuth } from "../contexts/AuthContext";
import { getTenantMembers, getUserRecord, type TenantMember } from "../lib/firebase";
import type { ChecklistTemplate } from "../types/handover";

// ローカルストレージのキー（ユーザーIDを含む）
const FAVORITES_STORAGE_KEY_PREFIX = "checkout_favorite_templates_";

// お気に入りをローカルストレージから取得（ユーザー別）
function getFavorites(userId: string | undefined): string[] {
  if (!userId) return [];
  try {
    const stored = localStorage.getItem(FAVORITES_STORAGE_KEY_PREFIX + userId);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// お気に入りをローカルストレージに保存（ユーザー別）
function saveFavorites(userId: string | undefined, ids: string[]) {
  if (!userId) return;
  localStorage.setItem(FAVORITES_STORAGE_KEY_PREFIX + userId, JSON.stringify(ids));
}

export function CheckoutStartPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, tenantId } = useAuth();

  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [operatorName, setOperatorName] = useState("");
  const [nextOperatorId, setNextOperatorId] = useState<string>("");
  const [isStarting, setIsStarting] = useState(false);

  // お気に入り機能（ユーザー別）
  const [favorites, setFavorites] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"all" | "favorites">("all");

  // ユーザーが変わったらお気に入りを再読み込み
  useEffect(() => {
    if (user?.uid) {
      setFavorites(getFavorites(user.uid));
    } else {
      setFavorites([]);
    }
  }, [user?.uid]);

  // Set operator name from Firestore (saved name takes priority)
  useEffect(() => {
    const loadUserName = async () => {
      if (user) {
        const userRecord = await getUserRecord(user.uid);
        if (userRecord?.displayName) {
          setOperatorName(userRecord.displayName);
        } else if (user.displayName) {
          setOperatorName(user.displayName);
        }
      }
    };
    loadUserName();
  }, [user]);

  useEffect(() => {
    if (tenantId) {
      loadData();
    }
  }, [tenantId]);

  const loadData = async () => {
    if (!tenantId) return;

    setIsLoading(true);
    setError(null);

    try {
      const [{ templates: loadedTemplates }, loadedMembers] = await Promise.all([
        templateApi.list(),
        getTenantMembers(tenantId),
      ]);

      setTemplates(loadedTemplates);
      // Filter out current user and inactive members from the list
      const filteredMembers = loadedMembers.filter(
        (m) => m.userId !== user?.uid && m.status === "active"
      );
      setMembers(filteredMembers);

      // Use template from URL query parameter if provided, otherwise default to first
      const templateFromUrl = searchParams.get("template");
      if (templateFromUrl && loadedTemplates.some((t) => t.id === templateFromUrl)) {
        setSelectedTemplateId(templateFromUrl);
      } else if (loadedTemplates.length > 0) {
        setSelectedTemplateId(loadedTemplates[0].id);
      }
    } catch (err) {
      console.error("Failed to load data:", err);
      setError("データの読み込みに失敗しました");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartCheckout = async () => {
    if (!selectedTemplateId || !operatorName.trim()) {
      alert("テンプレートと担当者名を入力してください");
      return;
    }

    setIsStarting(true);

    // Get next operator name from selected member
    const nextOperator = members.find((m) => m.userId === nextOperatorId);
    const nextOperatorName = nextOperator?.displayName || "";

    try {
      const result = await checkoutApi.start({
        template_id: selectedTemplateId,
        operator_id: user?.uid || `user_${Date.now()}`,
        operator_name: operatorName,
        next_operator_id: nextOperatorId || undefined,
        next_operator_name: nextOperatorName,
      });

      // Navigate to checkout flow page
      navigate(`/checkout/${result.session_id}`);
    } catch (err) {
      console.error("Failed to start checkout:", err);
      alert("チェックアウトの開始に失敗しました");
    } finally {
      setIsStarting(false);
    }
  };

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  // お気に入り切り替え（ユーザー別に保存）
  const toggleFavorite = (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // ラジオボタンの選択を防ぐ
    if (!user?.uid) return;
    const newFavorites = favorites.includes(templateId)
      ? favorites.filter((id) => id !== templateId)
      : [...favorites, templateId];
    setFavorites(newFavorites);
    saveFavorites(user.uid, newFavorites);
  };

  // 表示するテンプレート（タブでフィルタ）
  const displayTemplates = activeTab === "favorites"
    ? templates.filter((t) => favorites.includes(t.id))
    : templates;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="size-8 spinner" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 text-balance">チェックアウト開始</h1>
          <p className="text-sm text-slate-500 mt-1 text-pretty">
            作業終了時の引継ぎ確認を行います
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* Template selection */}
        <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className="font-semibold text-slate-900 whitespace-nowrap text-sm sm:text-base">
              チェックリストを選択
            </h2>
            {/* タブ切り替え */}
            <div className="flex rounded-lg bg-slate-100 p-0.5 sm:p-1 flex-shrink-0">
              <button
                onClick={() => setActiveTab("all")}
                className={clsx(
                  "px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-md transition-colors whitespace-nowrap",
                  activeTab === "all"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                すべて
              </button>
              <button
                onClick={() => setActiveTab("favorites")}
                className={clsx(
                  "px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-md transition-colors flex items-center gap-0.5 sm:gap-1 whitespace-nowrap",
                  activeTab === "favorites"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                お気に入り
              </button>
            </div>
          </div>

          {templates.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-500 mb-4 text-pretty">
                チェックリストがありません
              </p>
              <button
                onClick={() => navigate("/templates/new")}
                className="btn btn-primary"
              >
                テンプレートを作成
              </button>
            </div>
          ) : displayTemplates.length === 0 ? (
            <div className="text-center py-8">
              <svg className="w-12 h-12 mx-auto text-slate-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
              <p className="text-slate-500 text-pretty">
                お気に入りのチェックリストがありません
              </p>
              <p className="text-sm text-slate-400 mt-1">
                ★をタップしてお気に入りに追加できます
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {displayTemplates.map((template) => (
                <label
                  key={template.id}
                  className={clsx(
                    "block p-4 border rounded-lg cursor-pointer transition-colors",
                    selectedTemplateId === template.id
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 hover:border-slate-300"
                  )}
                >
                  <div className="flex items-start">
                    <input
                      type="radio"
                      name="template"
                      value={template.id}
                      checked={selectedTemplateId === template.id}
                      onChange={() => setSelectedTemplateId(template.id)}
                      className="mt-1 mr-3"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-900">
                          {template.title}
                        </span>
                        {/* お気に入り星アイコン */}
                        <button
                          type="button"
                          onClick={(e) => toggleFavorite(template.id, e)}
                          className="p-1 -mr-1 rounded hover:bg-slate-100 transition-colors"
                          aria-label={favorites.includes(template.id) ? "お気に入りから削除" : "お気に入りに追加"}
                        >
                          <svg
                            className={clsx(
                              "w-5 h-5 transition-colors",
                              favorites.includes(template.id)
                                ? "text-amber-400 fill-current"
                                : "text-slate-300 hover:text-amber-300"
                            )}
                            fill={favorites.includes(template.id) ? "currentColor" : "none"}
                            viewBox="0 0 20 20"
                            stroke="currentColor"
                            strokeWidth={1.5}
                          >
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                        </button>
                      </div>
                      {template.description && (
                        <p className="text-sm text-slate-500 mt-1 text-pretty">
                          {template.description}
                        </p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-400 tabular-nums">
                        <span>{template.items.length}項目</span>
                        <span>約{Math.round(template.duration / 60)}分</span>
                      </div>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </section>

        {/* Template preview */}
        {selectedTemplate && (
          <section className="bg-white rounded-lg border border-slate-200 p-5">
            <h2 className="font-semibold text-slate-900 mb-4 text-balance">確認項目</h2>
            <div className="space-y-2">
              {selectedTemplate.items.map((item, index) => {
                const typeLabels: Record<string, { label: string; style: string }> = {
                  checkbox: { label: "チェック", style: "bg-blue-50 text-blue-700" },
                  numeric: { label: "数値", style: "bg-purple-50 text-purple-700" },
                  text: { label: "テキスト", style: "bg-slate-100 text-slate-600" },
                  selection: { label: "選択", style: "bg-green-50 text-green-700" },
                  photo: { label: "写真", style: "bg-amber-50 text-amber-700" },
                };
                const typeInfo = typeLabels[item.item_type] || { label: item.item_type, style: "bg-slate-100 text-slate-600" };

                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0"
                  >
                    <span className="text-slate-400 text-sm w-6 tabular-nums">{index + 1}</span>
                    <span className={clsx("px-2 py-0.5 text-xs rounded", typeInfo.style)}>
                      {typeInfo.label}
                    </span>
                    <span className="flex-1 text-slate-700 text-sm">{item.topic}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Operator info */}
        <section className="bg-white rounded-lg border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900 mb-4 text-balance">担当者情報</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                あなたの名前 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={operatorName}
                onChange={(e) => setOperatorName(e.target.value)}
                placeholder="山田 太郎"
                className="input"
                readOnly={!!user?.displayName}
              />
              {user?.displayName && (
                <p className="text-xs text-slate-500 mt-1">
                  ログインユーザーの名前が自動入力されています
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                次の担当者（任意）
              </label>
              <select
                value={nextOperatorId}
                onChange={(e) => setNextOperatorId(e.target.value)}
                className="input"
              >
                <option value="">選択しない</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName || m.email || "名前未設定"}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Start button */}
        <div className="flex justify-center pt-2">
          <button
            onClick={handleStartCheckout}
            disabled={!selectedTemplateId || !operatorName.trim() || isStarting}
            className="btn btn-primary px-8"
          >
            {isStarting ? "開始中..." : "チェックアウトを開始"}
          </button>
        </div>
      </div>
    </div>
  );
}
