"""Main checkout agent using Google ADK."""

import os
from google.adk.agents import LlmAgent
from google.genai import types

from .prompts import CHECKOUT_AGENT_INSTRUCTION, PHASE3_CONVERSATION_INSTRUCTION
from .tools import (
    save_check_response,
    add_to_parking_lot,
    request_photo,
    mark_item_complete,
    get_session_progress,
    complete_checkout,
)


def create_checkout_agent(
    template_title: str = "",
    template_items: list = None,
    operator_name: str = "",
    remaining_time: int = 600,
    ng_item_ids: list = None,
    responses_summary: str = None,
    phase3_mode: bool = False,
) -> LlmAgent:
    """
    Create a checkout agent instance with dynamic configuration.

    Args:
        template_title: Title of the checklist template
        template_items: List of checklist items to cover
        operator_name: Name of the operator doing checkout
        remaining_time: Remaining time in seconds
        ng_item_ids: List of NG item IDs (Phase 3)
        responses_summary: Summary of all responses for Phase 3 review
        phase3_mode: If True, use Phase 3 specific instruction

    Returns:
        Configured LlmAgent instance
    """
    ng_item_ids = ng_item_ids or []
    template_items = template_items or []

    if phase3_mode:
        # Phase 3 mode: Final AI review of all responses
        ng_items_text = ""
        expected_answer_mismatches_text = ""
        mismatch_item_ids = set()

        # First pass: identify expected_answer mismatches
        for item in template_items:
            item_id = item.get("id", "")
            expected_answer = item.get("expected_answer", "ok")
            if expected_answer == "ng" and item_id in ng_item_ids:
                mismatch_item_ids.add(item_id)
                expected_answer_mismatches_text += (
                    f"- **{item.get('topic', '')}**（質問: {item.get('main_question', '')}）: "
                    f"正しい回答は「NG」ですが、担当者は「OK」と回答しました。\n"
                )

        # Second pass: NG items (exclude mismatch items to avoid duplication)
        for item in template_items:
            item_id = item.get("id", "")
            if item_id in ng_item_ids and item_id not in mismatch_item_ids:
                ng_items_text += f"- **{item.get('topic', '')}**（質問: {item.get('main_question', '')}）\n"

        if not ng_items_text:
            ng_items_text = "（なし）\n"
        if not expected_answer_mismatches_text:
            expected_answer_mismatches_text = "（なし）\n"

        full_instruction = PHASE3_CONVERSATION_INSTRUCTION.format(
            responses_summary=responses_summary or "（回答情報なし）",
            ng_items=ng_items_text,
            expected_answer_mismatches=expected_answer_mismatches_text,
        )

        context_instruction = f"""
## 現在のセッション情報
- テンプレート: {template_title}
- 担当者: {operator_name or "未確認"}
"""
        full_instruction += context_instruction

    else:
        # Normal mode: Full checkout flow
        items_text = ""
        if template_items:
            items_text = "\n## 確認項目リスト\n"
            for item in template_items:
                required = "【必須】" if item.get("is_required", True) else "【任意】"
                photo = "📷" if item.get("needs_photo", False) else ""
                items_text += f"- {required} {item['topic']}: {item['main_question']} {photo}\n"
                if item.get("follow_up_hints"):
                    items_text += f"  深掘りヒント: {', '.join(item['follow_up_hints'])}\n"

        context_instruction = f"""
## 現在のセッション情報
- テンプレート: {template_title}
- 担当者: {operator_name or "未確認"}
- 残り時間: {remaining_time // 60}分

{items_text}
"""
        full_instruction = CHECKOUT_AGENT_INSTRUCTION + context_instruction

    # Configure generation settings for gemini-3-flash-preview
    generate_config = types.GenerateContentConfig(
        temperature=0.7,
        top_p=0.95,
        max_output_tokens=8192,
        safety_settings=[
            types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
            types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
            types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
            types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
        ],
    )

    agent = LlmAgent(
        name="checkout_agent",
        model="gemini-3-flash-preview",
        description="作業終了時のチェックアウト確認を行うエージェント",
        instruction=full_instruction,
        tools=[
            save_check_response,
            add_to_parking_lot,
            request_photo,
            mark_item_complete,
            get_session_progress,
            complete_checkout,
        ],
        generate_content_config=generate_config,
    )

    return agent


# Default agent for simple initialization
checkout_agent = LlmAgent(
    name="checkout_agent",
    model="gemini-3-flash-preview",
    description="作業終了時のチェックアウト確認を行うエージェント",
    instruction=CHECKOUT_AGENT_INSTRUCTION,
    tools=[
        save_check_response,
        add_to_parking_lot,
        request_photo,
        mark_item_complete,
        get_session_progress,
        complete_checkout,
    ],
)
