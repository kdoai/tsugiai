/**
 * API client for the Handover Checklist System
 */

import type {
  ChecklistTemplate,
  CheckoutSession,
  HandoverNote,
  Comment,
  Attachment,
  StartCheckoutResponse,
  SendCheckoutMessageResponse,
  TemplateBuilderResponse,
  VoiceGreetingResponse,
  ItemType,
  Phase1SaveResponse,
  PhaseCompleteResponse,
  PhotoUploadResponse,
  PhotoVerifyResponse,
  Phase3StartResponse,
  SessionCompleteResponse,
  SessionRestartResponse,
  CancelHandoverResponse,
  InboxItem,
  InboxListResponse,
  InboxCountResponse,
  InboxFilters,
  ActionItem,
} from "../types/handover";
import { getIdToken } from "../lib/firebase";

// Use environment variable for API URL
const HANDOVER_API_BASE = import.meta.env.VITE_HANDOVER_API_URL
  ? `${import.meta.env.VITE_HANDOVER_API_URL}/api`
  : "http://localhost:8080/api";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Fetch JSON with authentication (for protected endpoints)
 * Automatically adds Bearer token to Authorization header
 */
async function fetchWithAuth<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const token = await getIdToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Copy existing headers if any
  if (options?.headers) {
    const existingHeaders = options.headers as Record<string, string>;
    Object.keys(existingHeaders).forEach((key) => {
      headers[key] = existingHeaders[key];
    });
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch {
    // Network error (e.g. cold start) — retry once
    response = await fetch(url, { ...options, headers });
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(response.status, error.error || error.detail || "Request failed");
  }

  return response.json();
}

/**
 * Fetch with authentication for FormData (file uploads)
 */
async function fetchFormDataWithAuth(
  url: string,
  formData: FormData,
  method: string = "POST"
): Promise<Response> {
  const token = await getIdToken();
  const headers: HeadersInit = {};

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url, { method, headers, body: formData });
  } catch {
    // Network error (e.g. cold start) — retry once
    response = await fetch(url, { method, headers, body: formData });
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(response.status, error.error || error.detail || "Request failed");
  }

  return response;
}

// Template APIs (protected - require authentication)
export const templateApi = {
  listTemplates: async (): Promise<ChecklistTemplate[]> => {
    const result = await fetchWithAuth<{ templates: ChecklistTemplate[] }>(`${HANDOVER_API_BASE}/templates`);
    return result.templates || [];
  },

  list: async (): Promise<{ templates: ChecklistTemplate[] }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/templates`);
  },

  get: async (id: string): Promise<ChecklistTemplate> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/templates/${id}`);
  },

  createTemplate: async (data: Partial<ChecklistTemplate>): Promise<{ success: boolean; template_id: string; template: ChecklistTemplate }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/templates`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  create: async (data: {
    title: string;
    description: string;
    duration: number;
    items: Array<{
      id?: string;
      topic: string;
      main_question: string;
      follow_up_hints?: string[];
      priority?: string;
      category?: string;
      is_required?: boolean;
      needs_photo?: boolean;
    }>;
    knowledge_context?: string;
    is_active?: boolean;
    randomize_order?: boolean;
  }): Promise<{ success: boolean; template_id: string; template: ChecklistTemplate }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/templates`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  deleteTemplate: async (id: string): Promise<{ success: boolean }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/templates/${id}`, {
      method: "DELETE",
    });
  },

  update: async (
    id: string,
    data: Partial<ChecklistTemplate>
  ): Promise<{ success: boolean; template: ChecklistTemplate }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  analyzeFile: async (
    file: File
  ): Promise<{
    success: boolean;
    template?: {
      title: string;
      description: string;
      items: Array<{
        topic: string;
        main_question: string;
        priority: string;
        category: string;
        is_required: boolean;
        needs_photo: boolean;
      }>;
    };
    error?: string;
    source_file?: string;
  }> => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetchFormDataWithAuth(
      `${HANDOVER_API_BASE}/templates/analyze-file`,
      formData
    );

    return response.json();
  },

  startTemplateBuilder: async (): Promise<{ session_id: string; message: string }> => {
    // No separate start endpoint - return initial greeting
    return {
      session_id: `builder-${Date.now()}`,
      message: "こんにちは！チェックリストテンプレートの作成をお手伝いします。\n\nどのような業務のチェックリストを作成したいですか？例えば：\n- 工場の作業終了チェック\n- オフィスの退勤前確認\n- 店舗の閉店作業\n\nなど、具体的な業務内容を教えてください。",
    };
  },

  sendTemplateBuilderMessage: async (
    sessionId: string,
    message: string
  ): Promise<TemplateBuilderResponse> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/builder/chat`, {
      method: "POST",
      body: JSON.stringify({ message, session_id: sessionId }),
    });
  },
};

