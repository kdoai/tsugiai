"""Handover note generation agent using Google ADK."""

import logging
import uuid
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)
from google.adk.agents import LlmAgent
from google.genai import types

from checkout_agent.prompts import HANDOVER_SUMMARY_PROMPT


HANDOVER_INSTRUCTION = """あなたは引き継ぎ簿作成のスペシャリストです。
チェックアウトセッションの会話内容を分析し、次の担当者に必要な情報を
構造化された引き継ぎ簿としてまとめます。

## 役割
1. 会話内容から重要情報を抽出
2. 重要度に基づいて優先順位付け
3. 読みやすい引き継ぎ簿を生成
4. 抜け漏れがないかチェック
5. **必要な場合のみ**アクションアイテムを生成

## 重要度の判定
- P0: 即時対応必須（安全リスク、システム停止等）
- P1: 24時間以内に対応必要
- P2: 今週中に対応
- P3: 参考情報

## カテゴリ分類
- critical_items: P0/P1の重要事項
- pending_tasks: 未完了タスク
- equipment_issues: 設備の問題
- safety_notes: 安全に関する注意事項
- general_notes: その他の連絡事項

## 引き継ぎ簿のフォーマット

# 引き継ぎ簿

## 基本情報
- 担当者: {operator_name}
- 次担当: {next_operator_name}
- 日時: {datetime}

## 重要事項（要対応）
{P0/P1の項目を箇条書き - 最優先で表示}

## 未完了タスク
{pending_tasks - 具体的なアクション項目}

## 設備状況
{equipment_issues または「異常なし」}

## 安全確認
{safety_notes または「問題なし」}

## 連絡事項
{general_notes}

## 添付写真
{photos - ある場合のみ}

---
確認済み: [ ]

## ルール
1. 発言は正確に引用する（改変しない）
2. P0/P1項目は必ず「重要事項」セクションに含める
3. 曖昧な表現は避け、具体的に記載
4. 「問題なし」の項目も明記する
5. 写真添付がある場合は参照を記載
6. 次担当者が即座に状況を把握できるようにする

## アクションアイテム生成ルール

### 生成する場合（以下のいずれかに該当）
1. **継続監視が必要**: 温度上昇、異音、圧力変動など時間経過で変化する事象
2. **条件分岐のある対応**: 「〇〇なら△△、××なら□□」という判断が必要な場合
3. **数値確認が必要**: 特定の閾値を超えたら対応が必要な場合
4. **再確認が必要**: 一定時間後に状態を再確認すべき場合
5. **外部連絡の待ち受け**: 消防・警察・業者・本社など外部からの連絡を待って対応が必要
6. **明示的な依頼・委任**: 「〇〇してください」「〇〇をお願いします」で具体的な対応を依頼された場合
7. **書類・報告書の確認**: 報告書・書類が提出済みで、内容確認や後続対応が必要な場合
8. **事故・災害後のフォローアップ**: 鎮火・収束していても事後対応（原因調査、関係機関対応）が必要な場合

### 生成しない場合
- 具体的な行動を求めていない情報共有のみ（「〇〇がありました」で、対応依頼や確認要求が一切ない場合）
- 既に解決済みの問題（ただし事故・災害は鎮火・収束していても事後対応があるため除外しない）
- 対象・タイミング・基準が一切ない曖昧な指示（「確認してください」だけで何を確認すべきか不明な場合のみ）
- 対話から具体的な行動に落とせない内容

### 生成時の必須要素
- **topic**: 何を（具体的な対象）
- **timing**: いつ（具体的な時刻またはイベント）
- **item_type**: どう記録するか（checkbox/numeric/text/selection）
- **condition**: どうなっていたら（判断基準、数値があれば数値で）
- **then_action**: 基準外の場合どうするか
- **evidence**: なぜこのアクションが必要か（元の発言を引用）"""


