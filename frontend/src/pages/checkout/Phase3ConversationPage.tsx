/**
 * Phase 3: AI conversation page for final review
 * Shows mode selection (chat/voice) at the start within the chat UI
 */

import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { clsx } from "clsx";
import type { CheckItem, CheckoutSession } from "../../types/handover";
import { checkoutApi } from "../../services/handoverApi";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  quickReplies?: string[];
}

interface Phase3ConversationPageProps {
  sessionId: string;
  session: CheckoutSession;
  items: CheckItem[];
  ngItemIds: string[];
  onComplete: () => Promise<void>;
  onBack: () => void;
  onGoToPhase1: () => Promise<void>;
  isCompleting: boolean;
}

export function Phase3ConversationPage({
  sessionId,
  session,
  items,
  ngItemIds,
  onComplete,
  onBack,
  onGoToPhase1,
  isCompleting,
}: Phase3ConversationPageProps) {
  const navigate = useNavigate();
  const [modeSelected, setModeSelected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [canComplete, setCanComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isLoadingTurns, setIsLoadingTurns] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Phase 3 always runs as final AI review
  const ngItems = items.filter((item) => ngItemIds.includes(item.id));

  // Load existing conversation turns on mount
  useEffect(() => {
    const loadExistingTurns = async () => {
      setIsLoadingTurns(true);

      // Check if voice mode was used
      const wasVoiceMode = session.ai_conversation_mode === "voice_live";
      setIsVoiceMode(wasVoiceMode);

      try {
        const result = await checkoutApi.getTurns(sessionId);
        if (result.turns && result.turns.length > 0) {
          // Filter out initial greeting if first message is assistant starting with "お疲れ様です"
          let filteredTurns = result.turns;
          if (filteredTurns.length > 0 && filteredTurns[0].role === "assistant") {
            const firstContent = filteredTurns[0].content?.trim() || "";
            if (firstContent.startsWith("お疲れ様です")) {
              filteredTurns = filteredTurns.slice(1);
            }
          }
          // Also filter out "チャットで確認します" for backwards compatibility
          filteredTurns = filteredTurns.filter(
            (t) => !(t.role === "user" && t.content?.trim() === "チャットで確認します")
          );

          // If all turns were filtered out, show mode selection
          if (filteredTurns.length === 0) {
            const initialMessage: Message = {
              id: "system-1",
              role: "system",
              content: ngItems.length > 0
                ? `AIとの最終確認を行います。\n\nNG項目が${ngItems.length}件あります。確認方法を選択してください。`
                : "AIとの最終確認を行います。\n\n確認方法を選択してください。",
              timestamp: new Date(),
            };
            setMessages([initialMessage]);
            setIsLoadingTurns(false);
            return;
          }

          // Convert turns to messages
          const loadedMessages: Message[] = filteredTurns.map((turn, index) => ({
            id: `loaded-${index}`,
            role: turn.role as "user" | "assistant",
            content: turn.content,
            timestamp: new Date(turn.timestamp),
            quickReplies: turn.quick_replies,
          }));
          setMessages(loadedMessages);

          if (wasVoiceMode) {
            // Voice mode: show voice transcript and allow completing
            setModeSelected(true);
            setCanComplete(true);
          } else if (session.ai_conversation_mode === "chat") {
            // Chat mode: continue the chat conversation
            setModeSelected(true);
            // Check if the last assistant message indicates completion
            // Must match backend completion phrases in main.py
            const completionPhrases = ["引き継ぎ簿を作成します", "引継ぎ簿を作成します", "お疲れ様でした"];
            const lastAssistantMsg = [...loadedMessages].reverse().find((m) => m.role === "assistant");
            if (lastAssistantMsg && completionPhrases.some((p) => lastAssistantMsg.content.includes(p))) {
              setCanComplete(true);
            }
          }
          // If no mode set but has turns, show them but allow mode selection
          setIsLoadingTurns(false);
          return;
        }
      } catch (error) {
        console.error("Failed to load existing turns:", error);
      }

      // No existing turns, show mode selection message
      const initialMessage: Message = {
        id: "system-1",
        role: "system",
        content: ngItems.length > 0
          ? `AIとの最終確認を行います。\n\nNG項目が${ngItems.length}件あります。確認方法を選択してください。`
          : "AIとの最終確認を行います。\n\n確認方法を選択してください。",
        timestamp: new Date(),
      };
      setMessages([initialMessage]);
      setIsLoadingTurns(false);
    };

    loadExistingTurns();
  }, [sessionId, session.ai_conversation_mode]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleModeSelect = async (selectedMode: "chat" | "voice") => {
    if (selectedMode === "voice") {
      // Navigate to voice checkout page
      navigate(`/checkout/${sessionId}/voice`);
      return;
    }

    // Chat mode selected
    setModeSelected(true);

    // Add user's selection as a message
    const userChoice: Message = {
      id: `user-choice`,
      role: "user",
      content: "チャットで確認します",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userChoice]);

    // Start chat mode - set mode on server and get AI-generated initial greeting
    try {
      setIsLoading(true);
      await checkoutApi.phase3Start(sessionId, "chat");

      // Send initial message to backend so AI generates the greeting
      // Skip user message "チャットで確認します" but save AI response
      const response = await checkoutApi.sendMessage(sessionId, "チャットで確認します", { skipUserOnly: true });

      const assistantMessage: Message = {
        id: "assistant-1",
        role: "assistant",
        content: response.message,
        timestamp: new Date(),
        quickReplies: response.quick_replies,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Failed to start phase 3:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async (message: string) => {
    if (!message.trim() || isLoading) return;

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
      setError(null);
      const response = await checkoutApi.sendMessage(sessionId, message);

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: response.message,
        timestamp: new Date(),
        quickReplies: response.quick_replies,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Check if conversation is complete
      if (response.is_complete) {
        setCanComplete(true);
      }
    } catch (err) {
      console.error("Failed to send message:", err);
      const errorMessage = err instanceof Error ? err.message : "メッセージの送信に失敗しました";
      setError(errorMessage);
      // 完了状態の場合はそのまま進めるようにする
      if (errorMessage.includes("status") || errorMessage.includes("Session")) {
        setCanComplete(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickReply = (reply: string) => {
    if (reply === "フォーム入力に戻ってやり直す") {
      onGoToPhase1();
      return;
    }
    sendMessage(reply);
  };

  // Loading state
  if (isLoadingTurns) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <div className="size-8 spinner" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[500px]">
      {/* Header for voice conversation transcript */}
      {isVoiceMode && messages.length > 0 && (
        <div className="px-4 py-3 bg-green-50 border-b border-green-200">
          <div className="flex items-center gap-2 text-green-700">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-medium">音声対話の記録</span>
          </div>
          <p className="text-xs text-green-600 mt-1">
            {messages.length}件のやり取りが記録されています
          </p>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={clsx(
                "max-w-[85%] rounded-lg px-3 py-2",
                message.role === "user"
                  ? "bg-primary-100 text-primary-900 border border-primary-200"
                  : "bg-[#f1f3f4] text-[#202124]"
              )}
            >
              <div className={clsx(
                "prose prose-sm max-w-none text-sm",
                message.role === "user" && "prose-primary"
              )}>
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>
            </div>
          </div>
        ))}

        {/* Mode selection buttons - shown only before mode is selected */}
        {!modeSelected && messages.length > 0 && (
          <div className="flex flex-col gap-2 pl-2">
            <button
              onClick={() => handleModeSelect("chat")}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[#dadce0] rounded-lg hover:bg-primary-50 hover:border-primary-300 transition-colors text-left"
            >
              <div className="p-1.5 bg-primary-100 text-primary-600 rounded">
                <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
              </div>
              <span className="text-sm font-medium text-[#202124]">このままチャットで確認</span>
            </button>

            <button
              onClick={() => handleModeSelect("voice")}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[#dadce0] rounded-lg hover:bg-green-50 hover:border-green-300 transition-colors text-left"
            >
              <div className="p-1.5 bg-green-100 text-green-600 rounded">
                <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                  />
                </svg>
              </div>
              <span className="text-sm font-medium text-[#202124]">音声通話で確認</span>
            </button>
          </div>
        )}

        {/* Quick replies */}
        {modeSelected && messages.length > 0 && messages[messages.length - 1].quickReplies && (
          <div className="flex flex-wrap gap-2 pl-2">
            {messages[messages.length - 1].quickReplies?.map((reply) => (
              <button
                key={reply}
                onClick={() => handleQuickReply(reply)}
                disabled={isLoading}
                className="px-3 py-1.5 text-sm bg-white border border-[#dadce0] rounded-full hover:bg-[#f1f3f4] transition-colors"
              >
                {reply}
              </button>
            ))}
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-[#f1f3f4] rounded-lg px-3 py-2">
              <div className="flex gap-1">
                <div className="size-1.5 bg-[#9aa0a6] rounded-full animate-bounce" />
                <div
                  className="size-1.5 bg-[#9aa0a6] rounded-full animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <div
                  className="size-1.5 bg-[#9aa0a6] rounded-full animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="flex justify-center">
            <div className="bg-red-50 text-red-600 border border-red-200 rounded-lg px-3 py-2 text-sm">
              {error}
            </div>
          </div>
        )}

        {/* Completion notice - only show for chat mode when complete */}
        {canComplete && !isLoading && !isVoiceMode && (
          <div className="flex justify-center">
            <div className="bg-green-50 text-green-700 border border-green-200 rounded-lg px-4 py-3 text-sm text-center">
              <p className="font-medium">確認が完了しました</p>
              <p className="mt-1 text-green-600">「対話を終了して次へ」ボタンを押してください</p>
            </div>
          </div>
        )}

        {/* Continue conversation options - shown when voice mode transcript exists */}
        {isVoiceMode && canComplete && (
          <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-[#dadce0]">
            <p className="text-sm text-[#5f6368] text-center">追加の確認が必要な場合：</p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => {
                  setCanComplete(false);
                  setIsVoiceMode(false);
                  setModeSelected(false);
                  // Show mode selection message
                  const modeSelectionMsg: Message = {
                    id: "system-mode-select",
                    role: "system",
                    content: "追加の確認方法を選択してください。",
                    timestamp: new Date(),
                  };
                  setMessages((prev) => [...prev, modeSelectionMsg]);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-[#dadce0] rounded-lg hover:bg-primary-50 hover:border-primary-300 transition-colors"
              >
                <svg className="size-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                チャットで追加
              </button>
              <button
                onClick={() => navigate(`/checkout/${sessionId}/voice`)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-[#dadce0] rounded-lg hover:bg-green-50 hover:border-green-300 transition-colors"
              >
                <svg className="size-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                音声で追加
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area - only shown after mode is selected and not completed */}
      {modeSelected && !canComplete && (
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
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between p-3 border-t border-[#dadce0]">
        <button
          type="button"
          onClick={canComplete ? onGoToPhase1 : onBack}
          className="text-sm text-[#5f6368] hover:text-[#202124]"
        >
          {canComplete ? "フォーム入力に戻る" : "前に戻る"}
        </button>
        {(modeSelected || isVoiceMode) && canComplete && (
          <button
            onClick={onComplete}
            disabled={isCompleting}
            className="btn btn-primary"
          >
            {isCompleting ? "処理中..." : isVoiceMode ? "次へ進む" : "対話を終了して次へ"}
          </button>
        )}
      </div>
    </div>
  );
}
