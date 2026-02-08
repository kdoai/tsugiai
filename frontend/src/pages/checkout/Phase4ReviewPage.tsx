/**
 * Phase 4: Summary review and edit page
 */

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { ActionItem, ItemType } from "../../types/handover";

interface Phase4ReviewPageProps {
  summaryMarkdown: string;
  actionItems?: ActionItem[];
  onUpdateSummary: (markdown: string) => Promise<void>;
  onUpdateActionItems?: (items: ActionItem[]) => Promise<void>;
  onComplete: () => Promise<void>;
  onBack: () => void;
  isSaving: boolean;
  isCompleting: boolean;
}

// Action item type labels
const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  checkbox: "チェック",
  numeric: "数値入力",
  text: "テキスト",
  selection: "選択式",
  photo: "写真",
};

export function Phase4ReviewPage({
  summaryMarkdown,
  actionItems = [],
  onUpdateSummary,
  onUpdateActionItems,
  onComplete,
  onBack,
  isSaving,
  isCompleting,
}: Phase4ReviewPageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedMarkdown, setEditedMarkdown] = useState(summaryMarkdown);
  const [hasChanges, setHasChanges] = useState(false);

  // Action items state
  const [editedActionItems, setEditedActionItems] = useState<ActionItem[]>(actionItems);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [showAddAction, setShowAddAction] = useState(false);
  const [newAction, setNewAction] = useState<Partial<ActionItem>>({
    topic: "",
    description: "",
    item_type: "checkbox",
    timing: "",
    condition: "",
    then_action: "",
    evidence: "",
  });

  useEffect(() => {
    setEditedMarkdown(summaryMarkdown);
  }, [summaryMarkdown]);

  useEffect(() => {
    setEditedActionItems(actionItems);
  }, [actionItems]);

  useEffect(() => {
    const markdownChanged = editedMarkdown !== summaryMarkdown;
    const actionsChanged = JSON.stringify(editedActionItems) !== JSON.stringify(actionItems);
    setHasChanges(markdownChanged || actionsChanged);
  }, [editedMarkdown, summaryMarkdown, editedActionItems, actionItems]);

  const handleSave = async () => {
    await onUpdateSummary(editedMarkdown);
    if (onUpdateActionItems) {
      await onUpdateActionItems(editedActionItems);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedMarkdown(summaryMarkdown);
    setEditedActionItems(actionItems);
    setIsEditing(false);
  };

  const handleComplete = async () => {
    if (hasChanges) {
      await onUpdateSummary(editedMarkdown);
      if (onUpdateActionItems) {
        await onUpdateActionItems(editedActionItems);
      }
    }
    await onComplete();
  };

  // Action item handlers
  const handleUpdateAction = (id: string, updates: Partial<ActionItem>) => {
    setEditedActionItems((items) =>
      items.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const handleDeleteAction = (id: string) => {
    setEditedActionItems((items) => items.filter((item) => item.id !== id));
  };

  const handleAddAction = () => {
    if (!newAction.topic || !newAction.description) return;

    const actionItem: ActionItem = {
      id: `action-${Date.now()}`,
      topic: newAction.topic || "",
      description: newAction.description || "",
      item_type: newAction.item_type || "checkbox",
      timing: newAction.timing || undefined,
      condition: newAction.condition || undefined,
      then_action: newAction.then_action || undefined,
      evidence: newAction.evidence || "手動で追加",
      order: editedActionItems.length,
    };

    setEditedActionItems([...editedActionItems, actionItem]);
    setNewAction({
      topic: "",
      description: "",
      item_type: "checkbox",
      timing: "",
      condition: "",
      then_action: "",
      evidence: "",
    });
    setShowAddAction(false);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#202124]">引継ぎ内容の確認</h2>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
          >
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            編集
          </button>
        )}
      </div>

      {/* Summary content */}
      <div className="card">
        {isEditing ? (
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-[#5f6368]">Markdown編集</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCancel}
                  disabled={isSaving}
                  className="text-sm text-[#5f6368] hover:text-[#202124]"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving || !hasChanges}
                  className="btn btn-primary btn-sm"
                >
                  {isSaving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
            <textarea
              value={editedMarkdown}
              onChange={(e) => setEditedMarkdown(e.target.value)}
              className="input font-mono text-sm w-full"
              rows={20}
              placeholder="Markdownを入力..."
            />
          </div>
        ) : (
          <div className="p-4">
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
                {editedMarkdown || "*引継ぎ内容がありません*"}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      {/* Action Items Section */}
      {(editedActionItems.length > 0 || showAddAction) && (
        <div className="card">
          <div className="p-4 border-b border-[#dadce0]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="size-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                <h3 className="font-semibold text-[#202124]">アクションアイテム</h3>
                <span className="text-sm text-[#5f6368]">（次担当者が実行）</span>
              </div>
              {!showAddAction && (
                <button
                  onClick={() => setShowAddAction(true)}
                  className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
                >
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  追加
                </button>
              )}
            </div>
            <p className="text-sm text-[#5f6368] mt-1">
              AIが対話内容から生成したアクションです。内容を確認・修正してください。
            </p>
          </div>

          <div className="divide-y divide-[#dadce0]">
            {editedActionItems.map((action) => (
              <div key={action.id} className="p-4">
                {editingActionId === action.id ? (
                  // Edit mode
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={action.topic}
                      onChange={(e) => handleUpdateAction(action.id, { topic: e.target.value })}
                      className="input w-full font-medium"
                      placeholder="アクション名"
                    />
                    <textarea
                      value={action.description}
                      onChange={(e) => handleUpdateAction(action.id, { description: e.target.value })}
                      className="input w-full text-sm"
                      rows={2}
                      placeholder="詳細説明"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-[#5f6368]">タイミング</label>
                        <input
                          type="text"
                          value={action.timing || ""}
                          onChange={(e) => handleUpdateAction(action.id, { timing: e.target.value })}
                          className="input w-full text-sm"
                          placeholder="例: 17:00の巡回時"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[#5f6368]">入力形式</label>
                        <select
                          value={action.item_type}
                          onChange={(e) => handleUpdateAction(action.id, { item_type: e.target.value as ItemType })}
                          className="input w-full text-sm"
                        >
                          <option value="checkbox">チェック</option>
                          <option value="numeric">数値入力</option>
                          <option value="text">テキスト</option>
                          <option value="selection">選択式</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-[#5f6368]">判断基準</label>
                        <input
                          type="text"
                          value={action.condition || ""}
                          onChange={(e) => handleUpdateAction(action.id, { condition: e.target.value })}
                          className="input w-full text-sm"
                          placeholder="例: 290℃以上なら"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[#5f6368]">基準外の対応</label>
                        <input
                          type="text"
                          value={action.then_action || ""}
                          onChange={(e) => handleUpdateAction(action.id, { then_action: e.target.value })}
                          className="input w-full text-sm"
                          placeholder="例: 設備担当に連絡"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingActionId(null)}
                        className="btn btn-secondary btn-sm"
                      >
                        完了
                      </button>
                    </div>
                  </div>
                ) : (
                  // View mode
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[#202124]">{action.topic}</span>
                        <span className="px-2 py-0.5 text-xs bg-[#e8f0fe] text-primary-700 rounded">
                          {ITEM_TYPE_LABELS[action.item_type]}
                        </span>
                      </div>
                      <p className="text-sm text-[#5f6368] mt-1">{action.description}</p>
                      {(action.timing || action.condition || action.then_action) && (
                        <div className="mt-2 text-sm space-y-1">
                          {action.timing && (
                            <div className="flex items-center gap-2">
                              <span className="text-[#5f6368]">タイミング:</span>
                              <span className="text-[#202124]">{action.timing}</span>
                            </div>
                          )}
                          {action.condition && (
                            <div className="flex items-center gap-2">
                              <span className="text-[#5f6368]">判断基準:</span>
                              <span className="text-[#202124]">{action.condition}</span>
                            </div>
                          )}
                          {action.then_action && (
                            <div className="flex items-center gap-2">
                              <span className="text-[#5f6368]">基準外の対応:</span>
                              <span className="text-[#202124]">{action.then_action}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {action.evidence && (
                        <div className="mt-2 text-xs text-[#5f6368] bg-[#f8f9fa] px-2 py-1 rounded">
                          根拠: {action.evidence}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-4">
                      <button
                        onClick={() => setEditingActionId(action.id)}
                        className="p-1.5 text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4] rounded"
                        title="編集"
                      >
                        <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteAction(action.id)}
                        className="p-1.5 text-[#5f6368] hover:text-red-600 hover:bg-red-50 rounded"
                        title="削除"
                      >
                        <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Add new action form */}
            {showAddAction && (
              <div className="p-4 bg-[#f8f9fa]">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[#202124]">新しいアクションを追加</span>
                    <button
                      onClick={() => setShowAddAction(false)}
                      className="text-sm text-[#5f6368] hover:text-[#202124]"
                    >
                      キャンセル
                    </button>
                  </div>
                  <input
                    type="text"
                    value={newAction.topic || ""}
                    onChange={(e) => setNewAction({ ...newAction, topic: e.target.value })}
                    className="input w-full"
                    placeholder="アクション名（例: 2号炉の温度確認）"
                  />
                  <textarea
                    value={newAction.description || ""}
                    onChange={(e) => setNewAction({ ...newAction, description: e.target.value })}
                    className="input w-full text-sm"
                    rows={2}
                    placeholder="詳細説明"
                  />
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-[#5f6368]">タイミング</label>
                      <input
                        type="text"
                        value={newAction.timing || ""}
                        onChange={(e) => setNewAction({ ...newAction, timing: e.target.value })}
                        className="input w-full text-sm"
                        placeholder="例: 17:00"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[#5f6368]">判断基準</label>
                      <input
                        type="text"
                        value={newAction.condition || ""}
                        onChange={(e) => setNewAction({ ...newAction, condition: e.target.value })}
                        className="input w-full text-sm"
                        placeholder="例: 290℃以上"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[#5f6368]">入力形式</label>
                      <select
                        value={newAction.item_type || "checkbox"}
                        onChange={(e) => setNewAction({ ...newAction, item_type: e.target.value as ItemType })}
                        className="input w-full text-sm"
                      >
                        <option value="checkbox">チェック</option>
                        <option value="numeric">数値入力</option>
                        <option value="text">テキスト</option>
                        <option value="selection">選択式</option>
                      </select>
                    </div>
                  </div>
                  <button
                    onClick={handleAddAction}
                    disabled={!newAction.topic || !newAction.description}
                    className="btn btn-primary btn-sm w-full"
                  >
                    追加
                  </button>
                </div>
              </div>
            )}
          </div>

          {editedActionItems.length === 0 && !showAddAction && (
            <div className="p-8 text-center text-[#5f6368]">
              <p>アクションアイテムはありません</p>
              <button
                onClick={() => setShowAddAction(true)}
                className="mt-2 text-sm text-primary-600 hover:text-primary-700"
              >
                手動で追加する
              </button>
            </div>
          )}
        </div>
      )}

      {/* No action items message with add button */}
      {editedActionItems.length === 0 && !showAddAction && actionItems.length === 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[#5f6368]">
              <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span>AIによるアクションアイテムの生成はありません</span>
            </div>
            <button
              onClick={() => setShowAddAction(true)}
              className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              手動で追加
            </button>
          </div>
        </div>
      )}

      {/* Status indicators */}
      {hasChanges && !isEditing && (
        <div className="flex items-center gap-2 text-sm text-amber-600">
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>未保存の変更があります</span>
        </div>
      )}

      {/* Confirmation checkbox */}
      <div className="card p-4 bg-[#f8f9fa]">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 rounded border-[#dadce0] text-primary-600 focus:ring-primary-500"
            id="confirm-checkbox"
          />
          <div>
            <span className="font-medium text-[#202124]">内容を確認しました</span>
            <p className="text-sm text-[#5f6368] mt-1">
              上記の引継ぎ内容に間違いがないことを確認してください。
              完了後は引継ぎ簿として記録されます。
            </p>
          </div>
        </label>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-[#dadce0]">
        <button
          type="button"
          onClick={onBack}
          disabled={isEditing || isSaving}
          className="text-sm text-[#5f6368] hover:text-[#202124]"
        >
          前に戻る
        </button>
        <button
          onClick={handleComplete}
          disabled={isCompleting || isEditing || isSaving}
          className="btn btn-primary"
        >
          {isCompleting ? "完了処理中..." : "引継ぎを完了する"}
        </button>
      </div>
    </div>
  );
}