def generate_ai_action_items(
    conversation_text: str,
    responses_summary: str,
    template_items_context: str,
) -> list[dict]:
    """
    Generate action items using Gemini AI by analyzing conversation and responses.

    Args:
        conversation_text: Full conversation text from Phase 3
        responses_summary: Summary of item responses (OK/NG status)
        template_items_context: Template item names for context

    Returns:
        List of action item dicts (may be empty if no actions needed)
    """
    from google import genai
    from google.genai import types as genai_types
    import json as _json

    prompt = f"""あなたは作業引き継ぎの専門家です。以下のチェックアウト対話と回答結果を分析し、
次の担当者が実行すべきアクションアイテムを生成してください。

## アクションアイテム生成ルール

### 生成する場合（以下のいずれかに該当）
1. **継続監視が必要**: 温度上昇、異音、圧力変動など時間経過で変化する事象
2. **条件分岐のある対応**: 「〇〇なら△△、××なら□□」という判断が必要な場合
3. **数値確認が必要**: 特定の閾値を超えたら対応が必要な場合
4. **再確認が必要**: 一定時間後に状態を再確認すべき場合
5. **外部連絡の待ち受け**: 消防・警察・業者・本社など外部からの連絡を待って対応が必要
6. **明示的な依頼・委任**: 「〇〇してください」「〇〇をお願いします」で具体的な対応を依頼された場合
7. **書類・報告書の確認**: 報告書・書類が提出済みで、内容確認や後続対応が必要な場合
8. **事故・災害後のフォローアップ**: 鎮火・収束していても事後対応（原因調査、関係機関対応）が必要な場合

### 生成しない場合
- 具体的な行動を求めていない情報共有のみ（「〇〇がありました」で、対応依頼や確認要求が一切ない場合）
- 既に解決済みの問題（ただし事故・災害は鎮火・収束していても事後対応があるため除外しない）
- 対象・タイミング・基準が一切ない曖昧な指示（「確認してください」だけで何を確認すべきか不明な場合のみ）
- 対話から具体的な行動に落とせない内容
- すべてのチェック項目がOK（問題なし）の場合

### 出力フォーマット
JSON配列で出力してください。アクションが不要な場合は空配列 [] を返してください。

各アクションアイテム:
{{
  "topic": "具体的な対象（例: 2号炉の温度確認）",
  "description": "詳細な説明",
  "item_type": "checkbox|numeric|text|selection",
  "timing": "いつ実行するか（例: 17:00の巡回時）またはnull",
  "condition": "判断基準（例: 290℃以上なら）またはnull",
  "then_action": "基準外の場合の対応（例: 設備担当に連絡）またはnull",
  "evidence": "このアクションの根拠となる元の発言を引用",
  "numeric_validation": null または {{"validation_type": "max|min|range|tolerance", "base_value": 数値, "tolerance": 数値, "unit": "単位"}},
  "selection_choices": [] または ["選択肢1", "選択肢2"]
}}

## チェックリスト項目
{template_items_context}

## 回答結果サマリー
{responses_summary}

## 対話ログ
{conversation_text}

## アクションアイテム（JSON配列で出力）:"""

    try:
        client = genai.Client()
        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                temperature=0.2,
                max_output_tokens=2000,
            ),
        )

        if response and response.text:
            text = response.text.strip()
            # Extract JSON from response (handle markdown code blocks)
            if text.startswith("```"):
                # Remove markdown code block markers
                lines = text.split("\n")
                json_lines = []
                in_block = False
                for line in lines:
                    if line.strip().startswith("```"):
                        in_block = not in_block
                        continue
                    if in_block or not line.strip().startswith("```"):
                        json_lines.append(line)
                text = "\n".join(json_lines).strip()

            items = _json.loads(text)
            if not isinstance(items, list):
                return []

            # Add IDs and order to each item
            result = []
            for i, item in enumerate(items):
                item["id"] = str(uuid.uuid4())
                item["order"] = i
                # Ensure required fields
                if "topic" not in item or "description" not in item:
                    continue
                item.setdefault("item_type", "checkbox")
                item.setdefault("timing", None)
                item.setdefault("condition", None)
                item.setdefault("then_action", None)
                item.setdefault("evidence", "")
                item.setdefault("numeric_validation", None)
                item.setdefault("selection_choices", [])
                result.append(item)

            return result

        return []
    except Exception as e:
        logger.error("Error generating AI action items: %s", e)
        return []


