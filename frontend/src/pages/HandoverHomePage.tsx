/**
 * Handover System Home Page
 */

import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { templateApi, handoverApi, checkoutApi } from "../services/handoverApi";
import { useAuth } from "../contexts/AuthContext";
import type { ChecklistTemplate, HandoverNote } from "../types/handover";

interface InProgressSession {
  id: string;
  template_id: string;
  operator_name: string;
  next_operator_name: string;
  status: string;
  current_phase: number;
  started_at: string;
  item_count: number;
}

const PHASE_LABELS: Record<number, string> = {
  1: "フォーム入力",
  2: "写真撮影",
  3: "引継ぎ対話",
  4: "確認・完了",
};

export function HandoverHomePage() {
  const navigate = useNavigate();
  const { isViewer } = useAuth();
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [recentHandovers, setRecentHandovers] = useState<HandoverNote[]>([]);
  const [inProgressSessions, setInProgressSessions] = useState<InProgressSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [templatesData, handoversData, sessionsData] = await Promise.all([
        templateApi.listTemplates(),
        handoverApi.listHandovers(5),
        checkoutApi.listSessions(),
      ]);
      setTemplates(templatesData);
      setRecentHandovers(handoversData);
      setInProgressSessions(sessionsData.sessions);
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartCheckout = (templateId: string) => {
    navigate(`/checkout?template=${templateId}`);
  };

  const getTemplateName = (templateId: string): string => {
    const t = templates.find((tpl) => tpl.id === templateId);
    return t?.title || "テンプレート";
  };

  const getTemplateItemCount = (templateId: string): number => {
    const t = templates.find((tpl) => tpl.id === templateId);
    return t?.items?.length || 0;
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!window.confirm("このチェックアウトを削除しますか？")) return;
    try {
      await checkoutApi.deleteSession(sessionId);
      setInProgressSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (error) {
      console.error("Failed to delete session:", error);
      alert("削除に失敗しました");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="size-8 spinner" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero Section - Light Blue Business Style */}
      <div className="bg-blue-50 rounded-lg -mx-4 sm:-mx-6 lg:mx-0 border border-blue-100">
        <div className="px-5 py-5 sm:py-6">
          <div className="max-w-2xl">
            {/* Badge */}
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-100 text-xs text-blue-700 mb-3">
              <span className="size-1.5 rounded-full bg-blue-500" />
              AI-Powered Handover System
            </div>

            {/* Headline */}
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight mb-2 text-slate-900">
              作業完了の確認、引継ぎを<br />
              AIとの対話で完結
            </h1>

            {/* Subheadline */}
            <p className="text-sm text-slate-600 text-pretty mb-4">
              チェックリストに沿ってAIが質問。答えるだけで漏れのない引継ぎ簿を自動生成。
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-2">
              <Link
                to="/checkout"
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-md font-medium hover:bg-blue-700 transition-colors"
              >
                チェックアウトを開始
                <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
              {!isViewer && (
                <Link
                  to="/templates/new"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white text-slate-700 text-sm border border-slate-300 rounded-md font-medium hover:bg-slate-50 transition-colors"
                >
                  テンプレートを作成
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Feature cards */}
        <div className="border-t border-blue-100">
          <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-blue-100">
            <div className="px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                  <svg className="size-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-slate-900 font-medium text-xs">対話形式でスムーズ</h3>
                  <p className="text-slate-500 text-xs">AIが順番に質問</p>
                </div>
              </div>
            </div>

            <div className="px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                  <svg className="size-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-slate-900 font-medium text-xs">確認漏れをゼロに</h3>
                  <p className="text-slate-500 text-xs">テンプレートに沿ってAIが確認実施</p>
                </div>
              </div>
            </div>

            <div className="px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                  <svg className="size-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-slate-900 font-medium text-xs">引継ぎ簿を自動生成</h3>
                  <p className="text-slate-500 text-xs">AIが要約・文書化</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* In-Progress Sessions */}
      {inProgressSessions.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 text-balance">作業中のチェックアウト</h2>
              <p className="text-sm text-slate-500 text-pretty mt-0.5">前回の続きから再開できます</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {inProgressSessions.map((session) => {
              const totalItems = getTemplateItemCount(session.template_id);
              return (
                <button
                  type="button"
                  key={session.id}
                  className="group p-4 rounded-lg bg-amber-50 border border-amber-200 text-left hover:border-amber-400 hover:shadow-sm transition-colors"
                  onClick={() => navigate(`/checkout/${session.id}`)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="size-9 rounded-lg bg-amber-100 flex items-center justify-center">
                      <svg className="size-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-xs text-amber-700">
                        {PHASE_LABELS[session.current_phase] || `Phase ${session.current_phase}`}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteSession(e, session.id)}
                        className="p-1 rounded hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors"
                        title="削除"
                      >
                        <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <p className="text-sm font-medium text-slate-900 mb-0.5">
                    {session.operator_name}
                    {session.next_operator_name && (
                      <>
                        <span className="text-slate-400 mx-1">→</span>
                        {session.next_operator_name}
                      </>
                    )}
                  </p>
                  <p className="text-xs text-slate-600 truncate mb-2">
                    {getTemplateName(session.template_id)}
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-xs text-slate-500 tabular-nums">
                      {totalItems > 0 && (
                        <span>{session.item_count}/{totalItems} 回答済み</span>
                      )}
                      <span>
                        {new Date(session.started_at).toLocaleString("ja-JP", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-amber-700 group-hover:text-amber-800">
                      再開
                      <svg className="size-3 inline ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Templates Section */}
      {templates.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 text-balance">テンプレート</h2>
              <p className="text-sm text-slate-500 text-pretty mt-0.5">チェックリストを選んでチェックアウトを開始</p>
            </div>
            <Link to="/templates" className="text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 whitespace-nowrap shrink-0">
              すべて表示
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.slice(0, 6).map((template) => (
              <button
                type="button"
                key={template.id}
                className={clsx(
                  "group p-4 rounded-lg bg-white border border-slate-200 text-left",
                  "hover:border-blue-300 hover:shadow-sm transition-colors"
                )}
                onClick={() => handleStartCheckout(template.id)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="size-9 rounded-lg bg-blue-50 flex items-center justify-center">
                    <svg className="size-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                  </div>
                  <svg className="size-4 text-slate-400 group-hover:text-blue-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </div>
                <h3 className="font-medium text-slate-900 text-balance truncate mb-1">{template.title}</h3>
                <p className="text-sm text-slate-500 line-clamp-2 text-pretty mb-2">{template.description}</p>
                <div className="flex items-center gap-3 text-xs text-slate-400 tabular-nums">
                  <span>{template.items?.length || 0}項目</span>
                  <span>約{Math.round((template.duration || 600) / 60)}分</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Recent Handovers */}
      {recentHandovers.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 text-balance">最近の引継ぎ</h2>
              <p className="text-sm text-slate-500 text-pretty mt-0.5">過去の引継ぎ記録を確認</p>
            </div>
            <Link to="/handovers" className="text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 whitespace-nowrap shrink-0">
              すべて表示
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">
            {recentHandovers.map((handover) => (
              <Link
                key={handover.id}
                to={`/handover/${handover.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-full bg-blue-50 flex items-center justify-center">
                    <span className="text-sm font-medium text-blue-600">
                      {handover.operator_name?.charAt(0) || "?"}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {handover.operator_name}
                      <span className="text-slate-400 mx-1.5">→</span>
                      {handover.next_operator_name || "未定"}
                    </p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      {new Date(handover.created_at).toLocaleString("ja-JP", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(handover.priority_summary?.p0 ?? 0) > 0 && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-red-50 text-red-700 rounded tabular-nums">
                      P0: {handover.priority_summary?.p0}
                    </span>
                  )}
                  {(handover.priority_summary?.p1 ?? 0) > 0 && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 rounded tabular-nums">
                      P1: {handover.priority_summary?.p1}
                    </span>
                  )}
                  <svg className="size-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Empty State */}
      {templates.length === 0 && recentHandovers.length === 0 && (
        <div className="text-center py-12">
          <div className="size-16 rounded-xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
            <svg className="size-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          {isViewer ? (
            <>
              <h3 className="text-lg font-semibold text-slate-900 text-balance mb-1">テンプレートがありません</h3>
              <p className="text-slate-500 text-pretty mb-6 max-w-sm mx-auto">
                管理者にテンプレートの作成を依頼してください。
              </p>
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold text-slate-900 text-balance mb-1">まずはテンプレートを作成</h3>
              <p className="text-slate-500 text-pretty mb-6 max-w-sm mx-auto">
                AIと対話しながら、業務に合わせたチェックリストのテンプレートを作成しましょう。
              </p>
              <Link
                to="/templates/new"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors"
              >
                テンプレートを作成
                <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
