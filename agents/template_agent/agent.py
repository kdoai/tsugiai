"""Template builder agent using Google ADK."""

import uuid
from datetime import datetime
from google.adk.agents import LlmAgent
from google.genai import types

from checkout_agent.prompts import TEMPLATE_BUILDER_PROMPT


# Tool for saving generated template
def save_template(
    title: str,
    description: str,
    items: list,
    duration: int = 600,
    knowledge_context: str = "",
) -> dict:
    """
    Save the generated template to Firestore.

    Args:
        title: Template title
        description: Template description
        items: List of checklist items
        duration: Expected duration in seconds
        knowledge_context: Background information

    Returns:
        Created template information
    """
    template_id = str(uuid.uuid4())

    # Format items with IDs
    formatted_items = []
    for i, item in enumerate(items):
        formatted_items.append({
            "id": item.get("id", f"item_{i+1}"),
            "topic": item.get("topic", ""),
            "main_question": item.get("main_question", ""),
            "follow_up_hints": item.get("follow_up_hints", []),
            "priority": item.get("priority", "P2"),
            "category": item.get("category", "other"),
            "is_required": item.get("is_required", True),
            "needs_photo": item.get("needs_photo", False),
        })

    template_data = {
        "id": template_id,
        "title": title,
        "description": description,
        "duration": duration,
        "items": formatted_items,
        "knowledge_context": knowledge_context,
        "created_at": datetime.now().isoformat(),
        "is_active": True,
    }

    return {
        "success": True,
        "template_id": template_id,
        "template": template_data,
        "message": f"テンプレート「{title}」を作成しました",
    }


def suggest_items_for_industry(industry: str, workplace: str = "") -> dict:
    """
    Suggest standard checklist items for a specific industry.

    Args:
        industry: Industry type (manufacturing, retail, office, etc.)
        workplace: Specific workplace type

    Returns:
        Suggested checklist items
    """
    # Industry-specific suggestions
    suggestions = {
        "manufacturing": [
            {"topic": "設備停止確認", "category": "equipment", "priority": "P1", "needs_photo": False},
            {"topic": "安全装置確認", "category": "safety", "priority": "P0", "needs_photo": True},
            {"topic": "在庫・材料確認", "category": "equipment", "priority": "P2", "needs_photo": False},
            {"topic": "作業進捗", "category": "task", "priority": "P1", "needs_photo": False},
            {"topic": "品質異常", "category": "safety", "priority": "P0", "needs_photo": True},
            {"topic": "清掃・整理整頓", "category": "other", "priority": "P3", "needs_photo": False},
        ],
        "retail": [
            {"topic": "レジ締め", "category": "task", "priority": "P1", "needs_photo": False},
            {"topic": "在庫確認", "category": "equipment", "priority": "P2", "needs_photo": False},
            {"topic": "店舗施錠", "category": "safety", "priority": "P0", "needs_photo": False},
            {"topic": "クレーム対応", "category": "handover", "priority": "P1", "needs_photo": False},
            {"topic": "明日の準備", "category": "task", "priority": "P2", "needs_photo": False},
        ],
        "office": [
            {"topic": "未完了タスク", "category": "task", "priority": "P1", "needs_photo": False},
            {"topic": "会議・予定", "category": "handover", "priority": "P2", "needs_photo": False},
            {"topic": "顧客対応", "category": "handover", "priority": "P1", "needs_photo": False},
            {"topic": "システム状態", "category": "equipment", "priority": "P2", "needs_photo": False},
            {"topic": "施錠・セキュリティ", "category": "safety", "priority": "P0", "needs_photo": False},
        ],
        "healthcare": [
            {"topic": "患者状態", "category": "handover", "priority": "P0", "needs_photo": False},
            {"topic": "投薬確認", "category": "safety", "priority": "P0", "needs_photo": False},
            {"topic": "医療機器", "category": "equipment", "priority": "P1", "needs_photo": True},
            {"topic": "緊急対応", "category": "safety", "priority": "P0", "needs_photo": False},
            {"topic": "記録確認", "category": "task", "priority": "P1", "needs_photo": False},
        ],
    }

    default = [
        {"topic": "未完了作業", "category": "task", "priority": "P1", "needs_photo": False},
        {"topic": "設備状態", "category": "equipment", "priority": "P2", "needs_photo": False},
        {"topic": "安全確認", "category": "safety", "priority": "P0", "needs_photo": False},
        {"topic": "連絡事項", "category": "handover", "priority": "P2", "needs_photo": False},
    ]

    industry_lower = industry.lower()
    items = suggestions.get(industry_lower, default)

    return {
        "success": True,
        "industry": industry,
        "workplace": workplace,
        "suggested_items": items,
        "message": f"{industry}向けの標準項目を{len(items)}件提案します",
    }


def validate_template(template: dict) -> dict:
    """
    Validate a template configuration.

    Args:
        template: Template configuration to validate

    Returns:
        Validation results with any issues found
    """
    issues = []

    # Check required fields
    if not template.get("title"):
        issues.append("タイトルが必要です")
    if not template.get("items") or len(template.get("items", [])) == 0:
        issues.append("少なくとも1つの確認項目が必要です")

    # Check items
    items = template.get("items", [])
    has_p0_p1 = False
    for i, item in enumerate(items):
        if not item.get("topic"):
            issues.append(f"項目{i+1}: トピックが必要です")
        if not item.get("main_question"):
            issues.append(f"項目{i+1}: 確認質問が必要です")
        if item.get("priority") in ["P0", "P1"]:
            has_p0_p1 = True

    # Recommendations
    recommendations = []
    if not has_p0_p1:
        recommendations.append("P0またはP1の重要項目を含めることをお勧めします")
    if len(items) > 10:
        recommendations.append("項目数が多いです。重要なものに絞ることをお勧めします")
    if len(items) < 3:
        recommendations.append("項目数が少ないです。漏れがないか確認してください")

    return {
        "success": len(issues) == 0,
        "valid": len(issues) == 0,
        "issues": issues,
        "recommendations": recommendations,
        "item_count": len(items),
    }


# Configure generation settings
generate_config = types.GenerateContentConfig(
    temperature=0.8,
    top_p=0.95,
    max_output_tokens=8192,
    safety_settings=[
        types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
        types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
        types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
        types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
    ],
)


template_builder_agent = LlmAgent(
    name="template_builder_agent",
    model="gemini-3-flash-preview",
    description="チェックリストテンプレートを対話形式で作成するエージェント",
    instruction=TEMPLATE_BUILDER_PROMPT,
    tools=[
        save_template,
        suggest_items_for_industry,
        validate_template,
    ],
    generate_content_config=generate_config,
)