def _infer_topic(message: str, trigger_type: str) -> str:
    """Infer a short topic name from the message and trigger type."""
    topic_labels = {
        "external_pending": "外部連絡対応",
        "delegation": "依頼事項の対応",
        "document_followup": "書類・報告書の確認",
        "incident_followup": "事故・災害後のフォローアップ",
        "monitoring": "継続監視",
        "time_check": "再確認",
        "conditional": "条件付き対応",
    }
    # Try to extract a more specific topic from the message
    specifics = {
        "消防": "消防からの連絡対応",
        "警察": "警察からの連絡対応",
        "業者": "業者からの連絡対応",
        "本社": "本社からの連絡対応",
        "報告書": "報告書の確認",
        "提出済み": "提出済み書類の確認",
        "届出": "届出の確認",
        "申請": "申請の確認",
        "火災": "火災後のフォローアップ",
        "火事": "火災後のフォローアップ",
        "事故": "事故後のフォローアップ",
        "鎮火": "鎮火後の対応確認",
        "負傷": "負傷者対応の確認",
        "救急": "救急対応の確認",
    }
    for keyword, topic in specifics.items():
        if keyword in message:
            return topic
    return topic_labels.get(trigger_type, "確認事項")


def generate_action_items(
    conversation: list,
    responses: list,
) -> list:
    """
    Analyze conversation and responses to generate action items for next operator.
    Only generates actions when specific criteria are met.

    Args:
        conversation: List of conversation turns from Phase 3
        responses: List of checkout responses (including NG items)

    Returns:
        List of action items (may be empty if no actions needed)
    """
    action_items = []

    # Look for patterns that require action items
    action_triggers = {
        # Monitoring required
        "monitoring": ["温度", "圧力", "回転数", "振動", "音", "臭い", "煙", "漏れ"],
        # Time-based check required
        "time_check": ["様子を見", "経過観察", "後で確認", "再確認", "〜時に"],
        # Conditional action required
        "conditional": ["場合は", "超えたら", "以上なら", "以下なら", "なったら"],
        # External contact pending
        "external_pending": ["連絡があったら", "連絡が来たら", "連絡待ち", "折り返し", "消防", "警察", "業者", "本社から"],
        # Explicit delegation
        "delegation": ["対応してください", "お願いします", "確認してください", "処理してください", "報告してください", "引き継い"],
        # Document follow-up
        "document_followup": ["報告書", "提出済み", "書類", "届出", "申請"],
        # Incident follow-up
        "incident_followup": ["火災", "火事", "事故", "鎮火", "収束", "負傷", "救急", "消火"],
    }

    # Analyze NG items from responses
    ng_responses = [r for r in responses if r.get("ng_status") in ["unresolved", "in_progress"]]

    for ng in ng_responses:
        detail = ng.get("ng_detail", "")
        item_id = ng.get("item_id", "")

        # Check if this NG item needs a follow-up action
        needs_monitoring = any(kw in detail for kw in action_triggers["monitoring"])
        needs_time_check = any(kw in detail for kw in action_triggers["time_check"])
        needs_conditional = any(kw in detail for kw in action_triggers["conditional"])
        needs_external = any(kw in detail for kw in action_triggers["external_pending"])
        needs_delegation = any(kw in detail for kw in action_triggers["delegation"])
        needs_document = any(kw in detail for kw in action_triggers["document_followup"])
        needs_incident = any(kw in detail for kw in action_triggers["incident_followup"])

        if needs_monitoring or needs_time_check or needs_conditional or needs_external or needs_delegation or needs_document or needs_incident:
            action_id = str(uuid.uuid4())

            # Determine item type based on content
            item_type = "checkbox"  # Default
            numeric_validation = None
            selection_choices = []

            # Check for numeric patterns
            import re
            numeric_pattern = r'(\d+(?:\.\d+)?)\s*(℃|度|MPa|kg|%|rpm|mm)'
            numeric_match = re.search(numeric_pattern, detail)

            if numeric_match:
                item_type = "numeric"
                value = float(numeric_match.group(1))
                unit = numeric_match.group(2)
                # Set validation with ±10% tolerance as default
                numeric_validation = {
                    "validation_type": "tolerance",
                    "base_value": value,
                    "tolerance": value * 0.1,
                    "unit": unit,
                }

            # Check for selection patterns
            if "場合は" in detail or "なら" in detail:
                item_type = "selection"
                selection_choices = ["正常", "要注意", "異常あり"]

            action_item = {
                "id": action_id,
                "topic": f"{item_id}の確認",
                "description": detail,
                "item_type": item_type,
                "timing": None,  # To be filled by AI or user
                "condition": None,
                "then_action": None,
                "evidence": detail,
                "numeric_validation": numeric_validation,
                "selection_choices": selection_choices,
                "order": len(action_items),
            }
            action_items.append(action_item)

    # Also analyze conversation for additional action triggers
    user_messages = [t.get("content", "") for t in conversation if t.get("role") == "user"]
    full_conversation = " ".join(user_messages)

    # Conversation-based trigger categories that generate action items
    conversation_trigger_types = {"external_pending", "delegation", "document_followup", "incident_followup"}

    # Look for explicit action requests in conversation
    matched_types = set()
    for trigger_type, keywords in action_triggers.items():
        if trigger_type not in conversation_trigger_types:
            continue
        for keyword in keywords:
            if keyword in full_conversation and not any(
                a.get("evidence", "").find(keyword) >= 0 for a in action_items
            ):
                if trigger_type not in matched_types:
                    matched_types.add(trigger_type)
                    # Find the sentence containing the keyword for evidence
                    evidence = ""
                    for msg in user_messages:
                        if keyword in msg:
                            evidence = msg.strip()
                            break
                    topic = _infer_topic(full_conversation, trigger_type)
                    action_items.append({
                        "id": str(uuid.uuid4()),
                        "topic": topic,
                        "description": evidence or topic,
                        "item_type": "checkbox",
                        "timing": None,
                        "condition": None,
                        "then_action": None,
                        "evidence": evidence,
                        "numeric_validation": None,
                        "selection_choices": [],
                        "order": len(action_items),
                    })

    return action_items


