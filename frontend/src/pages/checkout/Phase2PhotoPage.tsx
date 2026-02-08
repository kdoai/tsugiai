/**
 * Phase 2: Photo upload and AI verification page
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { clsx } from "clsx";
import type { CheckItem, ItemResponse } from "../../types/handover";

interface PhotoItem {
  item: CheckItem;
  response?: ItemResponse;
  uploadedUrl?: string;
  verificationResult?: "pass" | "fail" | "pending";
  verificationMessage?: string;
}

interface Phase2PhotoPageProps {
  items: CheckItem[];
  responses: ItemResponse[];
  onUpload: (itemId: string, file: File) => Promise<string>;
  onVerify: (itemId: string) => Promise<{ result: string; message: string }>;
  onComplete: () => Promise<void>;
  onBack: () => void;
  isUploading: boolean;
  isVerifying: boolean;
  isCompleting: boolean;
}

export function Phase2PhotoPage({
  items,
  responses,
  onUpload,
  onVerify,
  onComplete,
  onBack,
  isUploading,
  isVerifying,
  isCompleting,
}: Phase2PhotoPageProps) {
  const [photoItems, setPhotoItems] = useState<Record<string, PhotoItem>>(() => {
    const initial: Record<string, PhotoItem> = {};
    const photoTypeItems = items.filter((item) => item.item_type === "photo");

    for (const item of photoTypeItems) {
      const response = responses.find((r) => r.item_id === item.id);
      initial[item.id] = {
        item,
        response,
        uploadedUrl: response?.photo_url,
        verificationResult: response?.photo_verification_result,
        verificationMessage: response?.photo_verification_message,
      };
    }
    return initial;
  });

  const [activeUpload, setActiveUpload] = useState<string | null>(null);
  const [activeVerify, setActiveVerify] = useState<string | null>(null);
  const [cameraItemId, setCameraItemId] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const photoTypeItems = items.filter((item) => item.item_type === "photo");

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraItemId(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const handleFileSelect = async (itemId: string, file: File) => {
    if (!file) return;

    setActiveUpload(itemId);
    try {
      const url = await onUpload(itemId, file);
      setPhotoItems((prev) => ({
        ...prev,
        [itemId]: {
          ...prev[itemId],
          uploadedUrl: url,
          verificationResult: "pending",
          verificationMessage: undefined,
        },
      }));

      // Auto-verify after upload
      setActiveVerify(itemId);
      const result = await onVerify(itemId);
      setPhotoItems((prev) => ({
        ...prev,
        [itemId]: {
          ...prev[itemId],
          verificationResult: result.result as "pass" | "fail" | "pending",
          verificationMessage: result.message,
        },
      }));
    } catch (error) {
      console.error("Upload failed:", error);
    } finally {
      setActiveUpload(null);
      setActiveVerify(null);
    }
  };

  const startCamera = useCallback(async (mode: "environment" | "user") => {
    // Stop existing stream first
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera access denied:", err);
      alert("カメラへのアクセスが許可されていません。ブラウザの設定を確認してください。");
    }
  }, []);

  const handleCameraCapture = async (itemId: string) => {
    setCameraItemId(itemId);
    // Wait for video element to mount, then start camera
    requestAnimationFrame(() => {
      startCamera(facingMode);
    });
  };

  const handleSwitchCamera = () => {
    const newMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newMode);
    startCamera(newMode);
  };

  const handleShutter = () => {
    if (!videoRef.current || !cameraItemId) return;

    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    stopCamera();

    canvas.toBlob(
      (blob) => {
        if (blob) {
          const file = new File([blob], `capture_${Date.now()}.jpg`, { type: "image/jpeg" });
          handleFileSelect(cameraItemId, file);
        }
      },
      "image/jpeg",
      0.9
    );
  };

  const handleFileUpload = (itemId: string) => {
    const input = fileInputRefs.current[itemId];
    if (input) {
      input.removeAttribute("capture");
      input.click();
    }
  };

  const handleRetake = (itemId: string) => {
    setPhotoItems((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        uploadedUrl: undefined,
        verificationResult: undefined,
        verificationMessage: undefined,
      },
    }));
  };

  const hasUnverified = Object.values(photoItems).some(
    (p) => !p.uploadedUrl || p.verificationResult === "pending"
  );

  return (
    <div className="space-y-4">
      {/* Camera modal */}
      {cameraItemId && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between p-3 bg-black/80">
            <span className="text-white text-sm">
              {facingMode === "environment" ? "外カメラ" : "インカメラ"}
            </span>
            <button type="button" onClick={stopCamera} className="text-white text-sm px-3 py-1">
              閉じる
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="max-w-full max-h-full object-contain"
            />
          </div>
          <div className="p-4 flex items-center justify-center gap-6 bg-black/80">
            {/* カメラ切り替えボタン */}
            <button
              type="button"
              onClick={handleSwitchCamera}
              className="w-12 h-12 rounded-full bg-white/20 active:bg-white/50 transition-colors flex items-center justify-center"
              aria-label="カメラ切り替え"
            >
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
            {/* シャッターボタン */}
            <button
              type="button"
              onClick={handleShutter}
              className="w-16 h-16 rounded-full border-4 border-white bg-white/20 active:bg-white/50 transition-colors"
              aria-label="撮影"
            />
            {/* スペーサー（左右のバランスを取るため） */}
            <div className="w-12 h-12" />
          </div>
        </div>
      )}

      {/* Photo items list */}
      <div className="space-y-4">
        {photoTypeItems.map((item) => {
          const photoItem = photoItems[item.id];
          const isUploadingThis = activeUpload === item.id;
          const isVerifyingThis = activeVerify === item.id;

          return (
            <div
              key={item.id}
              className={clsx(
                "card p-4 border-l-4 transition-colors",
                photoItem?.verificationResult === "pass" && "border-l-green-500",
                photoItem?.verificationResult === "fail" && "border-l-red-500",
                !photoItem?.verificationResult && "border-l-gray-300"
              )}
            >
              <div className="space-y-3">
                {/* Item header */}
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-medium text-[#202124]">{item.topic}</span>
                    <p className="text-sm text-[#5f6368] mt-1">{item.main_question}</p>
                    {item.verification_prompt && (
                      <p className="text-xs text-[#9aa0a6] mt-1">
                        確認ポイント: {item.verification_prompt}
                      </p>
                    )}
                  </div>

                  {/* Status badge */}
                  {photoItem?.verificationResult && (
                    <span
                      className={clsx(
                        "px-2 py-1 text-xs font-medium rounded-full",
                        photoItem.verificationResult === "pass" && "bg-green-100 text-green-700",
                        photoItem.verificationResult === "fail" && "bg-red-100 text-red-700",
                        photoItem.verificationResult === "pending" && "bg-gray-100 text-gray-700"
                      )}
                    >
                      {photoItem.verificationResult === "pass" && "合格"}
                      {photoItem.verificationResult === "fail" && "不合格"}
                      {photoItem.verificationResult === "pending" && "確認中"}
                    </span>
                  )}
                </div>

                {/* Photo preview or upload area */}
                {photoItem?.uploadedUrl ? (
                  <div className="space-y-2">
                    {/* Photo preview */}
                    <div className="relative rounded-lg overflow-hidden bg-[#f1f3f4]">
                      <img
                        src={photoItem.uploadedUrl}
                        alt={item.topic}
                        className="w-full h-48 object-cover"
                      />
                      {(isUploadingThis || isVerifyingThis) && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <div className="text-center text-white">
                            <div className="size-8 spinner border-white mx-auto mb-2" />
                            <p className="text-sm">
                              {isUploadingThis ? "アップロード中..." : "AI判定中..."}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Verification message */}
                    {photoItem.verificationMessage && (
                      <div
                        className={clsx(
                          "p-3 rounded-lg text-sm",
                          photoItem.verificationResult === "pass" && "bg-green-50 text-green-700",
                          photoItem.verificationResult === "fail" && "bg-red-50 text-red-700"
                        )}
                      >
                        {photoItem.verificationMessage}
                      </div>
                    )}

                    {/* Retake button */}
                    <button
                      type="button"
                      onClick={() => handleRetake(item.id)}
                      disabled={isUploadingThis || isVerifyingThis}
                      className="text-sm text-primary-600 hover:text-primary-700"
                    >
                      撮り直す
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Upload area */}
                    <div className="border-2 border-dashed border-[#dadce0] rounded-lg p-6 text-center">
                      {isUploadingThis ? (
                        <div>
                          <div className="size-8 spinner mx-auto mb-2" />
                          <p className="text-sm text-[#5f6368]">アップロード中...</p>
                        </div>
                      ) : (
                        <>
                          <svg
                            className="size-10 mx-auto mb-2 text-[#9aa0a6]"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                          </svg>
                          <p className="text-sm text-[#5f6368] mb-3">写真を撮影またはアップロード</p>
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleCameraCapture(item.id)}
                              className="btn btn-primary btn-sm"
                            >
                              <svg
                                className="size-4 mr-1"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                                />
                              </svg>
                              撮影
                            </button>
                            <button
                              type="button"
                              onClick={() => handleFileUpload(item.id)}
                              className="btn btn-secondary btn-sm"
                            >
                              <svg
                                className="size-4 mr-1"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                />
                              </svg>
                              ファイル選択
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Hidden file input */}
                    <input
                      ref={(el) => (fileInputRefs.current[item.id] = el)}
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileSelect(item.id, file);
                        e.target.value = "";
                      }}
                      className="hidden"
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* No photo items message */}
      {photoTypeItems.length === 0 && (
        <div className="text-center py-8 text-[#5f6368]">
          写真撮影項目はありません。次のフェーズに進んでください。
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-[#dadce0]">
        <button type="button" onClick={onBack} className="text-sm text-[#5f6368] hover:text-[#202124]">
          前に戻る
        </button>
        <button
          type="button"
          onClick={onComplete}
          disabled={isCompleting || hasUnverified || isUploading || isVerifying}
          className="btn btn-primary"
        >
          {isCompleting ? "処理中..." : "次へ進む"}
        </button>
      </div>

      {/* Warning if not all verified */}
      {hasUnverified && photoTypeItems.length > 0 && (
        <p className="text-sm text-amber-600 text-center">
          すべての写真をアップロードして判定を完了してください
        </p>
      )}
    </div>
  );
}
