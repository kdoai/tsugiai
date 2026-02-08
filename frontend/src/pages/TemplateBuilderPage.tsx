/**
 * Template Builder Page - AI-assisted template creation with file upload and manual editing
 * Updated for phase-based checkout with ItemType system
 */

import { useState, useRef, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { clsx } from "clsx";
import { templateApi } from "../services/handoverApi";
import type { ItemType, NumericValidationType, NumericValidation } from "../types/handover";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface TemplateItem {
  id?: string;
  topic: string;
  main_question: string;
  item_type: ItemType;
  expected_answer?: "ok" | "ng";
  numeric_validation?: NumericValidation;
  selection_choices?: string[];
  verification_prompt?: string;
  follow_up_hints?: string[];
  order?: number;
  fixed_position?: number;
  // Legacy fields (kept for backward compatibility)
  priority: string;
  category: string;
  is_required: boolean;
  needs_photo: boolean;
}

interface TemplateData {
  title: string;
  description: string;
  items: TemplateItem[];
  randomize_order: boolean;
}

type BuilderMode = "select" | "ai" | "file" | "manual" | "copy";

const ITEM_TYPE_OPTIONS: Array<{ value: ItemType; label: string; description: string }> = [
  { value: "checkbox", label: "チェック", description: "OK/NGの二択確認" },
  { value: "numeric", label: "数値入力", description: "数値を入力して検証" },
  { value: "text", label: "テキスト", description: "自由入力" },
  { value: "selection", label: "選択式", description: "選択肢から選ぶ" },
  { value: "photo", label: "写真確認", description: "写真撮影+AI判定" },
];

const NUMERIC_VALIDATION_OPTIONS: Array<{ value: NumericValidationType; label: string }> = [
  { value: "max", label: "上限" },
  { value: "min", label: "下限" },
  { value: "range", label: "範囲" },
  { value: "exact", label: "指定値" },
  { value: "tolerance", label: "許容差" },
];

export function TemplateBuilderPage() {
  const navigate = useNavigate();
  const { templateId } = useParams<{ templateId: string }>();
  const isEditMode = !!templateId;

  const [mode, setMode] = useState<BuilderMode>(isEditMode ? "manual" : "select");
  const [template, setTemplate] = useState<TemplateData>({
    title: "",
    description: "",
    randomize_order: false,
    items: [],
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);

  // AI chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // File upload state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Copy template state
  const [existingTemplates, setExistingTemplates] = useState<Array<{
    id: string;
    title: string;
    description: string;
    items: TemplateItem[];
  }>>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);

  // Load existing template when editing
  useEffect(() => {
    if (templateId) {
      loadTemplate(templateId);
    }
  }, [templateId]);

  const loadTemplate = async (id: string) => {
    setIsLoadingTemplate(true);
    try {
      const existingTemplate = await templateApi.get(id);
      setTemplate({
        title: existingTemplate.title,
        description: existingTemplate.description || "",
        randomize_order: existingTemplate.randomize_order || false,
        items: existingTemplate.items.map((item) => ({
          id: item.id,
          topic: item.topic,
          main_question: item.main_question,
          item_type: item.item_type || "checkbox",
          expected_answer: item.expected_answer,
          numeric_validation: item.numeric_validation,
          selection_choices: item.selection_choices,
          verification_prompt: item.verification_prompt,
          follow_up_hints: item.follow_up_hints,
          order: item.order,
          fixed_position: item.fixed_position,
          priority: item.priority,
          category: item.category,
          is_required: item.is_required,
          needs_photo: item.needs_photo,
        })),
      });
      setMode("manual");
    } catch (error) {
      console.error("Failed to load template:", error);
      alert("テンプレートの読み込みに失敗しました");
      navigate("/templates");
    } finally {
      setIsLoadingTemplate(false);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load existing templates for copying
  const loadExistingTemplates = async () => {
    setIsLoadingTemplates(true);
    try {
      const { templates } = await templateApi.list();
      setExistingTemplates(templates.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description || "",
        items: t.items.map(item => ({
          id: item.id,
          topic: item.topic,
          main_question: item.main_question,
          item_type: item.item_type || "checkbox",
          numeric_validation: item.numeric_validation,
          selection_choices: item.selection_choices,
          verification_prompt: item.verification_prompt,
          follow_up_hints: item.follow_up_hints,
          priority: item.priority,
          category: item.category,
          is_required: item.is_required,
          needs_photo: item.needs_photo,
        })),
      })));
    } catch (error) {
      console.error("Failed to load templates:", error);
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  // Copy a template
  const copyTemplate = (templateToCopy: typeof existingTemplates[0]) => {
    setTemplate({
      title: `${templateToCopy.title}（コピー）`,
      description: templateToCopy.description,
      randomize_order: false,
      items: templateToCopy.items.map((item, idx) => ({
        ...item,
        id: `item_${idx + 1}`,
      })),
    });
    setMode("manual");
  };

  // Start AI session
  const startAISession = async () => {
    setMode("ai");
    try {
      setIsLoading(true);
      const response = await templateApi.startTemplateBuilder();
      setSessionId(response.session_id);

      if (response.message) {
        setMessages([
          {
            id: "assistant-1",
            role: "assistant",
            content: response.message,
            timestamp: new Date(),
          },
        ]);
      }
    } catch (error) {
      console.error("Failed to start session:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Send message to AI
  const sendMessage = async (message: string) => {
    if (!message.trim() || !sessionId || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: message,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    try {
      const response = await templateApi.sendTemplateBuilderMessage(sessionId, message);

      if (response.session_id) {
        setSessionId(response.session_id);
      }

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: response.message,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      if (response.template && response.template.title && response.template.items) {
        setTemplate({
          title: response.template.title,
          description: response.template.description || "",
          randomize_order: false,
          items: response.template.items.map((item, idx) => ({
            ...item,
            id: `item_${idx + 1}`,
            item_type: (item as any).item_type || "checkbox",
            is_required: item.is_required ?? true,
            needs_photo: item.needs_photo ?? false,
          })),
        });
      }
    } catch (error) {
      console.error("Failed to send message:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsAnalyzing(true);
    setUploadError(null);

    try {
      const result = await templateApi.analyzeFile(file);

      if (result.success && result.template) {
        setTemplate({
          title: result.template.title || "",
          description: result.template.description || "",
          randomize_order: false,
          items: result.template.items.map((item, idx) => ({
            ...item,
            id: `item_${idx + 1}`,
            item_type: "checkbox" as ItemType,
            is_required: item.is_required ?? true,
            needs_photo: item.needs_photo ?? false,
          })),
        });
        setMode("manual");
      } else {
        setUploadError(result.error || "ファイルの解析に失敗しました");
      }
    } catch (error) {
      console.error("Failed to analyze file:", error);
      setUploadError("ファイルのアップロードに失敗しました");
    } finally {
      setIsAnalyzing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Manual editing functions
  const updateTemplateField = (field: keyof TemplateData, value: string) => {
    setTemplate((prev) => ({ ...prev, [field]: value }));
  };

  const addItem = () => {
    setTemplate((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          id: `item_${prev.items.length + 1}`,
          topic: "",
          main_question: "",
          item_type: "checkbox" as ItemType,
          priority: "P2",
          category: "other",
          is_required: true,
          needs_photo: false,
        },
      ],
    }));
  };

  const updateItem = (index: number, field: keyof TemplateItem, value: unknown) => {
    setTemplate((prev) => ({
      ...prev,
      items: prev.items.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      ),
    }));
  };

  const updateItemNumericValidation = (index: number, validation: Partial<NumericValidation>) => {
    setTemplate((prev) => ({
      ...prev,
      items: prev.items.map((item, i) =>
        i === index
          ? {
              ...item,
              numeric_validation: {
                ...item.numeric_validation,
                ...validation,
              } as NumericValidation,
            }
          : item
      ),
    }));
  };

  const addSelectionChoice = (index: number) => {
    setTemplate((prev) => ({
      ...prev,
      items: prev.items.map((item, i) =>
        i === index
          ? {
              ...item,
              selection_choices: [...(item.selection_choices || []), ""],
            }
          : item
      ),
    }));
  };

  const updateSelectionChoice = (itemIndex: number, choiceIndex: number, value: string) => {
    setTemplate((prev) => ({
      ...prev,
      items: prev.items.map((item, i) =>
        i === itemIndex
          ? {
              ...item,
              selection_choices: (item.selection_choices || []).map((c, ci) =>
                ci === choiceIndex ? value : c
              ),
            }
          : item
      ),
    }));
  };

  const removeSelectionChoice = (itemIndex: number, choiceIndex: number) => {
    setTemplate((prev) => ({
      ...prev,
      items: prev.items.map((item, i) =>
        i === itemIndex
          ? {
              ...item,
              selection_choices: (item.selection_choices || []).filter((_, ci) => ci !== choiceIndex),
            }
          : item
      ),
    }));
  };

  const removeItem = (index: number) => {
    setTemplate((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const moveItem = (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= template.items.length) return;

    setTemplate((prev) => {
      const items = [...prev.items];
      [items[index], items[newIndex]] = [items[newIndex], items[index]];
      return { ...prev, items };
    });
  };

  // Save template
  const handleSaveTemplate = async () => {
    if (!template.title.trim()) {
      alert("タイトルを入力してください");
      return;
    }
    if (template.items.length === 0) {
      alert("少なくとも1つの確認項目を追加してください");
      return;
    }

    setIsSaving(true);
    try {
      // Validate fixed position duplicates when randomize is enabled
      if (template.randomize_order) {
        const fixedPositions = template.items
          .map((item) => item.fixed_position)
          .filter((pos): pos is number => pos !== undefined && pos !== null);
        const uniquePositions = new Set(fixedPositions);
        if (uniquePositions.size !== fixedPositions.length) {
          alert("固定位置が重複しています。修正してください。");
          return;
        }
      }

      const itemsData = template.items.map((item, idx) => ({
        id: item.id || `item_${idx + 1}`,
        topic: item.topic,
        main_question: item.main_question,
        item_type: item.item_type,
        expected_answer: item.expected_answer || "ok",
        numeric_validation: item.numeric_validation,
        selection_choices: item.selection_choices,
        verification_prompt: item.verification_prompt,
        follow_up_hints: item.follow_up_hints || [],
        order: idx,
        fixed_position: item.fixed_position ?? null,
        priority: item.priority,
        category: item.category,
        is_required: item.is_required,
        needs_photo: item.item_type === "photo",
      }));

      if (isEditMode && templateId) {
        // Update existing template
        await templateApi.update(templateId, {
          title: template.title,
          description: template.description,
          items: itemsData as any,
          duration: 600,
          is_active: true,
          randomize_order: template.randomize_order,
        });
      } else {
        // Create new template
        await templateApi.create({
          title: template.title,
          description: template.description,
          items: itemsData,
          duration: 600,
          is_active: true,
          randomize_order: template.randomize_order,
        });
      }
      navigate("/templates");
    } catch (error) {
      console.error("Failed to save template:", error);
      alert("テンプレートの保存に失敗しました");
    } finally {
      setIsSaving(false);
    }
  };

  // Loading state for edit mode
  if (isLoadingTemplate) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="size-8 spinner" />
      </div>
    );
  }

  // Mode selection screen (only for new templates)
  if (mode === "select" && !isEditMode) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 pb-4 border-b border-[#dadce0]">
          <h1 className="text-xl font-semibold text-[#202124]">テンプレート作成</h1>
          <p className="text-sm text-[#5f6368] mt-1">
            作成方法を選択してください
          </p>
        </div>

        <div className="space-y-3">
          {/* AI Chat Option */}
          <button
            onClick={startAISession}
            className="w-full p-4 bg-white border border-[#dadce0] rounded-lg hover:border-primary-600 hover:bg-primary-50 transition-colors text-left group"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 bg-primary-100 text-primary-600 rounded-lg group-hover:bg-primary-200">
                <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-[#202124]">AIと会話して作成</h3>
                <p className="text-sm text-[#5f6368] mt-1">
                  業務内容を伝えると、AIが最適なチェックリストを提案します
                </p>
              </div>
            </div>
          </button>

          {/* File Upload Option */}
          <button
            onClick={() => setMode("file")}
            className="w-full p-4 bg-white border border-[#dadce0] rounded-lg hover:border-primary-600 hover:bg-primary-50 transition-colors text-left group"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 bg-green-100 text-green-600 rounded-lg group-hover:bg-green-200">
                <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-[#202124]">既存ファイルから作成</h3>
                <p className="text-sm text-[#5f6368] mt-1">
                  PDFまたは画像ファイルを読み込んでテンプレートを作成します
                </p>
              </div>
            </div>
          </button>

          {/* Copy Template Option */}
          <button
            onClick={() => {
              setMode("copy");
              loadExistingTemplates();
            }}
            className="w-full p-4 bg-white border border-[#dadce0] rounded-lg hover:border-primary-600 hover:bg-primary-50 transition-colors text-left group"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 bg-purple-100 text-purple-600 rounded-lg group-hover:bg-purple-200">
                <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-[#202124]">既存テンプレートをコピー</h3>
                <p className="text-sm text-[#5f6368] mt-1">
                  登録済みのテンプレートを基に新しいテンプレートを作成します
                </p>
              </div>
            </div>
          </button>

          {/* Manual Option */}
          <button
            onClick={() => setMode("manual")}
            className="w-full p-4 bg-white border border-[#dadce0] rounded-lg hover:border-primary-600 hover:bg-primary-50 transition-colors text-left group"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 bg-amber-100 text-amber-600 rounded-lg group-hover:bg-amber-200">
                <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-[#202124]">手動で作成</h3>
                <p className="text-sm text-[#5f6368] mt-1">
                  項目を1つずつ手動で入力してテンプレートを作成します
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // Copy template selection screen
  if (mode === "copy") {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 pb-4 border-b border-[#dadce0]">
          <button
            onClick={() => setMode("select")}
            className="text-sm text-[#5f6368] hover:text-[#202124] mb-2 flex items-center gap-1"
          >
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            戻る
          </button>
          <h1 className="text-xl font-semibold text-[#202124]">テンプレートをコピー</h1>
          <p className="text-sm text-[#5f6368] mt-1">
            コピー元のテンプレートを選択してください
          </p>
        </div>

        {isLoadingTemplates ? (
          <div className="flex items-center justify-center py-12">
            <div className="size-8 spinner" />
          </div>
        ) : existingTemplates.length === 0 ? (
          <div className="text-center py-12">
            <svg className="size-12 mx-auto mb-3 text-[#9aa0a6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-[#5f6368]">コピー可能なテンプレートがありません</p>
            <button
              onClick={() => setMode("manual")}
              className="mt-4 btn btn-primary"
            >
              手動で作成する
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {existingTemplates.map((t) => (
              <button
                key={t.id}
                onClick={() => copyTemplate(t)}
                className="w-full p-4 bg-white border border-[#dadce0] rounded-lg hover:border-primary-600 hover:bg-primary-50 transition-colors text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <h3 className="font-medium text-[#202124]">{t.title}</h3>
                    {t.description && (
                      <p className="text-sm text-[#5f6368] mt-1 line-clamp-2">{t.description}</p>
                    )}
                    <p className="text-xs text-[#9aa0a6] mt-2">{t.items.length}項目</p>
                  </div>
                  <div className="p-2 text-primary-600">
                    <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // File upload screen
  if (mode === "file") {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 pb-4 border-b border-[#dadce0]">
          <button
            onClick={() => setMode("select")}
            className="text-sm text-[#5f6368] hover:text-[#202124] mb-2 flex items-center gap-1"
          >
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            戻る
          </button>
          <h1 className="text-xl font-semibold text-[#202124]">ファイルから作成</h1>
          <p className="text-sm text-[#5f6368] mt-1">
            既存のチェックリストファイルをアップロードしてください
          </p>
        </div>

        <div className="bg-white border border-[#dadce0] rounded-lg p-6">
          <div
            className={clsx(
              "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
              isAnalyzing ? "border-primary-300 bg-primary-50" : "border-[#dadce0] hover:border-primary-300"
            )}
          >
            {isAnalyzing ? (
              <div>
                <div className="size-8 spinner mx-auto mb-3" />
                <p className="text-[#5f6368]">ファイルを解析中...</p>
              </div>
            ) : (
              <>
                <svg className="size-12 mx-auto mb-3 text-[#9aa0a6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-[#202124] font-medium mb-1">ファイルをドラッグ＆ドロップ</p>
                <p className="text-sm text-[#5f6368] mb-3">または</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn btn-primary"
                >
                  ファイルを選択
                </button>
                <p className="text-xs text-[#9aa0a6] mt-3">
                  対応形式: PDF, PNG, JPG
                </p>
              </>
            )}
          </div>

          {uploadError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-[#d93025]">
              {uploadError}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>
      </div>
    );
  }

  // AI chat + manual editing screen
  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4 pb-4 border-b border-[#dadce0] flex items-center justify-between">
        <div>
          <button
            onClick={() => isEditMode ? navigate("/templates") : setMode("select")}
            className="text-sm text-[#5f6368] hover:text-[#202124] mb-2 flex items-center gap-1"
          >
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {isEditMode ? "テンプレート一覧" : "戻る"}
          </button>
          <h1 className="text-xl font-semibold text-[#202124]">
            {isEditMode
              ? "テンプレートを編集"
              : mode === "ai"
              ? "AIでテンプレート作成"
              : "テンプレート作成"}
          </h1>
        </div>
        {mode === "ai" && !isEditMode && (
          <button
            onClick={() => setMode("manual")}
            className="text-sm text-primary-600 hover:text-primary-700"
          >
            手動編集に切り替え
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-[380px_1fr] gap-4">
        {/* Left: AI Chat or Manual Input */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {mode === "ai" ? (
            <div className="card flex flex-col h-[500px] lg:max-h-[calc(100vh-120px)]">
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 ${
                        message.role === "user"
                          ? "bg-primary-100 text-primary-900 border border-primary-200"
                          : "bg-[#f1f3f4] text-[#202124]"
                      }`}
                    >
                      <div className="prose prose-sm max-w-none text-sm">
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-[#f1f3f4] rounded-lg px-3 py-2">
                      <div className="flex gap-1">
                        <div className="size-1.5 bg-[#9aa0a6] rounded-full animate-bounce" />
                        <div className="size-1.5 bg-[#9aa0a6] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <div className="size-1.5 bg-[#9aa0a6] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              <div className="border-t border-[#dadce0] p-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage(inputValue)}
                    placeholder="メッセージを入力..."
                    className="input flex-1 text-sm"
                    disabled={isLoading}
                  />
                  <button
                    onClick={() => sendMessage(inputValue)}
                    disabled={!inputValue.trim() || isLoading}
                    className="btn btn-primary px-3"
                  >
                    <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="card p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#202124] mb-1.5">
                  タイトル <span className="text-[#d93025]">*</span>
                </label>
                <input
                  type="text"
                  value={template.title}
                  onChange={(e) => updateTemplateField("title", e.target.value)}
                  placeholder="例: 工場終業時チェックリスト"
                  className="input text-base py-2.5"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#202124] mb-1.5">
                  説明
                </label>
                <textarea
                  value={template.description}
                  onChange={(e) => updateTemplateField("description", e.target.value)}
                  placeholder="テンプレートの説明を入力..."
                  className="input text-sm py-2.5 leading-relaxed"
                  rows={4}
                />
              </div>
              <div className="pt-3 border-t border-[#e8eaed]">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={template.randomize_order}
                    onChange={(e) =>
                      setTemplate((prev) => ({ ...prev, randomize_order: e.target.checked }))
                    }
                    className="mt-0.5 rounded text-primary-600 focus:ring-primary-500"
                  />
                  <div>
                    <span className="text-sm text-[#202124]">確認項目の順番をランダムにする</span>
                    <p className="text-xs text-[#9aa0a6]">
                      形骸化防止のため、チェックアウト時の表示順をランダムにします
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Template title and description editor for AI mode */}
          {mode === "ai" && template.items.length > 0 && (
            <div className="card p-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#5f6368] mb-1">
                  テンプレート名
                </label>
                <input
                  type="text"
                  value={template.title}
                  onChange={(e) => updateTemplateField("title", e.target.value)}
                  placeholder="テンプレート名を入力..."
                  className="input text-sm py-2"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#5f6368] mb-1">
                  説明
                </label>
                <textarea
                  value={template.description}
                  onChange={(e) => updateTemplateField("description", e.target.value)}
                  placeholder="テンプレートの説明を入力..."
                  className="input text-sm py-2 leading-relaxed"
                  rows={2}
                />
              </div>
              <div className="pt-2 border-t border-[#e8eaed]">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={template.randomize_order}
                    onChange={(e) =>
                      setTemplate((prev) => ({ ...prev, randomize_order: e.target.checked }))
                    }
                    className="mt-0.5 rounded text-primary-600 focus:ring-primary-500"
                  />
                  <div>
                    <span className="text-sm text-[#202124]">順番をランダムにする</span>
                    <p className="text-xs text-[#9aa0a6]">
                      形骸化防止のため表示順をランダムに
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Quick suggestions for AI mode */}
          {mode === "ai" && messages.length <= 1 && (
            <div className="card p-3">
              <p className="text-xs text-[#5f6368] mb-2">クイックスタート:</p>
              <div className="flex flex-wrap gap-2">
                {[
                  "製造業の作業終了チェック",
                  "小売店の閉店確認",
                  "オフィスの退勤チェック",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => sendMessage(`${suggestion}を作成したい`)}
                    disabled={isLoading}
                    className="px-3 py-1.5 text-xs bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#5f6368] rounded-full"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Template Preview/Editor */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-[#202124]">
              確認項目 ({template.items.length})
            </h3>
            <button
              onClick={addItem}
              className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              項目を追加
            </button>
          </div>

          <div className="space-y-3 max-h-[70vh] overflow-y-auto">
            {template.items.length === 0 ? (
              <div className="text-center py-8 text-[#9aa0a6]">
                <svg className="size-10 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="text-sm">確認項目がありません</p>
                <button
                  onClick={addItem}
                  className="mt-2 text-sm text-primary-600 hover:text-primary-700"
                >
                  + 項目を追加
                </button>
              </div>
            ) : (
              template.items.map((item, index) => (
                <div key={item.id || index} className="p-3 bg-[#f8f9fa] border border-[#dadce0] rounded-lg">
                  <div className="flex items-start gap-2 mb-2">
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => moveItem(index, "up")}
                        disabled={index === 0}
                        className="p-0.5 text-[#9aa0a6] hover:text-[#5f6368] disabled:opacity-30"
                      >
                        <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => moveItem(index, "down")}
                        disabled={index === template.items.length - 1}
                        className="p-0.5 text-[#9aa0a6] hover:text-[#5f6368] disabled:opacity-30"
                      >
                        <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                    <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        value={item.topic}
                        onChange={(e) => updateItem(index, "topic", e.target.value)}
                        placeholder="項目名"
                        className="input text-sm py-1"
                      />
                      <input
                        type="text"
                        value={item.main_question}
                        onChange={(e) => updateItem(index, "main_question", e.target.value)}
                        placeholder="確認する質問"
                        className="input text-sm py-1"
                      />

                      {/* Item Type Selection */}
                      <div className="flex flex-wrap gap-2 items-center">
                        <select
                          value={item.item_type}
                          onChange={(e) => updateItem(index, "item_type", e.target.value as ItemType)}
                          className="input text-xs py-1 w-32"
                        >
                          {ITEM_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <span className="text-xs text-[#9aa0a6]">
                          {ITEM_TYPE_OPTIONS.find((o) => o.value === item.item_type)?.description}
                        </span>
                        {item.item_type === "checkbox" && (
                          <label className="flex items-center gap-1 cursor-pointer ml-1">
                            <input
                              type="checkbox"
                              checked={item.expected_answer === "ng"}
                              onChange={(e) =>
                                updateItem(index, "expected_answer", e.target.checked ? "ng" : "ok")
                              }
                              className="rounded text-primary-600 focus:ring-primary-500"
                            />
                            <span className="text-xs text-[#5f6368]">NGが正</span>
                          </label>
                        )}
                      </div>
                      {template.randomize_order && (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-[#9aa0a6]">表示位置:</span>
                          <select
                            value={item.fixed_position ?? ""}
                            onChange={(e) =>
                              updateItem(
                                index,
                                "fixed_position",
                                e.target.value ? parseInt(e.target.value) : undefined
                              )
                            }
                            className="input text-xs py-1 w-28"
                          >
                            <option value="">ランダム</option>
                            {Array.from({ length: template.items.length }, (_, i) => i + 1).map(
                              (pos) => (
                                <option
                                  key={pos}
                                  value={pos}
                                  disabled={template.items.some(
                                    (other, otherIdx) =>
                                      otherIdx !== index && other.fixed_position === pos
                                  )}
                                >
                                  {pos}番目
                                </option>
                              )
                            )}
                          </select>
                        </div>
                      )}

                      {/* Numeric Validation Settings */}
                      {item.item_type === "numeric" && (
                        <div className="p-2 bg-white rounded border border-[#e8eaed] space-y-2">
                          <div className="flex items-center gap-2">
                            <select
                              value={item.numeric_validation?.validation_type || "range"}
                              onChange={(e) =>
                                updateItemNumericValidation(index, {
                                  validation_type: e.target.value as NumericValidationType,
                                })
                              }
                              className="input text-xs py-1 w-24"
                            >
                              {NUMERIC_VALIDATION_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>

                            {(item.numeric_validation?.validation_type === "min" ||
                              item.numeric_validation?.validation_type === "range") && (
                              <input
                                type="number"
                                value={item.numeric_validation?.min_value ?? ""}
                                onChange={(e) =>
                                  updateItemNumericValidation(index, {
                                    min_value: e.target.value ? parseFloat(e.target.value) : undefined,
                                  })
                                }
                                placeholder="最小値"
                                className="input text-xs py-1 w-20"
                              />
                            )}

                            {(item.numeric_validation?.validation_type === "max" ||
                              item.numeric_validation?.validation_type === "range") && (
                              <input
                                type="number"
                                value={item.numeric_validation?.max_value ?? ""}
                                onChange={(e) =>
                                  updateItemNumericValidation(index, {
                                    max_value: e.target.value ? parseFloat(e.target.value) : undefined,
                                  })
                                }
                                placeholder="最大値"
                                className="input text-xs py-1 w-20"
                              />
                            )}

                            {item.numeric_validation?.validation_type === "exact" && (
                              <input
                                type="number"
                                value={item.numeric_validation?.expected_value ?? ""}
                                onChange={(e) =>
                                  updateItemNumericValidation(index, {
                                    expected_value: e.target.value
                                      ? parseFloat(e.target.value)
                                      : undefined,
                                  })
                                }
                                placeholder="期待値"
                                className="input text-xs py-1 w-20"
                              />
                            )}

                            {item.numeric_validation?.validation_type === "tolerance" && (
                              <>
                                <input
                                  type="number"
                                  value={item.numeric_validation?.base_value ?? ""}
                                  onChange={(e) =>
                                    updateItemNumericValidation(index, {
                                      base_value: e.target.value
                                        ? parseFloat(e.target.value)
                                        : undefined,
                                    })
                                  }
                                  placeholder="基準値"
                                  className="input text-xs py-1 w-20"
                                />
                                <span className="text-xs text-[#5f6368]">±</span>
                                <input
                                  type="number"
                                  value={item.numeric_validation?.tolerance ?? ""}
                                  onChange={(e) =>
                                    updateItemNumericValidation(index, {
                                      tolerance: e.target.value
                                        ? parseFloat(e.target.value)
                                        : undefined,
                                    })
                                  }
                                  placeholder="許容差"
                                  className="input text-xs py-1 w-20"
                                />
                              </>
                            )}

                            <input
                              type="text"
                              value={item.numeric_validation?.unit ?? ""}
                              onChange={(e) =>
                                updateItemNumericValidation(index, { unit: e.target.value })
                              }
                              placeholder="単位"
                              className="input text-xs py-1 w-16"
                            />
                          </div>
                        </div>
                      )}

                      {/* Selection Choices */}
                      {item.item_type === "selection" && (
                        <div className="p-2 bg-white rounded border border-[#e8eaed] space-y-2">
                          <div className="text-xs text-[#5f6368] mb-1">選択肢:</div>
                          {(item.selection_choices || []).map((choice, ci) => (
                            <div key={ci} className="flex items-center gap-2">
                              <input
                                type="text"
                                value={choice}
                                onChange={(e) => updateSelectionChoice(index, ci, e.target.value)}
                                placeholder={`選択肢 ${ci + 1}`}
                                className="input text-xs py-1 flex-1"
                              />
                              <button
                                onClick={() => removeSelectionChoice(index, ci)}
                                className="p-1 text-[#9aa0a6] hover:text-[#d93025]"
                              >
                                <svg
                                  className="size-3"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M6 18L18 6M6 6l12 12"
                                  />
                                </svg>
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => addSelectionChoice(index)}
                            className="text-xs text-primary-600 hover:text-primary-700"
                          >
                            + 選択肢を追加
                          </button>
                        </div>
                      )}

                      {/* Photo Verification Prompt */}
                      {item.item_type === "photo" && (
                        <div className="p-2 bg-white rounded border border-[#e8eaed]">
                          <div className="text-xs text-[#5f6368] mb-1">AI判定ポイント:</div>
                          <input
                            type="text"
                            value={item.verification_prompt || ""}
                            onChange={(e) => updateItem(index, "verification_prompt", e.target.value)}
                            placeholder="例: 機器の電源がOFFになっていること"
                            className="input text-xs py-1"
                          />
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => removeItem(index)}
                      className="p-1 text-[#9aa0a6] hover:text-[#d93025]"
                    >
                      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Save button */}
          {(template.title || template.items.length > 0) && (
            <div className="mt-4 pt-4 border-t border-[#dadce0]">
              <button
                onClick={handleSaveTemplate}
                disabled={isSaving || !template.title.trim() || template.items.length === 0}
                className="btn btn-primary w-full"
              >
                {isSaving
                  ? (isEditMode ? "更新中..." : "保存中...")
                  : (isEditMode ? "テンプレートを更新" : "テンプレートを保存")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
