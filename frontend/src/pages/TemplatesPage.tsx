/**
 * Templates Management Page
 */

import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { templateApi } from "../services/handoverApi";
import type { ChecklistTemplate } from "../types/handover";

export function TemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setIsLoading(true);
      const data = await templateApi.listTemplates();
      setTemplates(data);
    } catch (error) {
      console.error("Failed to load templates:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (templateId: string) => {
    try {
      await templateApi.deleteTemplate(templateId);
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
      setDeleteConfirm(null);
    } catch (error) {
      console.error("Failed to delete template:", error);
    }
  };

  const handleStartCheckout = (templateId: string) => {
    navigate(`/checkout?template=${templateId}`);
  };

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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#dadce0]">
        <div>
          <h1 className="text-xl font-semibold text-[#202124]">テンプレート管理</h1>
          <p className="text-sm text-[#5f6368] mt-1">
            チェックリストのテンプレートを作成・管理します
          </p>
        </div>
        <Link to="/templates/new" className="btn btn-primary shrink-0">
          <svg className="size-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新規作成
        </Link>
      </div>

      {/* Templates Grid */}
      {templates.length > 0 ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((template) => (
            <div
              key={template.id}
              className="card p-4 group flex flex-col h-full"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-[#202124] text-sm truncate">
                    {template.title}
                  </h3>
                  <p className="text-xs text-[#5f6368] mt-1 line-clamp-2">
                    {template.description || "説明なし"}
                  </p>
                </div>
                <button
                  onClick={() => setDeleteConfirm(template.id)}
                  aria-label="テンプレートを削除"
                  className="p-1.5 text-[#9aa0a6] hover:text-[#d93025] hover:bg-red-50 rounded sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                >
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>

              {/* Items Preview - flex-1 to fill available space */}
              <div className="flex-1">
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {template.items?.slice(0, 4).map((item, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 text-xs rounded bg-[#e8f0fe] text-[#1a73e8]"
                    >
                      {item.topic}
                    </span>
                  ))}
                  {(template.items?.length || 0) > 4 && (
                    <span className="px-2 py-0.5 text-xs bg-[#f1f3f4] text-[#9aa0a6] rounded">
                      +{(template.items?.length || 0) - 4}
                    </span>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-3 text-xs text-[#5f6368] mb-3 tabular-nums">
                <span className="flex items-center gap-1">
                  <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  {template.items?.length || 0}項目
                </span>
                <span className="flex items-center gap-1">
                  <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  約{Math.round((template.duration || 600) / 60)}分
                </span>
              </div>

              {/* Actions - mt-auto to push to bottom */}
              <div className="flex gap-2 pt-3 border-t border-[#dadce0] mt-auto">
                <button
                  onClick={() => handleStartCheckout(template.id)}
                  className="btn btn-primary flex-1 text-xs py-1.5"
                >
                  使用する
                </button>
                <Link
                  to={`/templates/${template.id}/edit`}
                  className="btn btn-secondary text-xs py-1.5"
                >
                  編集
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-8 text-center">
          <div className="size-16 rounded-lg bg-[#f1f3f4] flex items-center justify-center mx-auto mb-4">
            <svg className="size-8 text-[#9aa0a6]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
          </div>
          <h3 className="text-base font-medium text-[#202124] mb-1">
            テンプレートがありません
          </h3>
          <p className="text-sm text-[#5f6368] mb-4">
            AIと対話しながらチェックリストのテンプレートを作成しましょう。
          </p>
          <Link to="/templates/new" className="btn btn-primary">
            テンプレートを作成
          </Link>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="text-center">
              <div className="size-12 rounded-lg bg-red-50 flex items-center justify-center mx-auto mb-4">
                <svg className="size-6 text-[#d93025]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-[#202124] mb-2">
                テンプレートを削除しますか？
              </h3>
              <p className="text-sm text-[#5f6368] mb-6">
                この操作は取り消せません。
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="btn btn-secondary"
                >
                  キャンセル
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm)}
                  className="btn bg-[#d93025] text-white hover:bg-red-700"
                >
                  削除する
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