// Checkout Session APIs (protected - require authentication)
export const checkoutApi = {
  listSessions: async (): Promise<{
    sessions: Array<{
      id: string;
      template_id: string;
      operator_name: string;
      next_operator_name: string;
      status: string;
      current_phase: number;
      started_at: string;
      item_count: number;
    }>;
  }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions`);
  },

  start: async (data: {
    template_id: string;
    operator_id: string;
    operator_name?: string;
    next_operator_id?: string;
    next_operator_name?: string;
  }): Promise<StartCheckoutResponse> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  get: async (id: string): Promise<CheckoutSession> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions/${id}`);
  },

  deleteSession: async (id: string): Promise<{ success: boolean; message: string }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions/${id}`, {
      method: "DELETE",
    });
  },

  sendMessage: async (
    sessionId: string,
    message: string,
    options: { skipLog?: boolean; skipUserOnly?: boolean } = {}
  ): Promise<SendCheckoutMessageResponse> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        message,
        skip_log: options.skipLog ?? false,
        skip_user_only: options.skipUserOnly ?? false,
      }),
    });
  },

  sendVoice: async (
    sessionId: string,
    audioBlob: Blob,
    encoding: string = "WEBM_OPUS",
    sampleRate: number = 48000
  ): Promise<SendCheckoutMessageResponse> => {
    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.webm");
    formData.append("encoding", encoding);
    formData.append("sample_rate", sampleRate.toString());

    const response = await fetchFormDataWithAuth(
      `${HANDOVER_API_BASE}/sessions/${sessionId}/voice`,
      formData
    );

    return response.json();
  },

  getTurns: async (sessionId: string): Promise<{ turns: Array<{
    id: string;
    role: string;
    content: string;
    quick_replies?: string[];
    timestamp: string;
  }> }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions/${sessionId}/turns`);
  },

  uploadAttachment: async (
    sessionId: string,
    file: File,
    itemId: string
  ): Promise<{ success: boolean; attachment_id: string; storage_url: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("item_id", itemId);

    const response = await fetchFormDataWithAuth(
      `${HANDOVER_API_BASE}/sessions/${sessionId}/attachments`,
      formData
    );

    return response.json();
  },

  getAttachments: async (sessionId: string): Promise<{ attachments: Attachment[] }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions/${sessionId}/attachments`);
  },

  // Voice call mode APIs
  getVoiceGreeting: async (sessionId: string): Promise<VoiceGreetingResponse> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions/${sessionId}/voice-greeting`);
  },

  sendVoiceCall: async (
    sessionId: string,
    audioBlob: Blob,
    encoding: string = "WEBM_OPUS",
    sampleRate: number = 48000
  ): Promise<SendCheckoutMessageResponse> => {
    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.webm");
    formData.append("encoding", encoding);
    formData.append("sample_rate", sampleRate.toString());

    const response = await fetchFormDataWithAuth(
      `${HANDOVER_API_BASE}/sessions/${sessionId}/voice-call`,
      formData
    );

    return response.json();
  },

  // ==================== Phase-based Checkout APIs ====================

  // Phase 1: Save form responses
  phase1Save: async (
    sessionId: string,
    responses: Array<{
      item_id: string;
      item_type: ItemType;
      checkbox_value?: boolean;
      numeric_value?: number;
      text_value?: string;
      selection_value?: string;
    }>
  ): Promise<Phase1SaveResponse> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions/${sessionId}/phase1/save`, {
      method: "POST",
      body: JSON.stringify({ responses }),
    });
  },

  // Phase 1: Complete and move to Phase 2
  phase1Complete: async (sessionId: string): Promise<PhaseCompleteResponse> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions/${sessionId}/phase1/complete`, {
      method: "POST",
    });
  },

  // Phase 2: Upload photo
  phase2Upload: async (
    sessionId: string,
    file: File,
    itemId: string
  ): Promise<PhotoUploadResponse> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("item_id", itemId);

    const response = await fetchFormDataWithAuth(
      `${HANDOVER_API_BASE}/sessions/${sessionId}/phase2/upload`,
      formData
    );

    return response.json();
  },

  // Phase 2: Verify photo with AI
  phase2Verify: async (
    sessionId: string,
    itemId: string
  ): Promise<PhotoVerifyResponse> => {
    return fetchWithAuth(
      `${HANDOVER_API_BASE}/sessions/${sessionId}/phase2/verify?item_id=${itemId}`,
      { method: "POST" }
    );
  },

  // Phase 2: Complete and move to Phase 3
  phase2Complete: async (sessionId: string): Promise<PhaseCompleteResponse> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions/${sessionId}/phase2/complete`, {
      method: "POST",
    });
  },

  // Phase 3: Start with mode selection
  phase3Start: async (
    sessionId: string,
    mode: "chat" | "voice"
  ): Promise<Phase3StartResponse> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions/${sessionId}/phase3/start`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
  },

  // Phase 3: Complete and move to review
  phase3Complete: async (sessionId: string): Promise<PhaseCompleteResponse> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions/${sessionId}/phase3/complete`, {
      method: "POST",
    });
  },

  // Phase 4: Update summary
  updateSummary: async (
    sessionId: string,
    summaryMarkdown: string
  ): Promise<{ success: boolean }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions/${sessionId}/summary`, {
      method: "PUT",
      body: JSON.stringify({ summary_markdown: summaryMarkdown }),
    });
  },

  // Phase 4: Update action items
  updateActionItems: async (
    sessionId: string,
    actionItems: ActionItem[]
  ): Promise<{ success: boolean }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions/${sessionId}/action-items`, {
      method: "PUT",
      body: JSON.stringify({ action_items: actionItems }),
    });
  },

  // Complete the checkout flow
  completeSession: async (sessionId: string): Promise<SessionCompleteResponse> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions/${sessionId}/complete`, {
      method: "POST",
    });
  },

  // Restart session from Phase 1
  restartSession: async (sessionId: string): Promise<SessionRestartResponse> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions/${sessionId}/restart`, {
      method: "POST",
    });
  },

  // Go back to previous phase
  goBack: async (sessionId: string): Promise<{ success: boolean; previous_phase?: number; message?: string }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/sessions/${sessionId}/go-back`, {
      method: "POST",
    });
  },
};

