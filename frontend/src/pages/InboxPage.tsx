/**
 * Inbox Page - View handover notifications assigned to current user
 */

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { inboxApi } from "../services/handoverApi";
import type { InboxItem } from "../types/handover";

export function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    loadInbox();
  }, [filter]);

  const loadInbox = async () => {
    try {
      setIsLoading(true);
      const data = await inboxApi.list({
        limit: 50,
        unread_only: filter === "unread",
      });
      setItems(data.items);
    } catch (error) {
      console.error("Failed to load inbox:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMarkRead = async (itemId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await inboxApi.markRead(itemId);
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId ? { ...item, is_read: true } : item
        )
      );
    } catch (error) {
      console.error("Failed to mark as read:", error);
    }
  };

  const handleMarkUnread = async (itemId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await inboxApi.markUnread(itemId);
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId ? { ...item, is_read: false } : item
        )
      );
    } catch (error) {
      console.error("Failed to mark as unread:", error);
    }
  };

  const handleDelete = async (itemId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("この通知を削除しますか？（引継ぎ簿本体は削除されません）")) {
      return;
    }
    setDeletingId(itemId);
    try {
      await inboxApi.delete(itemId);
      setItems((prev) => prev.filter((item) => item.id !== itemId));
    } catch (error) {
      console.error("Failed to delete inbox item:", error);
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("ja-JP", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
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
          <h1 className="text-xl font-semibold text-[#202124] text-balance">受信ボックス</h1>
          <p className="text-sm text-[#5f6368] mt-1 text-pretty">
            あなた宛ての引継ぎ通知
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-1">
        {[
          { key: "all", label: "すべて" },
          { key: "unread", label: "未読" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key as typeof filter)}
            className={clsx(
              "px-3 py-1.5 rounded text-sm font-medium transition-colors",
              filter === f.key
                ? "bg-primary-50 text-primary-700"
                : "text-[#5f6368] hover:bg-[#f1f3f4]"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Inbox List */}
      {items.length > 0 ? (
        <div className="card overflow-hidden">
          {/* Table Header */}
          <div className="hidden sm:grid sm:grid-cols-12 gap-4 px-4 py-2 bg-[#f8f9fa] border-b border-[#dadce0] text-xs font-medium text-[#5f6368]">
            <div className="col-span-4">引継ぎ</div>
            <div className="col-span-3">送信者</div>
            <div className="col-span-3">受信日時</div>
            <div className="col-span-2">操作</div>
          </div>

          {/* Table Body */}
          <div className="divide-y divide-[#dadce0]">
            {items.map((item) => (
              <Link
                key={item.id}
                to={`/handover/${item.handover_id}`}
                onClick={() => {
                  if (!item.is_read) {
                    inboxApi.markRead(item.id);
                  }
                }}
                className={clsx(
                  "grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 px-4 py-3 hover:bg-[#f8f9fa] transition-colors items-center",
                  !item.is_read && "bg-primary-50/30"
                )}
              >
                {/* Title */}
                <div className="col-span-4 flex items-center gap-3">
                  {!item.is_read && (
                    <span className="size-2 rounded-full bg-primary-500 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className={clsx(
                      "text-sm truncate",
                      !item.is_read ? "font-semibold text-[#202124]" : "text-[#202124]"
                    )}>
                      {item.handover_title || "引継ぎ"}
                    </p>
                  </div>
                </div>

                {/* Sender */}
                <div className="col-span-3 flex items-center gap-2">
                  <div className="size-6 rounded-full bg-[#f1f3f4] flex items-center justify-center shrink-0">
                    <span className="text-xs font-medium text-[#5f6368]">
                      {item.operator_name?.charAt(0) || "?"}
                    </span>
                  </div>
                  <span className="text-sm text-[#5f6368] truncate">
                    {item.operator_name}
                  </span>
                </div>

                {/* Date */}
                <div className="col-span-3 text-sm text-[#5f6368] tabular-nums">
                  <span className="sm:hidden text-xs text-[#9aa0a6] mr-2">受信:</span>
                  {formatDate(item.created_at)}
                </div>

                {/* Actions */}
                <div className="col-span-2 flex items-center gap-2">
                  {item.is_read ? (
                    <button
                      onClick={(e) => handleMarkUnread(item.id, e)}
                      className="p-1.5 text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4] rounded transition-colors"
                      title="未読にする"
                    >
                      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      onClick={(e) => handleMarkRead(item.id, e)}
                      className="p-1.5 text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded transition-colors"
                      title="既読にする"
                    >
                      <svg className="size-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8l8 5 8-5v10zm-8-7L4 6h16l-8 5z" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={(e) => handleDelete(item.id, e)}
                    disabled={deletingId === item.id}
                    className="p-1.5 text-[#5f6368] hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                    title="削除"
                  >
                    {deletingId === item.id ? (
                      <div className="size-4 spinner" />
                    ) : (
                      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    )}
                  </button>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="card p-8 text-center">
          <div className="size-16 rounded-lg bg-[#f1f3f4] flex items-center justify-center mx-auto mb-4">
            <svg className="size-8 text-[#9aa0a6]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          </div>
          <h3 className="text-base font-medium text-[#202124] mb-1 text-balance">
            {filter === "all" ? "通知はありません" : "未読の通知はありません"}
          </h3>
          <p className="text-sm text-[#5f6368] text-pretty">
            {filter === "all"
              ? "あなた宛ての引継ぎがあると、ここに通知が届きます。"
              : "すべての通知を既読にしました。"}
          </p>
        </div>
      )}
    </div>
  );
}
