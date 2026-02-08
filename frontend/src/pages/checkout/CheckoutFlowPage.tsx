/**
 * Checkout Flow Page - Main orchestrator for the 4-phase checkout flow
 */

import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { checkoutApi, templateApi } from "../../services/handoverApi";
import type { CheckoutSession, ChecklistTemplate, CheckItem, ItemType, ActionItem } from "../../types/handover";
import { Phase1FormPage } from "./Phase1FormPage";
import { Phase2PhotoPage } from "./Phase2PhotoPage";
import { Phase3ConversationPage } from "./Phase3ConversationPage";
import { Phase4ReviewPage } from "./Phase4ReviewPage";

/**
 * Shuffle items with Fisher-Yates, respecting fixed_position pins.
 * fixed_position is 1-indexed. Items without fixed_position are randomized
 * and placed in the remaining slots.
 */
function shuffleWithFixedPositions(items: CheckItem[]): CheckItem[] {
  const result: (CheckItem | null)[] = new Array(items.length).fill(null);

  // Place fixed-position items first
  const randomItems: CheckItem[] = [];
  for (const item of items) {
    if (item.fixed_position != null && item.fixed_position >= 1 && item.fixed_position <= items.length) {
      result[item.fixed_position - 1] = item;
    } else {
      randomItems.push(item);
    }
  }

  // Fisher-Yates shuffle for non-fixed items
  for (let i = randomItems.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [randomItems[i], randomItems[j]] = [randomItems[j], randomItems[i]];
  }

  // Fill empty slots with shuffled items
  let ri = 0;
  for (let i = 0; i < result.length; i++) {
    if (result[i] === null) {
      result[i] = randomItems[ri++];
    }
  }

  return result as CheckItem[];
}

// Phase labels - Phase 2 will be conditionally shown based on photo items
const PHASE_LABELS_WITH_PHOTO = [
  { number: 1, label: "フォーム入力", description: "チェック・数値・テキスト・選択" },
  { number: 2, label: "写真撮影", description: "写真アップロード・AI判定" },
  { number: 3, label: "引継ぎ対話", description: "NG項目の確認" },
  { number: 4, label: "確認・完了", description: "サマリー編集・完了" },
];

const PHASE_LABELS_NO_PHOTO = [
  { number: 1, label: "フォーム入力", description: "チェック・数値・テキスト・選択" },
  { number: 2, label: "引継ぎ対話", description: "NG項目の確認" },
  { number: 3, label: "確認・完了", description: "サマリー編集・完了" },
];

