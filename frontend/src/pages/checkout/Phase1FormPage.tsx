/**
 * Phase 1: Form input page for checkbox, numeric, text, and selection items
 */

import { useState, useEffect } from "react";
import { clsx } from "clsx";
import type { CheckItem, ItemType, NumericValidation, NGStatus } from "../../types/handover";

interface FormResponse {
  item_id: string;
  item_type: ItemType;
  checkbox_value?: boolean;
  numeric_value?: number;
  text_value?: string;
  selection_value?: string;
  // NG details
  ng_status?: NGStatus;
  ng_detail?: string;
}

const NG_STATUS_OPTIONS: { value: NGStatus; label: string }[] = [
  { value: "unresolved", label: "未対処" },
  { value: "in_progress", label: "対応中" },
  { value: "resolved", label: "対処済み" },
];

interface Phase1FormPageProps {
  items: CheckItem[];
  initialResponses?: FormResponse[];
  onSave: (responses: FormResponse[]) => Promise<void>;
  onComplete: () => Promise<void>;
  onRestart: () => void;
  isSaving: boolean;
  isCompleting: boolean;
}

export function Phase1FormPage({
  items,
  initialResponses = [],
  onSave,
  onComplete,
  onRestart,
  isSaving,
  isCompleting,
}: Phase1FormPageProps) {
  const [responses, setResponses] = useState<Record<string, FormResponse>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Filter items for Phase 1 (checkbox, numeric, text, selection)
  const phase1Items = items.filter(
    (item) =>
      item.item_type === "checkbox" ||
      item.item_type === "numeric" ||
      item.item_type === "text" ||
      item.item_type === "selection"
  );

  // Initialize responses from initial data
  useEffect(() => {
    const initial: Record<string, FormResponse> = {};
    for (const r of initialResponses) {
      initial[r.item_id] = r;
    }
    // Also initialize defaults for items without responses
    for (const item of phase1Items) {
      if (!initial[item.id]) {
        initial[item.id] = {
          item_id: item.id,
          item_type: item.item_type,
          // Leave checkbox_value undefined until user makes a choice
        };
      }
    }
    setResponses(initial);
  }, [initialResponses, items]);

  // Helper: determine if a checkbox value shows as "problem" in the UI
  // Note: always treats NG as problem visually, regardless of expected_answer.
  // expected_answer detection is handled silently via getExpectedAnswerMismatches().
  const isCheckboxProblem = (checkboxValue: boolean | undefined): boolean => {
    if (checkboxValue === undefined) return false;
    return checkboxValue === false;  // NG press = problem (visual only)
  };

  const updateResponse = (itemId: string, itemType: ItemType, value: unknown) => {
    setResponses((prev) => {
      const existing = prev[itemId] || {};
      const item = phase1Items.find((i) => i.id === itemId);
      const isTrap = item?.expected_answer === "ng";
      // For trap questions, never show NG details regardless of button pressed
      const isProblem = itemType === "checkbox" && !isTrap && isCheckboxProblem(value as boolean);
      const isProblemCleared = itemType === "checkbox" && (isTrap || !isCheckboxProblem(value as boolean));

      return {
        ...prev,
        [itemId]: {
          ...existing,
          item_id: itemId,
          item_type: itemType,
          ...(itemType === "checkbox" && { checkbox_value: value as boolean }),
          ...(itemType === "numeric" && { numeric_value: value as number }),
          ...(itemType === "text" && { text_value: value as string }),
          ...(itemType === "selection" && { selection_value: value as string }),
          // Initialize NG details when checkbox triggers a problem
          ...(isProblem && !existing.ng_status && { ng_status: "unresolved" as NGStatus }),
          // Clear NG details when checkbox clears the problem
          ...(isProblemCleared && { ng_status: undefined, ng_detail: undefined }),
        },
      };
    });
    // Clear validation error when value changes
    if (validationErrors[itemId]) {
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    }
  };

  const updateNGDetails = (itemId: string, field: "ng_status" | "ng_detail", value: string) => {
    setResponses((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [field]: value || undefined,
      },
    }));
  };

  const validateNumeric = (
    value: number | undefined,
    validation: NumericValidation | undefined
  ): string | null => {
    if (value === undefined || value === null) {
      return "値を入力してください";
    }
    if (!validation) return null;

    const { validation_type, min_value, max_value, expected_value, base_value, tolerance, unit } =
      validation;

    switch (validation_type) {
      case "max":
        if (max_value !== undefined && value > max_value) {
          return `上限(${max_value}${unit || ""})を超えています`;
        }
        break;
      case "min":
        if (min_value !== undefined && value < min_value) {
          return `下限(${min_value}${unit || ""})を下回っています`;
        }
        break;
      case "range":
        if (min_value !== undefined && value < min_value) {
          return `範囲外です(${min_value}〜${max_value}${unit || ""})`;
        }
        if (max_value !== undefined && value > max_value) {
          return `範囲外です(${min_value}〜${max_value}${unit || ""})`;
        }
        break;
      case "exact":
        if (expected_value !== undefined && value !== expected_value) {
          return `期待値(${expected_value}${unit || ""})と一致しません`;
        }
        break;
      case "tolerance":
        if (base_value !== undefined && tolerance !== undefined) {
          const diff = Math.abs(value - base_value);
          if (diff > tolerance) {
            return `許容範囲外です(${base_value}±${tolerance}${unit || ""})`;
          }
        }
        break;
    }
    return null;
  };

  const validateAll = (): boolean => {
    const errors: Record<string, string> = {};

    for (const item of phase1Items) {
      const response = responses[item.id];

      // Check for completely missing responses on required items
      if (!response || response.checkbox_value === undefined && response.numeric_value === undefined && !response.text_value && !response.selection_value) {
        if (item.is_required) {
          errors[item.id] = "回答してください";
        }
        continue;
      }

      // Check checkbox items have been answered (not left as undefined)
      if (item.item_type === "checkbox" && item.is_required && response.checkbox_value === undefined) {
        errors[item.id] = "OK/NGを選択してください";
      }

      // Check numeric items have been answered
      if (item.item_type === "numeric" && item.is_required && (response.numeric_value === undefined || response.numeric_value === null)) {
        errors[item.id] = "値を入力してください";
      }

      // Existing numeric validation (only if a value is provided)
      if (item.item_type === "numeric" && item.numeric_validation && response.numeric_value !== undefined && response.numeric_value !== null) {
        const error = validateNumeric(response.numeric_value, item.numeric_validation);
        if (error) {
          errors[item.id] = error;
        }
      }

      if (item.item_type === "text" && item.is_required && !response.text_value?.trim()) {
        errors[item.id] = "入力してください";
      }

      if (item.item_type === "selection" && item.is_required && !response.selection_value) {
        errors[item.id] = "選択してください";
      }

    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  /** Check for expected_answer mismatches (NG is correct but user selected OK) */
  const getExpectedAnswerMismatches = (): string[] => {
    const mismatched: string[] = [];
    for (const item of phase1Items) {
      if (item.item_type !== "checkbox" || item.expected_answer !== "ng") continue;
      const response = responses[item.id];
      if (response?.checkbox_value === true) {
        mismatched.push(item.topic);
      }
    }
    return mismatched;
  };

  const handleSave = async () => {
    await onSave(Object.values(responses));
  };

  const handleComplete = async () => {
    if (!validateAll()) {
      return;
    }

    // Warn about expected_answer mismatches (alert, not block)
    const mismatches = getExpectedAnswerMismatches();
    if (mismatches.length > 0) {
      const confirmed = window.confirm(
        `以下の項目はNGが正しい回答ですが、OKと回答しています:\n\n` +
        mismatches.map((t) => `・${t}`).join("\n") +
        `\n\nこのまま進む場合、AI確認フェーズで理由を確認されます。\n続けますか？`
      );
      if (!confirmed) return;
    }

    await onSave(Object.values(responses));
    await onComplete();
  };

  const getItemStatus = (item: CheckItem): "ok" | "ng" | "warning" | "pending" => {
    const response = responses[item.id];
    if (!response) return "pending";

    if (item.item_type === "checkbox") {
      if (response.checkbox_value === undefined) return "pending";
      // Trap questions: always show as "ok" visually (no hint to user)
      if (item.expected_answer === "ng") return "ok";
      return isCheckboxProblem(response.checkbox_value) ? "ng" : "ok";
    }

    if (item.item_type === "numeric") {
      if (response.numeric_value === undefined) return "pending";
      if (item.numeric_validation) {
        const error = validateNumeric(response.numeric_value, item.numeric_validation);
        if (error) return "ng";
      }
      return "ok";
    }

    if (item.item_type === "text") {
      if (!response.text_value?.trim()) return "pending";
      return "ok";
    }

    if (item.item_type === "selection") {
      if (!response.selection_value) return "pending";
      return "ok";
    }

    if (validationErrors[item.id]) {
      return "ng";
    }

    return "pending";
  };

  return (
    <div className="space-y-4">
      {/* Items list */}
      <div className="space-y-3">
        {phase1Items.map((item, index) => {
          const response = responses[item.id];
          const status = getItemStatus(item);
          const error = validationErrors[item.id];

          return (
            <div
              key={item.id}
              className={clsx(
                "card p-4 border-l-4 transition-colors",
                status === "ok" && "border-l-green-500",
                status === "ng" && "border-l-red-500",
                status === "warning" && "border-l-amber-500",
                status === "pending" && "border-l-gray-300"
              )}
            >
              <div className="flex items-start gap-3">
                <span className="text-sm font-medium text-[#5f6368] min-w-[24px]">
                  {index + 1}.
                </span>
                <div className="flex-1 space-y-2">
                  <div className="font-medium text-[#202124]">{item.topic}</div>
                  <div className="text-sm text-[#5f6368]">{item.main_question}</div>

                  {/* Input based on item type */}
                  <div className="mt-3">
                    {item.item_type === "checkbox" && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-4">
                          <button
                            type="button"
                            onClick={() => updateResponse(item.id, "checkbox", true)}
                            className={clsx(
                              "px-4 py-2 rounded-lg font-medium transition-colors",
                              response?.checkbox_value === true
                                ? "bg-green-600 text-white"
                                : "bg-[#f1f3f4] text-[#5f6368] hover:bg-[#e8eaed]"
                            )}
                          >
                            OK
                          </button>
                          <button
                            type="button"
                            onClick={() => updateResponse(item.id, "checkbox", false)}
                            className={clsx(
                              "px-4 py-2 rounded-lg font-medium transition-colors",
                              response?.checkbox_value === false
                                ? "bg-red-600 text-white"
                                : "bg-[#f1f3f4] text-[#5f6368] hover:bg-[#e8eaed]"
                            )}
                          >
                            NG
                          </button>
                        </div>

                        {/* NG Details - shown when NG is pressed, but NOT for trap questions (expected_answer="ng") */}
                        {response?.checkbox_value !== undefined && isCheckboxProblem(response.checkbox_value) && item.expected_answer !== "ng" && (
                          <div className="ml-0 p-3 bg-red-50 border border-red-200 rounded-lg space-y-3 animate-in slide-in-from-top-2 duration-200">
                            <div className="text-sm font-medium text-red-800">
                              問題の詳細を入力してください
                            </div>

                            {/* Status selection */}
                            <div className="flex flex-wrap gap-2">
                              {NG_STATUS_OPTIONS.map((option) => (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => updateNGDetails(item.id, "ng_status", option.value)}
                                  className={clsx(
                                    "px-3 py-1.5 text-sm rounded-full transition-colors",
                                    response.ng_status === option.value
                                      ? "bg-red-600 text-white"
                                      : "bg-white text-red-700 border border-red-300 hover:bg-red-100"
                                  )}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>

                            {/* Detail text */}
                            <textarea
                              value={response.ng_detail || ""}
                              onChange={(e) => updateNGDetails(item.id, "ng_detail", e.target.value)}
                              placeholder="具体的な状況を入力（例：どこで発生？ どの程度？）"
                              className="input w-full text-sm bg-white"
                              rows={2}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {item.item_type === "numeric" && (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={response?.numeric_value ?? ""}
                          onChange={(e) =>
                            updateResponse(
                              item.id,
                              "numeric",
                              e.target.value ? parseFloat(e.target.value) : undefined
                            )
                          }
                          placeholder="数値を入力"
                          className={clsx(
                            "input w-40",
                            error && "border-red-500 focus:border-red-500 focus:ring-red-500"
                          )}
                          step="any"
                        />
                        {item.numeric_validation?.unit && (
                          <span className="text-sm text-[#5f6368]">
                            {item.numeric_validation.unit}
                          </span>
                        )}
                        {item.numeric_validation && (
                          <span className="text-xs text-[#9aa0a6]">
                            {item.numeric_validation.validation_type === "range" &&
                              `(${item.numeric_validation.min_value}〜${item.numeric_validation.max_value})`}
                            {item.numeric_validation.validation_type === "max" &&
                              `(〜${item.numeric_validation.max_value})`}
                            {item.numeric_validation.validation_type === "min" &&
                              `(${item.numeric_validation.min_value}〜)`}
                            {item.numeric_validation.validation_type === "exact" &&
                              `(${item.numeric_validation.expected_value})`}
                            {item.numeric_validation.validation_type === "tolerance" &&
                              `(${item.numeric_validation.base_value}±${item.numeric_validation.tolerance})`}
                          </span>
                        )}
                      </div>
                    )}

                    {item.item_type === "text" && (
                      <textarea
                        value={response?.text_value ?? ""}
                        onChange={(e) => updateResponse(item.id, "text", e.target.value)}
                        placeholder="テキストを入力"
                        className={clsx(
                          "input w-full",
                          error && "border-red-500 focus:border-red-500 focus:ring-red-500"
                        )}
                        rows={2}
                      />
                    )}

                    {item.item_type === "selection" && (
                      <select
                        value={response?.selection_value ?? ""}
                        onChange={(e) => updateResponse(item.id, "selection", e.target.value)}
                        className={clsx(
                          "input w-full max-w-xs",
                          error && "border-red-500 focus:border-red-500 focus:ring-red-500"
                        )}
                      >
                        <option value="">選択してください</option>
                        {item.selection_choices?.map((choice) => (
                          <option key={choice} value={choice}>
                            {choice}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Validation error */}
                  {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
                </div>

                {/* Status indicator */}
                <div className="flex-shrink-0">
                  {status === "pending" && (
                    <div className="size-6 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center">
                      <div className="size-2 rounded-full bg-gray-300" />
                    </div>
                  )}
                  {status === "ok" && (
                    <div className="size-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                  )}
                  {status === "ng" && (
                    <div className="size-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
                      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                      </svg>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* No Phase 1 items message */}
      {phase1Items.length === 0 && (
        <div className="text-center py-8 text-[#5f6368]">
          フォーム入力項目はありません。次のフェーズに進んでください。
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-[#dadce0]">
        <button
          type="button"
          onClick={onRestart}
          className="text-sm text-[#5f6368] hover:text-[#202124]"
        >
          最初からやり直す
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="btn btn-secondary"
          >
            {isSaving ? "保存中..." : "一時保存"}
          </button>
          <button
            type="button"
            onClick={handleComplete}
            disabled={isCompleting || phase1Items.length === 0}
            className="btn btn-primary"
          >
            {isCompleting ? "処理中..." : "次へ進む"}
          </button>
        </div>
      </div>
    </div>
  );
}
