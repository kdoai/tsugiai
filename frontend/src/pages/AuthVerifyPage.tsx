/**
 * Auth Verify Page - Handles magic link email verification
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  isMagicLink,
  signInWithMagicLink,
  getSavedEmailForSignIn,
} from "../lib/firebase";

export function AuthVerifyPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [status, setStatus] = useState<"verifying" | "needEmail" | "success" | "error">("verifying");
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // If already authenticated, redirect to home
    if (!authLoading && isAuthenticated) {
      navigate("/", { replace: true });
      return;
    }

    // Check if this is a magic link
    const url = window.location.href;
    if (!isMagicLink(url)) {
      setError("無効なリンクです");
      setStatus("error");
      return;
    }

    // Try to sign in with saved email
    const savedEmail = getSavedEmailForSignIn();
    if (savedEmail) {
      handleSignIn(url, savedEmail);
    } else {
      // Need to ask for email (different device/browser)
      setStatus("needEmail");
    }
  }, [authLoading, isAuthenticated, navigate]);

  const handleSignIn = async (url: string, signInEmail: string) => {
    setIsSubmitting(true);
    setError(null);

    try {
      await signInWithMagicLink(url, signInEmail);
      setStatus("success");
      // Short delay before redirect
      setTimeout(() => {
        navigate("/", { replace: true });
      }, 1500);
    } catch (err: any) {
      console.error("Magic link sign-in error:", err);
      if (err.code === "auth/invalid-action-code") {
        setError("このリンクは無効か、すでに使用されています");
      } else if (err.code === "auth/expired-action-code") {
        setError("このリンクの有効期限が切れています");
      } else if (err.message) {
        setError(err.message);
      } else {
        setError("ログインに失敗しました");
      }
      setStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError("メールアドレスを入力してください");
      return;
    }
    handleSignIn(window.location.href, email);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <div className="size-8 spinner" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center size-16 bg-primary-600 text-white rounded-2xl mb-4">
            <svg className="size-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[#202124]">TSUGIAI</h1>
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl border border-[#dadce0] shadow-sm p-6">
          {status === "verifying" && (
            <div className="text-center">
              <div className="size-8 spinner mx-auto mb-4" />
              <h2 className="text-lg font-medium text-[#202124] mb-2">
                認証中...
              </h2>
              <p className="text-sm text-[#5f6368]">
                ログインリンクを確認しています
              </p>
            </div>
          )}

          {status === "needEmail" && (
            <div>
              <h2 className="text-lg font-medium text-[#202124] text-center mb-2">
                メールアドレスを確認
              </h2>
              <p className="text-sm text-[#5f6368] text-center mb-6">
                別のデバイスからアクセスしています。
                <br />
                ログインリンクを送信したメールアドレスを入力してください。
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-[#d93025]">
                  {error}
                </div>
              )}

              <form onSubmit={handleEmailSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-[#202124] mb-1">
                    メールアドレス
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="example@company.com"
                    className="input"
                    disabled={isSubmitting}
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting || !email}
                  className="w-full btn btn-primary py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="size-4 spinner border-white/30 border-t-white" />
                      確認中...
                    </span>
                  ) : (
                    "ログイン"
                  )}
                </button>
              </form>
            </div>
          )}

          {status === "success" && (
            <div className="text-center">
              <div className="inline-flex items-center justify-center size-16 bg-green-100 text-green-600 rounded-full mb-4">
                <svg className="size-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-medium text-[#202124] mb-2">
                ログイン成功
              </h2>
              <p className="text-sm text-[#5f6368]">
                ホーム画面に移動します...
              </p>
            </div>
          )}

          {status === "error" && (
            <div className="text-center">
              <div className="inline-flex items-center justify-center size-16 bg-red-100 text-red-600 rounded-full mb-4">
                <svg className="size-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-lg font-medium text-[#202124] mb-2">
                エラー
              </h2>
              <p className="text-sm text-[#5f6368] mb-6">
                {error || "ログインに失敗しました"}
              </p>
              <button
                onClick={() => navigate("/login", { replace: true })}
                className="btn btn-primary"
              >
                ログイン画面に戻る
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
