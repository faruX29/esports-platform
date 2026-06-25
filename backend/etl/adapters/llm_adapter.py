"""LLM adapter layer — base contract + provider implementations."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Optional, Type

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class LLMAdapterError(Exception):
    """Raised by LLM adapters on non-retriable failures."""


class BaseLLMAdapter(ABC):
    """Abstract base for all LLM provider adapters."""

    @abstractmethod
    def generate(
        self,
        user_prompt: str,
        system_prompt: Optional[str] = None,
        response_schema: Optional[Type[BaseModel]] = None,
    ) -> str:
        """
        Generate text from a prompt.

        Returns the generated text string.
        Raises LLMAdapterError on unrecoverable failures.
        """

    def safe_generate(
        self,
        user_prompt: str,
        system_prompt: Optional[str] = None,
        response_schema: Optional[Type[BaseModel]] = None,
    ) -> Optional[str]:
        """generate() with a soft-fail wrapper; returns None on any error."""
        try:
            return self.generate(user_prompt, system_prompt, response_schema)
        except Exception as exc:
            logger.warning("LLM generation failed: %s", exc)
            return None


class GeminiAdapter(BaseLLMAdapter):
    """
    Google Gemini adapter using the google-genai SDK (v1+).

    Default model: gemini-2.5-flash — Google's current balanced model.
    API key is fetched from Config.GEMINI_API_KEY.
    max_output_tokens is intentionally unset — let the model write freely.
    """

    DEFAULT_MODEL = "gemini-2.5-flash"
    DEFAULT_TEMPERATURE = 0.7

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = DEFAULT_MODEL,
        temperature: float = DEFAULT_TEMPERATURE,
    ) -> None:
        from config import Config

        self._api_key = api_key or Config.GEMINI_API_KEY
        if not self._api_key:
            raise LLMAdapterError(
                "GEMINI_API_KEY is not configured. "
                "Add GEMINI_API_KEY=<key> to your .env file."
            )
        self._model_name = model
        self._temperature = temperature
        self._client = self._build_client()

    def _build_client(self):
        try:
            from google import genai
        except ImportError as exc:
            raise LLMAdapterError(
                "google-genai package is not installed. "
                "Run: pip install google-genai>=1.0.0"
            ) from exc
        return genai.Client(api_key=self._api_key)

    def generate(
        self,
        user_prompt: str,
        system_prompt: Optional[str] = None,
        response_schema: Optional[Type[BaseModel]] = None,
    ) -> str:
        from google.genai import types

        logger.debug(
            "GeminiAdapter.generate — model=%s prompt_chars=%d schema=%s",
            self._model_name,
            len(user_prompt),
            response_schema.__name__ if response_schema else "none",
        )
        try:
            cfg_kwargs: dict = {
                "system_instruction": system_prompt,
                "temperature": self._temperature,
                "response_mime_type": "application/json",
            }
            if response_schema is not None:
                cfg_kwargs["response_schema"] = response_schema

            response = self._client.models.generate_content(
                model=self._model_name,
                contents=user_prompt,
                config=types.GenerateContentConfig(**cfg_kwargs),
            )
            text = response.text.strip()
            if not text:
                raise LLMAdapterError("Gemini returned an empty response")
            return text
        except LLMAdapterError:
            raise
        except Exception as exc:
            raise LLMAdapterError(f"Gemini API error: {exc}") from exc
