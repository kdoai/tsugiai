/**
 * Audio utilities for Gemini Live API
 * Handles PCM encoding/decoding for real-time audio streaming
 */

/**
 * Encode Uint8Array to Base64 string
 */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decode Base64 string to Uint8Array
 */
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decode PCM audio data to AudioBuffer
 * @param data - Raw PCM data as Uint8Array
 * @param ctx - AudioContext to create buffer
 * @param sampleRate - Sample rate of the audio (24000 for Gemini output)
 * @param numChannels - Number of audio channels (1 for mono)
 */
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number
): Promise<AudioBuffer> {
  // Convert Uint8Array to Int16Array (PCM 16-bit)
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  // Convert Int16 to Float32 and fill buffer
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Normalize Int16 (-32768 to 32767) to Float32 (-1.0 to 1.0)
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

/**
 * Convert Float32Array audio data to PCM blob for transmission
 * @param data - Float32Array from ScriptProcessor
 * @returns Object with base64 encoded data and mimeType
 */
export function createPcmBlob(data: Float32Array): { data: string; mimeType: string } {
  const len = data.length;
  const int16 = new Int16Array(len);

  for (let i = 0; i < len; i++) {
    // Clamp and convert Float32 to Int16
    const sample = Math.max(-1, Math.min(1, data[i]));
    int16[i] = sample < 0 ? sample * 32768 : sample * 32767;
  }

  return {
    data: encodeBase64(new Uint8Array(int16.buffer)),
    mimeType: "audio/pcm;rate=16000",
  };
}

/**
 * Calculate RMS audio level from Float32Array
 * @param data - Audio samples
 * @returns Normalized level (0-1)
 */
export function calculateAudioLevel(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * data[i];
  }
  return Math.min(1, Math.sqrt(sum / data.length) * 5);
}

/**
 * Play a simple tone (for connection feedback)
 */
export function playTone(
  ctx: AudioContext,
  freq1: number,
  freq2: number,
  duration: number,
  volume: number = 0.1
): Promise<void> {
  return new Promise((resolve) => {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.frequency.value = freq1;
    osc2.frequency.value = freq2;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start();
    osc2.start();

    setTimeout(() => {
      osc1.stop();
      osc2.stop();
      resolve();
    }, duration * 1000);
  });
}