export function CheckoutFlowPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [template, setTemplate] = useState<ChecklistTemplate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Operation states
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  // Load session and template
  useEffect(() => {
    if (!sessionId) return;

    const loadData = async () => {
      try {
        setIsLoading(true);
        const sessionData = await checkoutApi.get(sessionId);
        setSession(sessionData);

        const templateData = await templateApi.get(sessionData.template_id);
        setTemplate(templateData);
      } catch (err) {
        console.error("Failed to load session:", err);
        setError("セッションの読み込みに失敗しました");
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [sessionId]);

  // Compute display items (shuffled if randomize_order is enabled)
  const displayItems = useMemo(() => {
    if (!template || !sessionId) return [];
    if (!template.randomize_order) return template.items;

    // Check sessionStorage for a previously saved order
    const storageKey = `checkout_order_${sessionId}`;
    const savedOrder = sessionStorage.getItem(storageKey);

    if (savedOrder) {
      try {
        const itemIds: string[] = JSON.parse(savedOrder);
        const itemMap = new Map(template.items.map((item) => [item.id, item]));
        const ordered = itemIds.map((id) => itemMap.get(id)).filter(Boolean) as CheckItem[];
        // If template items changed (e.g., items added/removed), fall through to re-shuffle
        if (ordered.length === template.items.length) {
          return ordered;
        }
      } catch {
        // Invalid JSON, fall through to shuffle
      }
    }

    // Shuffle and save order
    const shuffled = shuffleWithFixedPositions(template.items);
    sessionStorage.setItem(storageKey, JSON.stringify(shuffled.map((item) => item.id)));
    return shuffled;
  }, [template, sessionId]);

  // Refresh session data
  const refreshSession = async () => {
    if (!sessionId) return;
    try {
      const sessionData = await checkoutApi.get(sessionId);
      setSession(sessionData);
    } catch (err) {
      console.error("Failed to refresh session:", err);
    }
  };

  // Phase 1 handlers
  const handlePhase1Save = async (
    responses: Array<{
      item_id: string;
      item_type: ItemType;
      checkbox_value?: boolean;
      numeric_value?: number;
      text_value?: string;
      selection_value?: string;
    }>
  ) => {
    if (!sessionId) return;
    setIsSaving(true);
    try {
      await checkoutApi.phase1Save(sessionId, responses);
      await refreshSession();
    } finally {
      setIsSaving(false);
    }
  };

  const handlePhase1Complete = async () => {
    if (!sessionId) return;
    setIsCompleting(true);
    try {
      await checkoutApi.phase1Complete(sessionId);
      await refreshSession();
    } catch (err) {
      if (err instanceof Error && 'status' in err && (err as any).status === 400) {
        setError(err.message || "未回答の必須項目があります");
      } else {
        console.error("Failed to complete phase 1:", err);
      }
    } finally {
      setIsCompleting(false);
    }
  };

  // Phase 2 handlers
  const handlePhase2Upload = async (itemId: string, file: File): Promise<string> => {
    if (!sessionId) throw new Error("No session");
    setIsUploading(true);
    try {
      const result = await checkoutApi.phase2Upload(sessionId, file, itemId);
      return result.storage_url;
    } finally {
      setIsUploading(false);
    }
  };

  const handlePhase2Verify = async (
    itemId: string
  ): Promise<{ result: string; message: string }> => {
    if (!sessionId) throw new Error("No session");
    setIsVerifying(true);
    try {
      const result = await checkoutApi.phase2Verify(sessionId, itemId);
      await refreshSession();
      return { result: result.result, message: result.message };
    } finally {
      setIsVerifying(false);
    }
  };

  const handlePhase2Complete = async () => {
    if (!sessionId) return;
    setIsCompleting(true);
    try {
      await checkoutApi.phase2Complete(sessionId);
      await refreshSession();
    } catch (err) {
      if (err instanceof Error && 'status' in err && (err as any).status === 400) {
        setError(err.message || "未アップロードの写真項目があります");
      } else {
        console.error("Failed to complete phase 2:", err);
      }
    } finally {
      setIsCompleting(false);
    }
  };

  // Phase 3 handler
  const handlePhase3Complete = async () => {
    if (!sessionId) return;
    setIsCompleting(true);
    try {
      await checkoutApi.phase3Complete(sessionId);
      await refreshSession();
    } finally {
      setIsCompleting(false);
    }
  };

  // Phase 4 handlers
  const handleUpdateSummary = async (markdown: string) => {
    if (!sessionId) return;
    setIsSaving(true);
    try {
      await checkoutApi.updateSummary(sessionId, markdown);
      await refreshSession();
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateActionItems = async (items: ActionItem[]) => {
    if (!sessionId) return;
    setIsSaving(true);
    try {
      await checkoutApi.updateActionItems(sessionId, items);
      await refreshSession();
    } finally {
      setIsSaving(false);
    }
  };

  const handleComplete = async () => {
    if (!sessionId) return;
    setIsCompleting(true);
    try {
      const result = await checkoutApi.completeSession(sessionId);
      navigate(`/handover/${result.handover.id}`);
    } catch (err) {
      console.error("Failed to complete:", err);
      setError("完了処理に失敗しました");
    } finally {
      setIsCompleting(false);
    }
  };

  // Restart handler
  const handleRestart = async () => {
    if (!sessionId) return;
    if (!confirm("最初からやり直しますか？入力した内容は全て消去されます。")) return;

    try {
      // Clear saved shuffle order so items get re-shuffled on restart
      sessionStorage.removeItem(`checkout_order_${sessionId}`);
      await checkoutApi.restartSession(sessionId);
      await refreshSession();
    } catch (err) {
      console.error("Failed to restart:", err);
      setError("やり直しに失敗しました");
    }
  };

  // Back handler (go to previous phase)
  const handleBack = async () => {
    if (!session || !sessionId) return;
    try {
      const result = await checkoutApi.goBack(sessionId);
      if (result.success) {
        await refreshSession();
      } else {
        setError(result.message || "前のフェーズに戻れません");
      }
    } catch (err) {
      console.error("Failed to go back:", err);
      setError("前のフェーズに戻れませんでした");
    }
  };

  // Go back to Phase 1 from Phase 3 (used when AI suggests redoing checks)
  const handleGoToPhase1 = async () => {
    if (!session || !sessionId) return;
    try {
      // Go back from Phase 3 to Phase 2 or Phase 1
      let result = await checkoutApi.goBack(sessionId);
      // If we landed on Phase 2 (has photo items), go back one more step
      if (result.success && result.previous_phase === 2) {
        await checkoutApi.goBack(sessionId);
      }
      await refreshSession();
    } catch (err) {
      console.error("Failed to go to phase 1:", err);
    }
  };

  // Determine current phase from session status
  const getCurrentPhase = (): number => {
    if (!session) return 1;

    switch (session.status) {
      case "draft":
      case "phase1":
        return 1;
      case "phase2":
        return 2;
      case "phase3":
        return 3;
      case "pending_review":
        return 4;
      case "completed":
        return 4;
      default:
        return session.current_phase || 1;
    }
  };

  const currentPhase = getCurrentPhase();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="size-8 spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="card p-6 text-center">
          <svg
            className="size-12 mx-auto mb-3 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <p className="text-[#d93025] mb-4">{error}</p>
          <button onClick={() => navigate("/checkout")} className="btn btn-primary">
            チェックアウト開始に戻る
          </button>
        </div>
      </div>
    );
  }

  if (!session || !template) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="card p-6 text-center">
          <p className="text-[#5f6368]">セッションが見つかりません</p>
          <button onClick={() => navigate("/checkout")} className="btn btn-primary mt-4">
            チェックアウト開始に戻る
          </button>
        </div>
      </div>
    );
  }

  // Check if there are photo items in the template
  const hasPhotoItems = template.items.some((item) => item.item_type === "photo");
  const phaseLabels = hasPhotoItems ? PHASE_LABELS_WITH_PHOTO : PHASE_LABELS_NO_PHOTO;

  // Map backend phase to display phase (when no photo items, skip phase 2)
  const getDisplayPhase = (backendPhase: number): number => {
    if (hasPhotoItems) return backendPhase;
    // No photo items: phase 1 -> 1, phase 2 (skipped), phase 3 -> 2, phase 4 -> 3
    if (backendPhase === 1) return 1;
    if (backendPhase === 3) return 2;
    if (backendPhase === 4) return 3;
    return backendPhase;
  };

  const displayPhase = getDisplayPhase(currentPhase);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-4 sm:mb-6 pb-3 sm:pb-4 border-b border-[#dadce0]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-base sm:text-xl font-semibold text-[#202124] truncate">{template.title}</h1>
            <p className="text-xs sm:text-sm text-[#5f6368] mt-0.5 sm:mt-1 truncate">
              {session.operator_name} → {session.next_operator_name || "（参照）"}
            </p>
          </div>
          <button
            onClick={() => navigate("/")}
            className="text-xs sm:text-sm text-[#5f6368] hover:text-[#202124] flex items-center gap-1 flex-shrink-0"
          >
            <svg className="size-3.5 sm:size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            ホーム
          </button>
        </div>
      </div>

      {/* Phase indicator */}
      <div className="mb-4 sm:mb-6 py-2 sm:py-0">
        <div className="flex items-center justify-center gap-0">
          {phaseLabels.map((phase, index) => {
            const isActive = displayPhase === phase.number;
            const isCompleted = displayPhase > phase.number;
            const isLast = index === phaseLabels.length - 1;

            return (
              <div key={phase.number} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={clsx(
                      "size-6 sm:size-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-medium transition-colors",
                      isActive && "bg-primary-600 text-white",
                      isCompleted && "bg-green-500 text-white",
                      !isActive && !isCompleted && "bg-[#e8eaed] text-[#5f6368]"
                    )}
                  >
                    {isCompleted ? (
                      <svg className="size-3 sm:size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      phase.number
                    )}
                  </div>
                  <span
                    className={clsx(
                      "text-[10px] sm:text-xs mt-1 text-center whitespace-nowrap",
                      isActive ? "text-primary-600 font-medium" : "text-[#5f6368]"
                    )}
                  >
                    {phase.label}
                  </span>
                </div>
                {!isLast && (
                  <div
                    className={clsx(
                      "w-8 sm:w-12 h-0.5 mx-1 sm:mx-2",
                      isCompleted ? "bg-green-500" : "bg-[#e8eaed]"
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Phase content - always uses backend phase numbers */}
      <div className="card p-6">
        {currentPhase === 1 && (
          <Phase1FormPage
            items={displayItems}
            initialResponses={session.item_responses.map((r) => ({
              item_id: r.item_id,
              item_type: r.item_type,
              checkbox_value: r.checkbox_value,
              numeric_value: r.numeric_value,
              text_value: r.text_value,
              selection_value: r.selection_value,
            }))}
            onSave={handlePhase1Save}
            onComplete={handlePhase1Complete}
            onRestart={handleRestart}
            isSaving={isSaving}
            isCompleting={isCompleting}
          />
        )}

        {currentPhase === 2 && hasPhotoItems && (
          <Phase2PhotoPage
            items={displayItems}
            responses={session.item_responses}
            onUpload={handlePhase2Upload}
            onVerify={handlePhase2Verify}
            onComplete={handlePhase2Complete}
            onBack={handleBack}
            isUploading={isUploading}
            isVerifying={isVerifying}
            isCompleting={isCompleting}
          />
        )}

        {currentPhase === 3 && sessionId && (
          <Phase3ConversationPage
            sessionId={sessionId}
            session={session}
            items={displayItems}
            ngItemIds={session.ng_item_ids}
            onComplete={handlePhase3Complete}
            onBack={handleBack}
            onGoToPhase1={handleGoToPhase1}
            isCompleting={isCompleting}
          />
        )}

        {currentPhase === 4 && (
          <Phase4ReviewPage
            summaryMarkdown={session.summary_markdown}
            actionItems={session.action_items || []}
            onUpdateSummary={handleUpdateSummary}
            onUpdateActionItems={handleUpdateActionItems}
            onComplete={handleComplete}
            onBack={handleBack}
            isSaving={isSaving}
            isCompleting={isCompleting}
          />
        )}
      </div>
    </div>
  );
}