// Handover APIs (protected - require authentication)
export const handoverApi = {
  listHandovers: async (limit?: number): Promise<HandoverNote[]> => {
    const params = new URLSearchParams();
    if (limit) params.append("limit", limit.toString());
    const queryString = params.toString();
    const url = queryString
      ? `${HANDOVER_API_BASE}/handovers?${queryString}`
      : `${HANDOVER_API_BASE}/handovers`;
    const result = await fetchWithAuth<{ handovers: HandoverNote[] }>(url);
    return result.handovers || [];
  },

  list: async (params?: {
    operator_id?: string;
    next_operator_id?: string;
    limit?: number;
  }): Promise<{ handovers: HandoverNote[] }> => {
    const searchParams = new URLSearchParams();
    if (params?.operator_id) searchParams.append("operator_id", params.operator_id);
    if (params?.next_operator_id) searchParams.append("next_operator_id", params.next_operator_id);
    if (params?.limit) searchParams.append("limit", params.limit.toString());

    const queryString = searchParams.toString();
    const url = queryString
      ? `${HANDOVER_API_BASE}/handovers?${queryString}`
      : `${HANDOVER_API_BASE}/handovers`;

    return fetchWithAuth(url);
  },

  get: async (id: string): Promise<HandoverNote> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/handovers/${id}`);
  },

  confirm: async (id: string): Promise<{ success: boolean; message: string }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/handovers/${id}/confirm`, {
      method: "POST",
    });
  },

  addComment: async (
    handoverId: string,
    data: {
      author_id: string;
      author_name: string;
      content: string;
    }
  ): Promise<{ success: boolean; comment_id: string }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/handovers/${handoverId}/comments`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  getComments: async (handoverId: string): Promise<{ comments: Comment[] }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/handovers/${handoverId}/comments`);
  },

  resolveComment: async (
    handoverId: string,
    commentId: string
  ): Promise<{ success: boolean; message: string }> => {
    return fetchWithAuth(
      `${HANDOVER_API_BASE}/handovers/${handoverId}/comments/${commentId}/resolve`,
      { method: "POST" }
    );
  },

  // Cancel a handover (admin action)
  cancel: async (
    handoverId: string,
    reason?: string
  ): Promise<CancelHandoverResponse> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/handovers/${handoverId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },

  // Uncancel a handover (admin action)
  uncancel: async (handoverId: string): Promise<CancelHandoverResponse> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/handovers/${handoverId}/uncancel`, {
      method: "POST",
    });
  },

  // Delete a handover (admin action)
  delete: async (handoverId: string): Promise<{ success: boolean; message: string }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/handovers/${handoverId}`, {
      method: "DELETE",
    });
  },

  // Save action item response (next operator executes action)
  saveActionResponse: async (
    handoverId: string,
    response: {
      action_id: string;
      item_type: string;
      checkbox_value?: boolean;
      numeric_value?: number;
      text_value?: string;
      selection_value?: string;
      note?: string;
      completed_by: string;
      completed_by_name: string;
    }
  ): Promise<{ success: boolean; message: string }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/handovers/${handoverId}/action-responses`, {
      method: "POST",
      body: JSON.stringify(response),
    });
  },
};

// Template Builder APIs (protected - require authentication)
export const builderApi = {
  chat: async (
    message: string,
    sessionId?: string
  ): Promise<TemplateBuilderResponse> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/builder/chat`, {
      method: "POST",
      body: JSON.stringify({ message, session_id: sessionId }),
    });
  },
};

