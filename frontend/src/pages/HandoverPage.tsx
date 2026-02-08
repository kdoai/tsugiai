/**
 * Handover Note View Page - View and comment on handover notes
 */

import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { clsx } from "clsx";
import { handoverApi } from "../services/handoverApi";
import type { HandoverNote, Comment, ActionItem, ActionItemResponse, ItemType } from "../types/handover";

// Action item type labels
const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  checkbox: "チェック",
  numeric: "数値入力",
  text: "テキスト",
  selection: "選択式",
  photo: "写真",
};

export function HandoverPage() {
  const { handoverId } = useParams<{ handoverId: string }>();
  const navigate = useNavigate();

  const [handover, setHandover] = useState<HandoverNote | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Comment form
  const [commentContent, setCommentContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Action items state
  const [actionResponses, setActionResponses] = useState<Record<string, Partial<ActionItemResponse>>>({});
  const [isSavingAction, setIsSavingAction] = useState(false);

  // User info (would come from auth in production)
  const [userId] = useState("current_user");
  const [userName] = useState("現在のユーザー");

  useEffect(() => {
    if (handoverId) {
      loadHandover();
    }
  }, [handoverId]);

  const loadHandover = async () => {
    if (!handoverId) return;

    setIsLoading(true);
    setError(null);

    try {
      const [handoverData, commentsData] = await Promise.all([
        handoverApi.get(handoverId),
        handoverApi.getComments(handoverId),
      ]);

      setHandover(handoverData);
      setComments(commentsData.comments);
    } catch (err) {
      console.error("Failed to load handover:", err);
      setError("引継ぎ簿の読み込みに失敗しました");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!handoverId) return;

    try {
      await handoverApi.confirm(handoverId);
      setHandover((prev) =>
        prev ? { ...prev, is_confirmed: true, confirmed_at: new Date().toISOString() } : null
      );
    } catch (err) {
      console.error("Failed to confirm handover:", err);
      alert("確認に失敗しました");
    }
  };

  const handleDelete = async () => {
    if (!handoverId) return;
    if (!confirm("この引継ぎ簿を削除しますか？この操作は取り消せません。")) return;

    setIsDeleting(true);
    try {
      await handoverApi.delete(handoverId);
      navigate("/");
    } catch (err) {
      console.error("Failed to delete handover:", err);
      alert("削除に失敗しました");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!handoverId || !commentContent.trim()) return;

    setIsSubmitting(true);

    try {
      const result = await handoverApi.addComment(handoverId, {
        author_id: userId,
        author_name: userName,
        content: commentContent,
      });

      // Add to local state
      const newComment: Comment = {
        id: result.comment_id,
        handover_id: handoverId,
        author_id: userId,
        author_name: userName,
        content: commentContent,
        created_at: new Date().toISOString(),
        is_resolved: false,
      };

      setComments((prev) => [...prev, newComment]);
      setCommentContent("");
    } catch (err) {
      console.error("Failed to add comment:", err);
      alert("コメントの追加に失敗しました");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResolveComment = async (commentId: string) => {
    if (!handoverId) return;

    try {
      await handoverApi.resolveComment(handoverId, commentId);
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? { ...c, is_resolved: true } : c))
      );
    } catch (err) {
      console.error("Failed to resolve comment:", err);
    }
  };

  // Initialize action responses from handover data
  useEffect(() => {
    if (handover?.action_responses) {
      const responses: Record<string, Partial<ActionItemResponse>> = {};
      handover.action_responses.forEach((r) => {
        responses[r.action_id] = r;
      });
      setActionResponses(responses);
    }
  }, [handover?.action_responses]);

  // Update action response locally
  const handleActionResponseChange = (
    actionId: string,
    field: keyof ActionItemResponse,
    value: boolean | number | string | undefined
  ) => {
    setActionResponses((prev) => ({
      ...prev,
      [actionId]: {
        ...prev[actionId],
        action_id: actionId,
        [field]: value,
      },
    }));
  };

  // Save action response
  const handleSaveActionResponse = async (actionItem: ActionItem) => {
    if (!handoverId) return;

    const response = actionResponses[actionItem.id];
    if (!response) return;

    setIsSavingAction(true);
    try {
      await handoverApi.saveActionResponse(handoverId, {
        action_id: actionItem.id,
        item_type: actionItem.item_type,
        checkbox_value: response.checkbox_value,
        numeric_value: response.numeric_value,
        text_value: response.text_value,
        selection_value: response.selection_value,
        note: response.note,
        completed_by: userId,
        completed_by_name: userName,
      });

      // Update local handover state
      setHandover((prev) => {
        if (!prev) return null;
        const existingResponses = prev.action_responses || [];
        const existingIndex = existingResponses.findIndex((r) => r.action_id === actionItem.id);
        const newResponse: ActionItemResponse = {
          action_id: actionItem.id,
          item_type: actionItem.item_type,
          checkbox_value: response.checkbox_value,
          numeric_value: response.numeric_value,
          text_value: response.text_value,
          selection_value: response.selection_value,
          note: response.note,
          completed_at: new Date().toISOString(),
          completed_by: userId,
          completed_by_name: userName,
        };

        if (existingIndex >= 0) {
          existingResponses[existingIndex] = newResponse;
        } else {
          existingResponses.push(newResponse);
        }

        return { ...prev, action_responses: existingResponses };
      });
    } catch (err) {
      console.error("Failed to save action response:", err);
      alert("保存に失敗しました");
    } finally {
      setIsSavingAction(false);
    }
  };

  // Check if action is completed
  const isActionCompleted = (actionId: string): boolean => {
    return handover?.action_responses?.some(
      (r) => r.action_id === actionId && r.completed_at
    ) || false;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("ja-JP", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-dvh">
        <div className="size-8 spinner" />
      </div>
    );
  }

  if (error || !handover) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <div className="text-[#d93025] text-sm">{error || "引継ぎ簿が見つかりません"}</div>
        <button
          onClick={() => navigate("/")}
          className="btn btn-secondary"
        >
          ホームに戻る
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      {/* Header */}
      <div className="bg-white border-b border-[#dadce0] sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => navigate("/handovers")}
            aria-label="引継ぎ一覧に戻る"
            className="p-2 hover:bg-[#f1f3f4] rounded-full -ml-2"
          >
            <svg
              className="size-5 text-[#5f6368]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          <h1 className="text-base font-medium text-[#202124] text-balance">引継ぎ簿</h1>

          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="p-2 hover:bg-red-50 rounded-full text-red-500 hover:text-red-600"
            title="削除"
          >
            <svg
              className="size-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {/* Meta info */}
        <div className="card p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-xs text-[#5f6368]">担当者</span>
              <p className="font-medium text-[#202124]">{handover.operator_name}</p>
            </div>
            <div>
              <span className="text-xs text-[#5f6368]">次担当</span>
              <p className="font-medium text-[#202124]">
                {handover.next_operator_name || "未指定"}
              </p>
            </div>
            <div>
              <span className="text-xs text-[#5f6368]">作成日時</span>
              <p className="tabular-nums text-[#202124]">{formatDate(handover.created_at)}</p>
            </div>
            <div>
              <span className="text-xs text-[#5f6368]">ステータス</span>
              <p>
                <span
                  className={clsx(
                    "inline-flex px-2 py-0.5 rounded text-xs font-medium",
                    handover.is_confirmed
                      ? "bg-green-50 text-[#1e8e3e]"
                      : "bg-yellow-50 text-[#f9ab00]"
                  )}
                >
                  {handover.is_confirmed ? "確認済み" : "未確認"}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Main content - show summary_markdown directly */}
        <div className="card p-4">
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                h1: ({ children }) => (
                  <h1 className="text-xl font-bold text-[#202124] mb-4 pb-2 border-b border-[#dadce0]">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-lg font-semibold text-[#202124] mt-6 mb-3">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-base font-medium text-[#202124] mt-4 mb-2">{children}</h3>
                ),
                ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 my-2">{children}</ul>,
                li: ({ children }) => <li className="text-[#202124]">{children}</li>,
                strong: ({ children }) => (
                  <strong className="font-semibold text-[#202124]">{children}</strong>
                ),
                em: ({ children }) => <em className="text-[#5f6368] italic">{children}</em>,
                hr: () => <hr className="my-4 border-[#dadce0]" />,
                p: ({ children }) => <p className="text-[#202124] my-2">{children}</p>,
                details: ({ children }) => (
                  <details className="my-4 border border-[#dadce0] rounded-lg overflow-hidden">
                    {children}
                  </details>
                ),
                summary: ({ children }) => (
                  <summary className="px-4 py-3 bg-[#f8f9fa] cursor-pointer hover:bg-[#e8eaed] font-medium text-[#202124] select-none">
                    {children}
                  </summary>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto my-4">
                    <table className="min-w-full border-collapse border border-[#dadce0] text-sm">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-[#f8f9fa]">{children}</thead>
                ),
                th: ({ children }) => (
                  <th className="border border-[#dadce0] px-3 py-2 text-left font-medium text-[#202124]">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-[#dadce0] px-3 py-2 text-[#202124]">{children}</td>
                ),
              }}
            >
              {handover.summary_markdown || "*引継ぎ内容がありません*"}
            </ReactMarkdown>
          </div>
        </div>

        {/* Action Items Section */}
        {handover.action_items && handover.action_items.length > 0 && (
          <div className="card">
            <div className="p-4 border-b border-[#dadce0] bg-primary-50">
              <div className="flex items-center gap-2">
                <svg className="size-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                <h2 className="font-semibold text-[#202124]">アクションアイテム</h2>
                <span className="text-sm text-[#5f6368]">
                  （{handover.action_responses?.length || 0}/{handover.action_items.length} 完了）
                </span>
              </div>
              <p className="text-sm text-[#5f6368] mt-1">
                前任者から引き継がれたアクションです。確認・実行してチェックを付けてください。
              </p>
            </div>

            <div className="divide-y divide-[#dadce0]">
              {handover.action_items.map((action) => {
                const response = actionResponses[action.id] || {};
                const completed = isActionCompleted(action.id);

                return (
                  <div
                    key={action.id}
                    className={clsx(
                      "p-4",
                      completed && "bg-green-50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {completed && (
                            <svg className="size-5 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          <span className={clsx(
                            "font-medium",
                            completed ? "text-green-800" : "text-[#202124]"
                          )}>
                            {action.topic}
                          </span>
                          <span className="px-2 py-0.5 text-xs bg-[#e8f0fe] text-primary-700 rounded">
                            {ITEM_TYPE_LABELS[action.item_type]}
                          </span>
                        </div>
                        <p className="text-sm text-[#5f6368] mt-1">{action.description}</p>

                        {/* Conditional details */}
                        {(action.timing || action.condition || action.then_action) && (
                          <div className="mt-2 p-2 bg-[#f8f9fa] rounded text-sm space-y-1">
                            {action.timing && (
                              <div className="flex items-center gap-2">
                                <span className="text-[#5f6368]">タイミング:</span>
                                <span className="font-medium text-[#202124]">{action.timing}</span>
                              </div>
                            )}
                            {action.condition && (
                              <div className="flex items-center gap-2">
                                <span className="text-[#5f6368]">判断基準:</span>
                                <span className="font-medium text-[#202124]">{action.condition}</span>
                              </div>
                            )}
                            {action.then_action && (
                              <div className="flex items-center gap-2">
                                <span className="text-[#5f6368]">基準外の対応:</span>
                                <span className="font-medium text-amber-700">{action.then_action}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Evidence */}
                        {action.evidence && (
                          <div className="mt-2 text-xs text-[#5f6368] bg-[#f1f3f4] px-2 py-1 rounded">
                            根拠: {action.evidence}
                          </div>
                        )}

                        {/* Input form based on item type */}
                        {!completed && (
                          <div className="mt-3 space-y-3">
                            {action.item_type === "checkbox" && (
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={response.checkbox_value || false}
                                  onChange={(e) => handleActionResponseChange(action.id, "checkbox_value", e.target.checked)}
                                  className="rounded border-[#dadce0] text-primary-600 focus:ring-primary-500"
                                />
                                <span className="text-sm text-[#202124]">確認しました</span>
                              </label>
                            )}

                            {action.item_type === "numeric" && (
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  value={response.numeric_value ?? ""}
                                  onChange={(e) => handleActionResponseChange(action.id, "numeric_value", e.target.value ? parseFloat(e.target.value) : undefined)}
                                  className="input w-32"
                                  placeholder="数値を入力"
                                  step="any"
                                />
                                {action.numeric_validation?.unit && (
                                  <span className="text-sm text-[#5f6368]">{action.numeric_validation.unit}</span>
                                )}
                              </div>
                            )}

                            {action.item_type === "text" && (
                              <textarea
                                value={response.text_value || ""}
                                onChange={(e) => handleActionResponseChange(action.id, "text_value", e.target.value)}
                                className="input w-full text-sm"
                                rows={2}
                                placeholder="結果を入力..."
                              />
                            )}

                            {action.item_type === "selection" && action.selection_choices && (
                              <select
                                value={response.selection_value || ""}
                                onChange={(e) => handleActionResponseChange(action.id, "selection_value", e.target.value)}
                                className="input w-full"
                              >
                                <option value="">選択してください</option>
                                {action.selection_choices.map((choice) => (
                                  <option key={choice} value={choice}>{choice}</option>
                                ))}
                              </select>
                            )}

                            {/* Note field */}
                            <input
                              type="text"
                              value={response.note || ""}
                              onChange={(e) => handleActionResponseChange(action.id, "note", e.target.value)}
                              className="input w-full text-sm"
                              placeholder="補足コメント（任意）"
                            />

                            {/* Save button */}
                            <button
                              onClick={() => handleSaveActionResponse(action)}
                              disabled={isSavingAction}
                              className="btn btn-primary btn-sm"
                            >
                              {isSavingAction ? "保存中..." : "完了として保存"}
                            </button>
                          </div>
                        )}

                        {/* Completed info */}
                        {completed && (
                          <div className="mt-2 text-sm text-green-700">
                            <div className="flex items-center gap-2">
                              {response.checkbox_value !== undefined && (
                                <span>✓ 確認済み</span>
                              )}
                              {response.numeric_value !== undefined && (
                                <span>
                                  記録値: {response.numeric_value}
                                  {action.numeric_validation?.unit}
                                </span>
                              )}
                              {response.text_value && (
                                <span>回答: {response.text_value}</span>
                              )}
                              {response.selection_value && (
                                <span>選択: {response.selection_value}</span>
                              )}
                            </div>
                            {response.note && (
                              <p className="text-[#5f6368] mt-1">補足: {response.note}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Confirm button */}
        {!handover.is_confirmed && (
          <div className="flex justify-center">
            <button
              onClick={handleConfirm}
              className="btn bg-[#1e8e3e] text-white hover:bg-green-700"
            >
              確認完了
            </button>
          </div>
        )}

        {/* Comments section */}
        <div className="card p-4">
          <h2 className="text-sm font-medium text-[#202124] mb-3 text-balance">
            コメント <span className="tabular-nums text-[#5f6368]">({comments.length})</span>
          </h2>

          {/* Comment list */}
          <div className="space-y-3 mb-4">
            {comments.length === 0 ? (
              <p className="text-sm text-[#5f6368] text-pretty">コメントはまだありません</p>
            ) : (
              comments.map((comment) => (
                <div
                  key={comment.id}
                  className={clsx(
                    "p-3 rounded-lg",
                    comment.is_resolved ? "bg-[#f8f9fa]" : "bg-primary-50"
                  )}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1">
                    <div>
                      <span className="text-sm font-medium text-[#202124]">
                        {comment.author_name}
                      </span>
                      <span className="text-xs text-[#9aa0a6] ml-2 tabular-nums">
                        {formatDate(comment.created_at)}
                      </span>
                    </div>
                    {!comment.is_resolved && (
                      <button
                        onClick={() => handleResolveComment(comment.id)}
                        className="text-xs text-primary-600 hover:text-primary-700 shrink-0"
                      >
                        解決済みにする
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-[#5f6368] text-pretty">{comment.content}</p>
                  {comment.is_resolved && (
                    <span className="inline-block mt-2 px-2 py-0.5 bg-green-50 text-[#1e8e3e] text-xs rounded">
                      解決済み
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Comment input */}
          <div className="border-t border-[#dadce0] pt-3">
            <textarea
              value={commentContent}
              onChange={(e) => setCommentContent(e.target.value)}
              placeholder="コメントを入力..."
              rows={2}
              className="input resize-none text-sm"
            />
            <div className="flex justify-end mt-2">
              <button
                onClick={handleSubmitComment}
                disabled={!commentContent.trim() || isSubmitting}
                className="btn btn-primary text-sm"
              >
                {isSubmitting ? "送信中..." : "コメントを追加"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