def generate_handover_note(
    session_id: str,
    operator_name: str,
    next_operator_name: str,
    conversation: list,
    responses: list,
    attachments: list = None,
    action_items: list = None,
) -> dict:
    """
    Generate a handover note from checkout session data.

    Args:
        session_id: The checkout session ID
        operator_name: Name of the operator who did checkout
        next_operator_name: Name of the next operator
        conversation: List of conversation turns
        responses: List of checkout responses
        attachments: List of photo attachments

    Returns:
        Generated handover note
    """
    handover_id = str(uuid.uuid4())
    now = datetime.now()

    # Extract critical items (P0/P1)
    critical_items = [
        r["response_text"] for r in responses
        if r.get("priority") in ["P0", "P1"]
    ]

    # Extract by category
    pending_tasks = [
        r["response_text"] for r in responses
        if r.get("status") == "pending" and r.get("category") == "task"
    ]

    equipment_issues = [
        r["response_text"] for r in responses
        if r.get("category") == "equipment" and r.get("status") != "done"
    ]

    safety_notes = [
        r["response_text"] for r in responses
        if r.get("category") == "safety"
    ]

    general_notes = [
        r["response_text"] for r in responses
        if r.get("category") in ["handover", "other"]
    ]

    # Build markdown
    markdown_parts = [
        "# 引き継ぎ簿",
        "",
        "## 基本情報",
        f"- 担当者: {operator_name}",
        f"- 次担当: {next_operator_name}",
        f"- 日時: {now.strftime('%Y年%m月%d日 %H:%M')}",
        "",
    ]

    # Critical items
    markdown_parts.append("## 重要事項（要対応）")
    if critical_items:
        for item in critical_items:
            markdown_parts.append(f"- ⚠️ {item}")
    else:
        markdown_parts.append("特になし")
    markdown_parts.append("")

    # Pending tasks
    markdown_parts.append("## 未完了タスク")
    if pending_tasks:
        for task in pending_tasks:
            markdown_parts.append(f"- [ ] {task}")
    else:
        markdown_parts.append("なし")
    markdown_parts.append("")

    # Equipment
    markdown_parts.append("## 設備状況")
    if equipment_issues:
        for issue in equipment_issues:
            markdown_parts.append(f"- {issue}")
    else:
        markdown_parts.append("異常なし")
    markdown_parts.append("")

    # Safety
    markdown_parts.append("## 安全確認")
    if safety_notes:
        for note in safety_notes:
            markdown_parts.append(f"- {note}")
    else:
        markdown_parts.append("問題なし")
    markdown_parts.append("")

    # General notes
    markdown_parts.append("## 連絡事項")
    if general_notes:
        for note in general_notes:
            markdown_parts.append(f"- {note}")
    else:
        markdown_parts.append("特になし")
    markdown_parts.append("")

    # Attachments
    if attachments:
        markdown_parts.append("## 添付写真")
        for att in attachments:
            markdown_parts.append(f"- [{att.get('file_name', '写真')}]({att.get('storage_url', '')})")
        markdown_parts.append("")

    markdown_parts.extend([
        "---",
        "確認済み: [ ]",
    ])

    summary_markdown = "\n".join(markdown_parts)

    # Generate action items if not provided
    if action_items is None:
        action_items = generate_action_items(conversation, responses)

    return {
        "success": True,
        "handover_id": handover_id,
        "session_id": session_id,
        "operator_name": operator_name,
        "next_operator_name": next_operator_name,
        "summary_markdown": summary_markdown,
        "extracted_data": {
            "critical_items": critical_items,
            "pending_tasks": pending_tasks,
            "equipment_issues": equipment_issues,
            "safety_notes": safety_notes,
            "general_notes": general_notes,
        },
        "action_items": action_items,
        "action_responses": [],
        "created_at": now.isoformat(),
    }


