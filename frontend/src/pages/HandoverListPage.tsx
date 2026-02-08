/**
 * Handover List Page - View all handover notes organized by template
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { handoverApi, templateApi } from "../services/handoverApi";
import type { HandoverNote, ChecklistTemplate } from "../types/handover";

type SortField = "created_at" | "status";
type SortOrder = "asc" | "desc";

// Autocomplete filter component
function AutocompleteFilter({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter options based on input - only show when user has typed something
  const filteredOptions = useMemo(() => {
    if (!inputValue) return [];
    const lower = inputValue.toLowerCase();
    return options.filter((opt) => opt.toLowerCase().includes(lower));
  }, [options, inputValue]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Sync inputValue with value prop
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    setIsOpen(true);
    // Apply filter immediately as user types
    onChange(newValue);
  };

  const handleSelect = (option: string) => {
    setInputValue(option);
    onChange(option);
    setIsOpen(false);
  };

  const handleClear = () => {
    setInputValue("");
    onChange("");
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-xs text-[#5f6368] mb-1">{label}</label>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="input py-1.5 text-sm w-full pr-8"
        />
        {inputValue && (
          <button
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#9aa0a6] hover:text-[#5f6368]"
            type="button"
          >
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      {isOpen && filteredOptions.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-[#dadce0] rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filteredOptions.slice(0, 10).map((option) => (
            <button
              key={option}
              onClick={() => handleSelect(option)}
              className="w-full px-3 py-2 text-sm text-left text-[#202124] hover:bg-[#f1f3f4] transition-colors"
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HandoverListPage() {
  const [handovers, setHandovers] = useState<HandoverNote[]>([]);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Selected template (null = show template list)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Filters
  const [templateFilter, setTemplateFilter] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("");

  // Sorting
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [handoversData, templatesData] = await Promise.all([
        handoverApi.listHandovers(100),
        templateApi.listTemplates(),
      ]);
      setHandovers(handoversData);
      setTemplates(templatesData);
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Get template by ID
  const getTemplate = (templateId: string) => {
    return templates.find((t) => t.id === templateId);
  };

  // Get handover count for a template
  const getHandoverCount = (templateId: string) => {
    return handovers.filter((h) => h.template_id === templateId).length;
  };

  // Get unique operators for autocomplete (filtered by selected template)
  const operatorNames = useMemo(() => {
    const names = new Set<string>();
    handovers
      .filter((h) => !selectedTemplateId || h.template_id === selectedTemplateId)
      .forEach((h) => {
        if (h.operator_name) {
          names.add(h.operator_name);
        }
      });
    return Array.from(names).sort();
  }, [handovers, selectedTemplateId]);

  // Templates with handovers (sorted by handover count)
  const templatesWithHandovers = useMemo(() => {
    const templateIds = new Set(handovers.map((h) => h.template_id));
    return templates
      .filter((t) => templateIds.has(t.id))
      .sort((a, b) => getHandoverCount(b.id) - getHandoverCount(a.id));
  }, [templates, handovers]);

  // Template names for autocomplete
  const templateNames = useMemo(() => {
    return templatesWithHandovers.map((t) => t.title).sort();
  }, [templatesWithHandovers]);

  // Filtered templates based on search
  const filteredTemplates = useMemo(() => {
    if (!templateFilter) return templatesWithHandovers;
    const lower = templateFilter.toLowerCase();
    return templatesWithHandovers.filter((t) =>
      t.title.toLowerCase().includes(lower)
    );
  }, [templatesWithHandovers, templateFilter]);

  // Filter and sort handovers for selected template
  const filteredAndSortedHandovers = useMemo(() => {
    if (!selectedTemplateId) return [];

    let result = handovers.filter((h) => h.template_id === selectedTemplateId);

    // Apply operator filter
    if (operatorFilter) {
      const lower = operatorFilter.toLowerCase();
      result = result.filter((h) =>
        h.operator_name?.toLowerCase().includes(lower)
      );
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;

      if (sortField === "created_at") {
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      } else if (sortField === "status") {
        // Sort order: 取消済 < 未確認 < 確認済
        const getStatusOrder = (h: HandoverNote) => {
          if (h.is_cancelled) return 0;
          if (!h.is_confirmed) return 1;
          return 2;
        };
        comparison = getStatusOrder(a) - getStatusOrder(b);
      }

      return sortOrder === "asc" ? comparison : -comparison;
    });

    return result;
  }, [handovers, selectedTemplateId, operatorFilter, sortField, sortOrder]);

  // Handle sort click
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  // Sort indicator
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return (
        <svg className="size-4 text-[#9aa0a6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    return sortOrder === "asc" ? (
      <svg className="size-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="size-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  // Handle back to template list
  const handleBackToTemplates = () => {
    setSelectedTemplateId(null);
    setOperatorFilter("");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="size-8 spinner" />
      </div>
    );
  }

  // Template List View
  if (!selectedTemplateId) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#dadce0]">
          <div>
            <h1 className="text-xl font-semibold text-[#202124] text-balance">引継ぎ一覧</h1>
            <p className="text-sm text-[#5f6368] mt-1 text-pretty">
              テンプレートを選択して引継ぎ記録を確認できます
            </p>
          </div>
          <Link to="/checkout" className="btn btn-primary shrink-0">
            <svg className="size-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新規チェックアウト
          </Link>
        </div>

        {/* Filter */}
        {templatesWithHandovers.length > 0 && (
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-64">
              <AutocompleteFilter
                label="テンプレート"
                value={templateFilter}
                onChange={setTemplateFilter}
                options={templateNames}
                placeholder="テンプレートを検索..."
              />
            </div>
            {templateFilter && (
              <button
                onClick={() => setTemplateFilter("")}
                className="text-sm text-primary-600 hover:text-primary-700 pb-1.5"
              >
                フィルターをクリア
              </button>
            )}
          </div>
        )}

        {/* Template Grid */}
        {filteredTemplates.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTemplates.map((template) => {
              const count = getHandoverCount(template.id);
              const unconfirmedCount = handovers.filter(
                (h) => h.template_id === template.id && !h.is_confirmed && !h.is_cancelled
              ).length;

              return (
                <button
                  key={template.id}
                  onClick={() => setSelectedTemplateId(template.id)}
                  className="card p-4 text-left hover:shadow-md transition-shadow group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="size-10 rounded-lg bg-primary-50 flex items-center justify-center shrink-0">
                          <svg className="size-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-medium text-[#202124] truncate group-hover:text-primary-600 transition-colors">
                            {template.title}
                          </h3>
                          <p className="text-xs text-[#5f6368]">
                            {count}件の引継ぎ
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {unconfirmedCount > 0 && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-yellow-50 text-yellow-700 rounded">
                          未確認 {unconfirmedCount}
                        </span>
                      )}
                      <svg className="size-5 text-[#9aa0a6] group-hover:text-primary-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="card p-8 text-center">
            <div className="size-16 rounded-lg bg-[#f1f3f4] flex items-center justify-center mx-auto mb-4">
              <svg className="size-8 text-[#9aa0a6]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-base font-medium text-[#202124] mb-1 text-balance">
              {templateFilter ? "該当するテンプレートがありません" : "引継ぎ記録がありません"}
            </h3>
            <p className="text-sm text-[#5f6368] mb-4 text-pretty">
              {templateFilter
                ? "フィルターを変更して他のテンプレートを確認してください。"
                : "チェックアウトを完了すると、ここに引継ぎ記録が表示されます。"}
            </p>
            {!templateFilter && (
              <Link to="/checkout" className="btn btn-primary">
                チェックアウトを開始
              </Link>
            )}
          </div>
        )}
      </div>
    );
  }

  // Handover List View (for selected template)
  const selectedTemplate = getTemplate(selectedTemplateId);

  return (
    <div className="space-y-6">
      {/* Header with back button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#dadce0]">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBackToTemplates}
            className="p-2 hover:bg-[#f1f3f4] rounded-full -ml-2"
            aria-label="テンプレート一覧に戻る"
          >
            <svg className="size-5 text-[#5f6368]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-semibold text-[#202124] text-balance">
              {selectedTemplate?.title || "引継ぎ一覧"}
            </h1>
            <p className="text-sm text-[#5f6368] mt-0.5">
              {filteredAndSortedHandovers.length}件の引継ぎ記録
            </p>
          </div>
        </div>
        <Link to="/checkout" className="btn btn-primary shrink-0">
          <svg className="size-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新規チェックアウト
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-48">
          <AutocompleteFilter
            label="担当者"
            value={operatorFilter}
            onChange={setOperatorFilter}
            options={operatorNames}
            placeholder="担当者を検索..."
          />
        </div>
        {operatorFilter && (
          <button
            onClick={() => setOperatorFilter("")}
            className="text-sm text-primary-600 hover:text-primary-700 pb-1.5"
          >
            フィルターをクリア
          </button>
        )}
      </div>

      {/* Handover Table */}
      {filteredAndSortedHandovers.length > 0 ? (
        <div className="card overflow-hidden">
          {/* Table Header */}
          <div className="hidden sm:grid sm:grid-cols-12 gap-4 px-4 py-2 bg-[#f8f9fa] border-b border-[#dadce0] text-xs font-medium text-[#5f6368]">
            <div className="col-span-4">担当者</div>
            <button
              onClick={() => handleSort("created_at")}
              className="col-span-4 flex items-center gap-1 hover:text-[#202124] transition-colors"
            >
              日時
              <SortIcon field="created_at" />
            </button>
            <button
              onClick={() => handleSort("status")}
              className="col-span-4 flex items-center gap-1 hover:text-[#202124] transition-colors"
            >
              状態
              <SortIcon field="status" />
            </button>
          </div>

          {/* Table Body */}
          <div className="divide-y divide-[#dadce0]">
            {filteredAndSortedHandovers.map((handover) => (
              <Link
                key={handover.id}
                to={`/handover/${handover.id}`}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 px-4 py-3 hover:bg-[#f8f9fa] transition-colors items-center"
              >
                {/* Operator */}
                <div className="col-span-4 flex items-center gap-2">
                  <div className="size-8 rounded-full bg-[#f1f3f4] flex items-center justify-center shrink-0">
                    <span className="text-sm font-medium text-[#5f6368]">
                      {handover.operator_name?.charAt(0) || "?"}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-[#202124] truncate">
                      {handover.operator_name}
                    </p>
                    {handover.next_operator_name && (
                      <p className="text-xs text-[#5f6368] truncate">
                        → {handover.next_operator_name}
                      </p>
                    )}
                  </div>
                </div>

                {/* Date */}
                <div className="col-span-4 text-sm text-[#5f6368] tabular-nums">
                  <span className="sm:hidden text-xs text-[#9aa0a6] mr-2">日時:</span>
                  {new Date(handover.created_at).toLocaleString("ja-JP", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>

                {/* Status */}
                <div className="col-span-4 flex items-center justify-between">
                  <div>
                    <span className="sm:hidden text-xs text-[#9aa0a6] mr-2">状態:</span>
                    {handover.is_cancelled ? (
                      <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded">
                        取消済
                      </span>
                    ) : !handover.is_confirmed ? (
                      <span className="px-2 py-0.5 text-xs font-medium bg-yellow-50 text-yellow-700 rounded">
                        未確認
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-xs font-medium bg-green-50 text-[#1e8e3e] rounded">
                        確認済
                      </span>
                    )}
                  </div>
                  <svg className="size-4 text-[#9aa0a6] hidden sm:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="card p-8 text-center">
          <div className="size-16 rounded-lg bg-[#f1f3f4] flex items-center justify-center mx-auto mb-4">
            <svg className="size-8 text-[#9aa0a6]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-base font-medium text-[#202124] mb-1 text-balance">
            {operatorFilter ? "該当する記録がありません" : "引継ぎ記録がありません"}
          </h3>
          <p className="text-sm text-[#5f6368] mb-4 text-pretty">
            {operatorFilter
              ? "フィルターを変更して他の記録を確認してください。"
              : "このテンプレートにはまだ引継ぎ記録がありません。"}
          </p>
        </div>
      )}
    </div>
  );
}
