"""Speech-to-Text and Text-to-Speech service using Google Cloud Speech APIs."""

import logging
import os
import base64
from typing import Optional

logger = logging.getLogger(__name__)
from google.cloud import speech
from google.cloud import texttospeech


class SpeechService:
    """Service for speech-to-text and text-to-speech conversion."""

    def __init__(self):
        self.client = speech.SpeechClient()
        self.tts_client = texttospeech.TextToSpeechClient()

    def transcribe_audio(
        self,
        audio_content: bytes,
        encoding: str = "WEBM_OPUS",
        sample_rate: int = 48000,
        language_code: str = "ja-JP",
    ) -> dict:
        """
        Transcribe audio content to text.

        Args:
            audio_content: Audio data in bytes
            encoding: Audio encoding (WEBM_OPUS, LINEAR16, FLAC, etc.)
            sample_rate: Sample rate in hertz
            language_code: Language code (ja-JP, en-US, etc.)

        Returns:
            dict with transcript and confidence
        """
        # Map string encoding to enum
        encoding_map = {
            "WEBM_OPUS": speech.RecognitionConfig.AudioEncoding.WEBM_OPUS,
            "LINEAR16": speech.RecognitionConfig.AudioEncoding.LINEAR16,
            "FLAC": speech.RecognitionConfig.AudioEncoding.FLAC,
            "MP3": speech.RecognitionConfig.AudioEncoding.MP3,
            "OGG_OPUS": speech.RecognitionConfig.AudioEncoding.OGG_OPUS,
        }

        audio_encoding = encoding_map.get(
            encoding.upper(),
            speech.RecognitionConfig.AudioEncoding.WEBM_OPUS
        )

        audio = speech.RecognitionAudio(content=audio_content)

        config = speech.RecognitionConfig(
            encoding=audio_encoding,
            sample_rate_hertz=sample_rate,
            language_code=language_code,
            enable_automatic_punctuation=True,
            model="latest_long",  # Better for conversational speech
            use_enhanced=True,
        )

        try:
            response = self.client.recognize(config=config, audio=audio)

            if not response.results:
                return {
                    "success": True,
                    "transcript": "",
                    "confidence": 0,
                    "message": "No speech detected",
                }

            # Get the best alternative
            result = response.results[0]
            alternative = result.alternatives[0]

            return {
                "success": True,
                "transcript": alternative.transcript,
                "confidence": alternative.confidence,
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "transcript": "",
            }

    def transcribe_streaming_sync(
        self,
        audio_chunks: list,
        language_code: str = "ja-JP",
    ):
        """
        Transcribe audio chunks (synchronous version).

        Args:
            audio_chunks: List of audio data chunks
            language_code: Language code

        Returns:
            List of transcription results
        """
        streaming_config = speech.StreamingRecognitionConfig(
            config=speech.RecognitionConfig(
                encoding=speech.RecognitionConfig.AudioEncoding.WEBM_OPUS,
                sample_rate_hertz=48000,
                language_code=language_code,
                enable_automatic_punctuation=True,
            ),
            interim_results=True,
        )

        def request_generator():
            yield speech.StreamingRecognizeRequest(
                streaming_config=streaming_config
            )
            for chunk in audio_chunks:
                yield speech.StreamingRecognizeRequest(audio_content=chunk)

        results = []
        try:
            responses = self.client.streaming_recognize(request_generator())
            for response in responses:
                for result in response.results:
                    results.append({
                        "is_final": result.is_final,
                        "transcript": result.alternatives[0].transcript,
                        "confidence": result.alternatives[0].confidence if result.is_final else None,
                    })
        except Exception as e:
            return [{"error": str(e)}]

        return results

    def synthesize_speech(
        self,
        text: str,
        language_code: str = "ja-JP",
        voice_name: str = "ja-JP-Neural2-B",
        speaking_rate: float = 1.0,
        pitch: float = 0.0,
    ) -> dict:
        """
        Synthesize speech from text using Google Cloud Text-to-Speech.

        Args:
            text: Text to synthesize
            language_code: Language code (ja-JP, en-US, etc.)
            voice_name: Voice name (ja-JP-Neural2-B for female, ja-JP-Neural2-C for male)
            speaking_rate: Speaking rate (0.25 to 4.0, 1.0 is normal)
            pitch: Pitch adjustment (-20.0 to 20.0, 0.0 is normal)

        Returns:
            dict with audio_content (base64 encoded) and audio_format
        """
        try:
            # Set the text input
            synthesis_input = texttospeech.SynthesisInput(text=text)

            # Build the voice request
            voice = texttospeech.VoiceSelectionParams(
                language_code=language_code,
                name=voice_name,
            )

            # Select the audio encoding
            audio_config = texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.MP3,
                speaking_rate=speaking_rate,
                pitch=pitch,
            )

            # Perform the text-to-speech request
            response = self.tts_client.synthesize_speech(
                input=synthesis_input,
                voice=voice,
                audio_config=audio_config,
            )

            # Encode audio content to base64
            audio_base64 = base64.b64encode(response.audio_content).decode("utf-8")

            return {
                "success": True,
                "audio_content": audio_base64,
                "audio_format": "mp3",
                "content_type": "audio/mpeg",
            }

        except Exception as e:
            logger.error("TTS synthesis error: %s", e)
            return {
                "success": False,
                "error": str(e),
            }