def analyze_conversation(conversation: list) -> dict:
    """
    Analyze a checkout conversation to extract key information.

    Args:
        conversation: List of conversation turns

    Returns:
        Analysis results
    """
    # Count messages
    user_messages = [t for t in conversation if t.get("role") == "user"]
    assistant_messages = [t for t in conversation if t.get("role") == "assistant"]

    # Look for keywords indicating issues
    issue_keywords = ["問題", "故障", "エラー", "異常", "壊れ", "動かない", "止まっ"]
    urgent_keywords = ["緊急", "すぐ", "至急", "危険", "安全"]

    issues_found = []
    urgent_items = []

    for msg in user_messages:
        content = msg.get("content", "")
        for keyword in issue_keywords:
            if keyword in content:
                issues_found.append(content[:100])
                break
        for keyword in urgent_keywords:
            if keyword in content:
                urgent_items.append(content[:100])
                break

    return {
        "success": True,
        "total_turns": len(conversation),
        "user_messages": len(user_messages),
        "issues_found": len(issues_found),
        "urgent_items": len(urgent_items),
        "sample_issues": issues_found[:3],
        "sample_urgent": urgent_items[:3],
    }


def format_for_notification(handover: dict, notification_type: str = "slack") -> dict:
    """
    Format handover note for notification systems.

    Args:
        handover: The handover note data
        notification_type: Target notification system (slack, teams, email)

    Returns:
        Formatted notification content
    """
    critical = handover.get("extracted_data", {}).get("critical_items", [])
    operator = handover.get("operator_name", "")
    next_op = handover.get("next_operator_name", "")

    if notification_type == "slack":
        blocks = [
            {
                "type": "header",
                "text": {"type": "plain_text", "text": "📋 引き継ぎ通知"}
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*担当者:* {operator} → {next_op}"
                }
            },
        ]

        if critical:
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "*⚠️ 重要事項:*\n" + "\n".join(f"• {item}" for item in critical)
                }
            })

        return {
            "success": True,
            "format": "slack",
            "content": {"blocks": blocks},
        }

    elif notification_type == "teams":
        card = {
            "@type": "MessageCard",
            "summary": "引き継ぎ通知",
            "sections": [
                {
                    "activityTitle": "📋 引き継ぎ通知",
                    "facts": [
                        {"name": "担当者", "value": f"{operator} → {next_op}"},
                    ],
                }
            ],
        }

        if critical:
            card["sections"][0]["text"] = "⚠️ 重要事項:\n" + "\n".join(f"• {item}" for item in critical)

        return {
            "success": True,
            "format": "teams",
            "content": card,
        }

    else:  # email
        subject = f"【引き継ぎ】{operator} → {next_op}"
        body = handover.get("summary_markdown", "")

        return {
            "success": True,
            "format": "email",
            "content": {
                "subject": subject,
                "body": body,
            },
        }


# Configure generation settings
generate_config = types.GenerateContentConfig(
    temperature=0.5,  # Lower temperature for more consistent output
    top_p=0.95,
    max_output_tokens=8192,
    safety_settings=[
        types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
        types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
        types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
        types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
    ],
)


handover_agent = LlmAgent(
    name="handover_agent",
    model="gemini-3-flash-preview",
    description="チェックアウト会話から引き継ぎ簿を生成するエージェント",
    instruction=HANDOVER_INSTRUCTION,
    tools=[
        generate_handover_note,
        generate_action_items,
        analyze_conversation,
        format_for_notification,
    ],
    generate_content_config=generate_config,
)