// Speech APIs (protected - require authentication)
export const speechApi = {
  transcribe: async (
    audioBlob: Blob,
    encoding: string = "WEBM_OPUS",
    sampleRate: number = 48000,
    languageCode: string = "ja-JP"
  ): Promise<{ success: boolean; transcript: string; confidence: number }> => {
    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.webm");
    formData.append("encoding", encoding);
    formData.append("sample_rate", sampleRate.toString());
    formData.append("language_code", languageCode);

    const response = await fetchFormDataWithAuth(
      `${HANDOVER_API_BASE}/speech/transcribe`,
      formData
    );

    return response.json();
  },
};

// Inbox APIs (protected - require authentication)
export const inboxApi = {
  // List inbox items for current user
  list: async (filters?: InboxFilters): Promise<InboxListResponse> => {
    const params = new URLSearchParams();
    if (filters?.limit) params.append("limit", filters.limit.toString());
    if (filters?.offset) params.append("offset", filters.offset.toString());
    if (filters?.unread_only) params.append("unread_only", "true");

    const queryString = params.toString();
    const url = queryString
      ? `${HANDOVER_API_BASE}/inbox?${queryString}`
      : `${HANDOVER_API_BASE}/inbox`;

    return fetchWithAuth(url);
  },

  // Get unread count
  getUnreadCount: async (): Promise<InboxCountResponse> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/inbox/count`);
  },

  // Get a specific inbox item
  get: async (itemId: string): Promise<InboxItem> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/inbox/${itemId}`);
  },

  // Mark as read
  markRead: async (itemId: string): Promise<{ success: boolean; message: string }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/inbox/${itemId}/read`, {
      method: "POST",
    });
  },

  // Mark as unread
  markUnread: async (itemId: string): Promise<{ success: boolean; message: string }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/inbox/${itemId}/unread`, {
      method: "POST",
    });
  },

  // Delete (soft delete - removes from inbox but keeps handover)
  delete: async (itemId: string): Promise<{ success: boolean; message: string }> => {
    return fetchWithAuth(`${HANDOVER_API_BASE}/inbox/${itemId}`, {
      method: "DELETE",
    });
  },
};

export { ApiError };
