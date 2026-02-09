"""FastAPI server for the handover checklist system."""

import os
import uuid
import json
import logging
from datetime import datetime
from typing import Optional
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import base64
from pydantic import BaseModel
from dotenv import load_dotenv

from google.genai import types
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService

# Load environment variables
load_dotenv()

# Set defaults for GCP
os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "tsugiai")
os.environ.setdefault("STORAGE_BUCKET", "tsugiai-handover-attachments")

# Configure ADK for Vertex AI with Gemini 3
# Gemini 3 models require global region
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "1")
os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "global")

# Set API key for ADK (it uses GOOGLE_API_KEY)
if os.environ.get("GOOGLE_CLOUD_API_KEY"):
    os.environ.setdefault("GOOGLE_API_KEY", os.environ.get("GOOGLE_CLOUD_API_KEY"))

# Import services and agents
from services.firestore import FirestoreService
from services.storage import StorageService
from services.speech import SpeechService
from models.checklist import (
    ChecklistTemplate,
    CheckoutSession,
    HandoverNote,
    Comment,
    Attachment,
    CheckItem,
    Priority,
    Category,
    ItemType,
    ItemResponse,
    SessionStatus,
    NumericValidation,
    NumericValidationType,
    NGStatus,
)
from checkout_agent.agent import create_checkout_agent
from checkout_agent.tools import set_services, set_current_session
from template_agent.agent import template_builder_agent
from handover_agent.agent import handover_agent
from middleware.auth import CurrentUser, get_current_user, require_auth, require_tenant


# Initialize services
storage_service = None
speech_service = None
session_service = None


def get_firestore_service(tenant_id: Optional[str] = None) -> FirestoreService:
    """Get FirestoreService with optional tenant scoping."""
    return FirestoreService(tenant_id=tenant_id)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    global storage_service, speech_service, session_service

    # Initialize services on startup
    storage_service = StorageService()
    speech_service = SpeechService()
    session_service = InMemorySessionService()

    # Inject services into tools (without tenant - will be set per request)
    set_services(FirestoreService(), storage_service)

    yield

    # Cleanup on shutdown (if needed)


app = FastAPI(
    title="Handover Checklist API",
    description="AIを活用した作業引き継ぎチェックリストシステム",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS configuration
_cors_origins = os.environ.get("ALLOWED_ORIGINS", "*")
_allowed_origins = [o.strip() for o in _cors_origins.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== Request/Response Models ====================

class CreateTemplateRequest(BaseModel):
    title: str
    description: str = ""
    duration: int = 600
    items: list[dict] = []
    knowledge_context: str = ""
    randomize_order: bool = False


class StartSessionRequest(BaseModel):
    template_id: str
    operator_id: str
    operator_name: str = ""
    next_operator_id: Optional[str] = None
    next_operator_name: str = ""


class SendMessageRequest(BaseModel):
    message: str
    skip_log: bool = False  # If True, don't save this exchange to turns
    skip_user_only: bool = False  # If True, skip user message but save AI response


class AddCommentRequest(BaseModel):
    author_id: str
    author_name: str
    content: str


class TemplateBuilderRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


# ==================== New Request Models for Phase-based Checkout ====================

class ItemResponseData(BaseModel):
    item_id: str
    item_type: str
    checkbox_value: Optional[bool] = None
    numeric_value: Optional[float] = None
    text_value: Optional[str] = None
    selection_value: Optional[str] = None
    # NG details
    ng_status: Optional[str] = None  # unresolved/in_progress/resolved
    ng_detail: Optional[str] = None


class Phase1SaveRequest(BaseModel):
    responses: list[ItemResponseData]


class Phase2UploadRequest(BaseModel):
    item_id: str


class Phase3StartRequest(BaseModel):
    mode: str  # "chat" or "voice"


class UpdateSummaryRequest(BaseModel):
    summary_markdown: str


class UpdateActionItemsRequest(BaseModel):
    action_items: list[dict]


class ActionResponseRequest(BaseModel):
    action_id: str
    item_type: str
    checkbox_value: Optional[bool] = None
    numeric_value: Optional[float] = None
    text_value: Optional[str] = None
    selection_value: Optional[str] = None
    note: Optional[str] = None
    completed_by: str
    completed_by_name: str


class CancelHandoverRequest(BaseModel):
    reason: Optional[str] = None


# ==================== Helper Functions ====================

def is_checkbox_ng(checkbox_value: Optional[bool], expected_answer: str = "ok") -> bool:
    """Determine if a checkbox response represents an NG (problem) condition."""
    if checkbox_value is None:
        return False
    if expected_answer == "ng":
        return checkbox_value is True   # OK press = problem (inverted)
    return checkbox_value is False      # NG press = problem (normal)


# ==================== Template Endpoints ====================

def parse_check_item(item: dict, index: int) -> CheckItem:
    """Parse a dictionary into a CheckItem, handling both old and new formats."""
    # Parse numeric validation if present
    numeric_validation = None
    if item.get("numeric_validation"):
        nv = item["numeric_validation"]
        numeric_validation = NumericValidation(
            validation_type=NumericValidationType(nv.get("validation_type", "range")),
            min_value=nv.get("min_value"),
            max_value=nv.get("max_value"),
            expected_value=nv.get("expected_value"),
            base_value=nv.get("base_value"),
            tolerance=nv.get("tolerance"),
            unit=nv.get("unit", ""),
        )

    # Parse item_type with fallback
    item_type_str = item.get("item_type", "checkbox")
    try:
        item_type = ItemType(item_type_str)
    except ValueError:
        item_type = ItemType.CHECKBOX

    # Parse category with fallback to OTHER for unknown values
    category_str = item.get("category", "other")
    try:
        category = Category(category_str)
    except ValueError:
        category = Category.OTHER

    # Parse priority with fallback
    priority_str = item.get("priority", "P2")
    try:
        priority = Priority(priority_str)
    except ValueError:
        priority = Priority.P2

    return CheckItem(
        id=item.get("id", f"item_{index}"),
        topic=item.get("topic", ""),
        main_question=item.get("main_question", ""),
        follow_up_hints=item.get("follow_up_hints", []),
        item_type=item_type,
        expected_answer=item.get("expected_answer", "ok"),
        numeric_validation=numeric_validation,
        selection_choices=item.get("selection_choices", []),
        verification_prompt=item.get("verification_prompt", ""),
        order=item.get("order", index),
        fixed_position=item.get("fixed_position"),
        # Legacy fields
        priority=priority,
        category=category,
        is_required=item.get("is_required", True),
        needs_photo=item.get("needs_photo", False),
    )


@app.post("/api/templates")
async def create_template(
    request: CreateTemplateRequest,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Create a new checklist template."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    template_id = str(uuid.uuid4())

    items = [parse_check_item(item, i) for i, item in enumerate(request.items)]

    template = ChecklistTemplate(
        id=template_id,
        title=request.title,
        description=request.description,
        duration=request.duration,
        items=items,
        knowledge_context=request.knowledge_context,
        randomize_order=request.randomize_order,
    )

    firestore_service.create_template(template)

    return {"success": True, "template_id": template_id, "template": template.model_dump()}


@app.get("/api/templates")
async def list_templates(
    current_user: CurrentUser = Depends(require_tenant),
):
    """List all active templates for the current tenant."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    templates = firestore_service.list_templates(active_only=True)
    return {"templates": [t.model_dump() for t in templates]}


@app.get("/api/templates/{template_id}")
async def get_template(
    template_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Get a specific template."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    template = firestore_service.get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template.model_dump()


class UpdateTemplateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    duration: Optional[int] = None
    items: Optional[list[dict]] = None
    knowledge_context: Optional[str] = None
    is_active: Optional[bool] = None
    randomize_order: Optional[bool] = None


@app.put("/api/templates/{template_id}")
async def update_template(
    template_id: str,
    request: UpdateTemplateRequest,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Update an existing checklist template."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    template = firestore_service.get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Build update data from non-None fields
    update_data = {}
    if request.title is not None:
        update_data["title"] = request.title
    if request.description is not None:
        update_data["description"] = request.description
    if request.duration is not None:
        update_data["duration"] = request.duration
    if request.knowledge_context is not None:
        update_data["knowledge_context"] = request.knowledge_context
    if request.is_active is not None:
        update_data["is_active"] = request.is_active
    if request.randomize_order is not None:
        update_data["randomize_order"] = request.randomize_order
    if request.items is not None:
        # Convert items to CheckItem format using the helper function
        items = [parse_check_item(item, i) for i, item in enumerate(request.items)]
        update_data["items"] = [item.model_dump() for item in items]

    if update_data:
        firestore_service.update_template(template_id, update_data)

    # Get updated template
    updated_template = firestore_service.get_template(template_id)
    return {"success": True, "template": updated_template.model_dump()}


@app.delete("/api/templates/{template_id}")
async def delete_template(
    template_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Delete a checklist template (soft delete by setting is_active to False)."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    template = firestore_service.get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Soft delete - just mark as inactive
    firestore_service.update_template(template_id, {"is_active": False})
    return {"success": True, "message": "Template deleted"}


# ==================== Session Endpoints ====================

@app.get("/api/sessions")
async def list_sessions(
    current_user: CurrentUser = Depends(require_tenant),
):
    """List in-progress checkout sessions for the current user."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    in_progress_statuses = ["draft", "phase1", "phase2", "phase3", "pending_review"]
    sessions = firestore_service.list_sessions(
        operator_id=current_user.uid,
        status_in=in_progress_statuses,
        limit=20,
    )
    return {
        "sessions": [
            {
                "id": s.id,
                "template_id": s.template_id,
                "operator_name": s.operator_name,
                "next_operator_name": s.next_operator_name,
                "status": s.status.value if hasattr(s.status, "value") else s.status,
                "current_phase": s.current_phase,
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "item_count": len(s.item_responses),
            }
            for s in sessions
        ]
    }


@app.delete("/api/sessions/{session_id}")
async def delete_session(
    session_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Delete an in-progress checkout session. Only the creator can delete."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    session = firestore_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Only the creator can delete
    if session.operator_id != current_user.uid:
        raise HTTPException(status_code=403, detail="この操作は作成者のみ実行できます")

    # Only allow deletion of in-progress sessions
    status_str = str(session.status.value) if hasattr(session.status, 'value') else str(session.status)
    if status_str == "completed":
        raise HTTPException(status_code=400, detail="完了済みのセッションは削除できません")

    # Delete session document and its turns subcollection
    firestore_service.delete_session(session_id)
    return {"success": True, "message": "セッションを削除しました"}


@app.post("/api/sessions")
async def start_session(
    request: StartSessionRequest,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Start a new checkout session."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    template = firestore_service.get_template(request.template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    session_id = str(uuid.uuid4())

    session = CheckoutSession(
        id=session_id,
        template_id=request.template_id,
        tenant_id=current_user.tenant_id,
        operator_id=request.operator_id,
        operator_name=request.operator_name,
        next_operator_id=request.next_operator_id,
        next_operator_name=request.next_operator_name,
        current_item_id=template.items[0].id if template.items else None,
    )

    firestore_service.create_session(session)
    set_current_session(session_id)
    # Update tools with tenant-scoped service
    set_services(firestore_service, storage_service)

    # Create agent with template context
    agent = create_checkout_agent(
        template_title=template.title,
        template_items=[item.model_dump() for item in template.items],
        operator_name=request.operator_name,
        remaining_time=template.duration,
    )

    # Create ADK session
    adk_session = await session_service.create_session(
        app_name="handover_checklist",
        user_id=request.operator_id,
    )

    # Get initial greeting from agent
    runner = Runner(app_name="handover_checklist", agent=agent, session_service=session_service)

    # Extract response text
    response_text = ""
    quick_replies = []

    # Initial message to trigger greeting
    async for event in runner.run_async(
        session_id=adk_session.id,
        user_id=request.operator_id,
        new_message=types.Content(
            role="user",
            parts=[types.Part(text="チェックアウトを開始します")],
        ),
    ):
        if hasattr(event, "content") and event.content and event.content.parts:
            for part in event.content.parts:
                if hasattr(part, "text") and part.text:
                    response_text += part.text

    # Parse quick replies if present
    if "[QUICK_REPLIES:" in response_text:
        parts = response_text.split("[QUICK_REPLIES:")
        response_text = parts[0].strip()
        if len(parts) > 1:
            replies_part = parts[1].split("]")[0]
            quick_replies = [r.strip() for r in replies_part.split("|")]

    # Save the initial turn
    firestore_service.add_turn(session_id, "assistant", response_text, quick_replies=quick_replies)

    return {
        "success": True,
        "session_id": session_id,
        "adk_session_id": adk_session.id,
        "message": response_text,
        "quick_replies": quick_replies,
    }


# ==================== Internal Message Processing ====================

async def _process_message_internal(
    session_id: str,
    message: str,
    tenant_id: Optional[str],
    skip_log: bool = False,
    skip_user_only: bool = False,
) -> dict:
    """Internal function to process a message without requiring authentication.

    Used by both authenticated and voice endpoints.
    Args:
        skip_log: If True, don't save this exchange to turns (for initial greeting)
        skip_user_only: If True, only skip user message, but save AI response
    """
    fs = get_firestore_service(tenant_id)
    session = fs.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Allow both in_progress (legacy) and phase3 (new 4-phase flow) statuses
    # Convert status to string for comparison (handles both enum and string values)
    status_str = str(session.status.value) if hasattr(session.status, 'value') else str(session.status)
    allowed_statuses = ["in_progress", "phase3"]
    if status_str not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Session status '{status_str}' is not allowed. Must be one of {allowed_statuses}"
        )

    template = fs.get_template(session.template_id)
    set_current_session(session_id)
    set_services(fs, storage_service)

    # Get conversation history BEFORE saving current message
    # (so history doesn't include the current message)
    turns = fs.get_turns(session_id)

    # Save user message (skip if skip_log or skip_user_only is True)
    if not skip_log and not skip_user_only:
        fs.add_turn(session_id, "user", message)

    # Check if this is Phase 3 mode (new 4-phase flow)
    is_phase3 = session.status == "phase3"

    # Generate responses summary for Phase 3
    responses_summary = None
    if is_phase3 and template:
        summary_lines = []
        item_num = 0
        for response in session.item_responses:
            item = next((i for i in template.items if i.id == response.item_id), None)
            item_name = item.topic if item else response.item_id
            item_num += 1
            value = get_response_value_str(response)
            status = "NG" if response.item_id in session.ng_item_ids else "OK"
            line = f"{item_num}. **{item_name}**: {value} （{status}）"
            # Add expected_answer mismatch indicator
            if item and getattr(item, 'expected_answer', 'ok') == 'ng' and response.item_type == ItemType.CHECKBOX:
                if response.checkbox_value is True:  # User marked OK but expected NG
                    line += " ⚠️ 期待回答不一致"
            summary_lines.append(line)
            if response.ng_detail:
                summary_lines.append(f"   → 詳細: {response.ng_detail}")
        responses_summary = "\n".join(summary_lines) if summary_lines else "（回答なし）"

    # Create agent with current context
    agent = create_checkout_agent(
        template_title=template.title if template else "",
        template_items=[item.model_dump() for item in template.items] if template else [],
        operator_name=session.operator_name,
        remaining_time=template.duration if template else 600,
        ng_item_ids=list(session.ng_item_ids) if is_phase3 else None,
        responses_summary=responses_summary,
        phase3_mode=is_phase3,
    )

    # Append conversation history to agent instruction (not user message)
    # This ensures the AI recognizes the conversation context and continues
    # from where it left off, instead of restarting the conversation.
    if turns:
        history_text = "\n\n## これまでの会話履歴（※この続きから応答すること。最初のメッセージの繰り返し禁止）:\n"
        for turn in turns:
            role_label = "担当者" if turn.get("role") == "user" else "AI"
            history_text += f"{role_label}: {turn.get('content', '')}\n"
        history_text += "\n※上記の会話の続きとして、担当者の最新メッセージに対して応答してください。すでに質問した項目について再度聞かないこと。直前に質問した項目に対する回答として処理すること。\n"
        agent.instruction += history_text

    # Build message history for ADK
    runner = Runner(app_name="handover_checklist", agent=agent, session_service=session_service)

    # Always create a new ADK session for each message
    adk_session = await session_service.create_session(
        app_name="handover_checklist",
        user_id=session.operator_id,
    )
    adk_session_id = adk_session.id

    # Extract response
    response_text = ""
    quick_replies = []
    photo_request = None
    is_complete = False

    # Run agent with only the current message (history is in the instruction)
    async for event in runner.run_async(
        session_id=adk_session_id,
        user_id=session.operator_id,
        new_message=types.Content(
            role="user",
            parts=[types.Part(text=message)],
        ),
    ):
        if hasattr(event, "content") and event.content and event.content.parts:
            for part in event.content.parts:
                if hasattr(part, "text") and part.text:
                    response_text += part.text
        # Check for tool calls that indicate completion
        if hasattr(event, "tool_calls") and event.tool_calls:
            for tool_call in event.tool_calls:
                if hasattr(tool_call, "name") and tool_call.name == "complete_checkout":
                    is_complete = True

    # Parse quick replies
    if "[QUICK_REPLIES:" in response_text:
        parts = response_text.split("[QUICK_REPLIES:")
        response_text = parts[0].strip()
        if len(parts) > 1:
            replies_part = parts[1].split("]")[0]
            quick_replies = [r.strip() for r in replies_part.split("|")]

    # Parse photo request
    if "[PHOTO_REQUEST:" in response_text:
        parts = response_text.split("[PHOTO_REQUEST:")
        response_text = parts[0].strip()
        if len(parts) > 1:
            photo_part = parts[1].split("]")[0]
            photo_request = {"description": photo_part.strip()}

    # Detect completion from response text (for Phase 3 final review)
    # Note: "お疲れ様でした" は会話途中でも使われるため除外
    completion_phrases = ["引き継ぎ簿を作成します", "引継ぎ簿を作成します"]
    if any(phrase in response_text for phrase in completion_phrases):
        is_complete = True

    # Save assistant response
    # - skip_log=True: skip both user message and AI response
    # - skip_user_only=True: skip only user message, save AI response
    if not skip_log:
        fs.add_turn(session_id, "assistant", response_text, quick_replies=quick_replies)

    result = {
        "success": True,
        "message": response_text,
        "quick_replies": quick_replies,
        "is_complete": is_complete,
    }

    if photo_request:
        result["photo_request"] = photo_request

    return result


@app.post("/api/sessions/{session_id}/messages")
async def send_message(
    session_id: str,
    request: SendMessageRequest,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Send a message in the checkout session."""
    # Get session to check status
    firestore_service = get_firestore_service(current_user.tenant_id)
    session = firestore_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Use the internal processing function
    result = await _process_message_internal(
        session_id=session_id,
        message=request.message,
        tenant_id=current_user.tenant_id,
        skip_log=request.skip_log,
        skip_user_only=request.skip_user_only,
    )

    # If complete, generate handover note (only for legacy in_progress sessions)
    # Phase 3 sessions will generate handover in Phase 4 (complete_session_flow)
    status_str = str(session.status.value) if hasattr(session.status, 'value') else str(session.status)
    if result.get("is_complete") and status_str != "phase3":
        handover = await generate_handover(session_id, current_user.tenant_id)
        result["handover"] = handover

    return result


@app.get("/api/sessions/{session_id}")
async def get_session(
    session_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Get session details."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    session = firestore_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session.model_dump()


@app.get("/api/sessions/{session_id}/turns")
async def get_session_turns(
    session_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Get conversation history for a session."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    turns = firestore_service.get_turns(session_id)
    return {"turns": turns}


# ==================== Attachment Endpoints ====================

@app.post("/api/sessions/{session_id}/attachments")
async def upload_attachment(
    session_id: str,
    file: UploadFile = File(...),
    item_id: str = Form(...),
    current_user: CurrentUser = Depends(require_tenant),
):
    """Upload a photo attachment."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    session = firestore_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Read file content
    file_content = await file.read()

    # Upload to storage
    upload_result = storage_service.upload_file(
        file_data=file_content,
        file_name=file.filename,
        content_type=file.content_type,
        session_id=session_id,
        item_id=item_id,
    )

    # Save attachment record
    attachment = Attachment(
        id=upload_result["id"],
        session_id=session_id,
        item_id=item_id,
        file_name=file.filename,
        file_type=file.content_type,
        storage_url=upload_result["storage_url"],
        thumbnail_url=upload_result.get("thumbnail_url"),
        uploaded_by=session.operator_id,
    )

    firestore_service.add_attachment(attachment)

    return {
        "success": True,
        "attachment_id": attachment.id,
        "storage_url": attachment.storage_url,
    }


@app.get("/api/sessions/{session_id}/attachments")
async def get_attachments(
    session_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Get all attachments for a session."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    attachments = firestore_service.get_attachments(session_id)
    return {"attachments": [a.model_dump() for a in attachments]}


# ==================== Phase-based Checkout Endpoints ====================

@app.post("/api/sessions/{session_id}/phase1/save")
async def phase1_save(
    session_id: str,
    request: Phase1SaveRequest,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Save Phase 1 responses (checkbox, numeric, text, selection)."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    session = firestore_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Convert to ItemResponse objects
    phase1_responses = []
    phase1_item_ids = set()
    for r in request.responses:
        item_type = ItemType(r.item_type)
        # Convert ng_status string to enum if present
        ng_status_enum = None
        if r.ng_status:
            try:
                ng_status_enum = NGStatus(r.ng_status)
            except ValueError:
                pass

        response = ItemResponse(
            item_id=r.item_id,
            item_type=item_type,
            checkbox_value=r.checkbox_value,
            numeric_value=r.numeric_value,
            text_value=r.text_value,
            selection_value=r.selection_value,
            ng_status=ng_status_enum,
            ng_detail=r.ng_detail,
        )
        phase1_responses.append(response)
        phase1_item_ids.add(r.item_id)

    # Preserve existing non-Phase 1 responses (e.g., photo responses)
    existing_other_responses = [
        r for r in session.item_responses
        if r.item_id not in phase1_item_ids
    ]

    # Detect if Phase 1 responses changed (to reset AI conversation if needed)
    old_phase1_map = {
        r.item_id: r for r in session.item_responses
        if r.item_id in phase1_item_ids
    }
    phase1_changed = False
    for new_r in phase1_responses:
        old_r = old_phase1_map.get(new_r.item_id)
        if old_r is None:
            phase1_changed = True
            break
        if (old_r.checkbox_value != new_r.checkbox_value
                or old_r.numeric_value != new_r.numeric_value
                or old_r.text_value != new_r.text_value
                or old_r.selection_value != new_r.selection_value):
            phase1_changed = True
            break

    # If Phase 1 data changed and AI conversation exists, clear it for re-do
    if phase1_changed and session.ai_conversation_mode:
        firestore_service.clear_turns(session_id)
        firestore_service.update_session(session_id, {"ai_conversation_mode": None})

    firestore_service.save_item_responses(session_id, existing_other_responses + phase1_responses)

    return {"success": True, "saved_count": len(phase1_responses)}


@app.post("/api/sessions/{session_id}/phase1/complete")
async def phase1_complete(
    session_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Complete Phase 1 and move to Phase 2."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    session = firestore_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    template = firestore_service.get_template(session.template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Validate all required Phase 1 items have responses
    phase1_types = {ItemType.CHECKBOX, ItemType.NUMERIC, ItemType.TEXT, ItemType.SELECTION}
    required_phase1_items = [
        item for item in template.items
        if item.item_type in phase1_types and item.is_required
    ]
    response_map = {r.item_id: r for r in session.item_responses}

    missing_items = []
    for item in required_phase1_items:
        response = response_map.get(item.id)
        is_missing = False

        if response is None:
            is_missing = True
        elif item.item_type == ItemType.CHECKBOX and response.checkbox_value is None:
            is_missing = True
        elif item.item_type == ItemType.NUMERIC and response.numeric_value is None:
            is_missing = True
        elif item.item_type == ItemType.TEXT and not (response.text_value or "").strip():
            is_missing = True
        elif item.item_type == ItemType.SELECTION and response.selection_value is None:
            is_missing = True

        if is_missing:
            missing_items.append({
                "item_id": item.id,
                "topic": item.topic,
                "item_type": item.item_type.value,
            })

    if missing_items:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "error": "未回答の必須項目があります",
                "missing_items": missing_items,
            },
        )

    # Validate responses and identify NG items
    ng_item_ids = []
    for response in session.item_responses:
        item = next((i for i in template.items if i.id == response.item_id), None)
        if not item:
            continue

        # Check checkbox items - respects expected_answer inversion
        if response.item_type == ItemType.CHECKBOX:
            expected = getattr(item, 'expected_answer', 'ok')
            if is_checkbox_ng(response.checkbox_value, expected):
                ng_item_ids.append(response.item_id)

        # Check numeric validation
        if response.item_type == ItemType.NUMERIC and item.numeric_validation:
            is_valid, msg = validate_numeric(response.numeric_value, item.numeric_validation)
            if not is_valid:
                ng_item_ids.append(response.item_id)

    # Check if there are photo items
    photo_items = [i for i in template.items if i.item_type == ItemType.PHOTO]
    has_photo_phase = len(photo_items) > 0

    if has_photo_phase:
        # Move to Phase 2
        firestore_service.update_session_phase(
            session_id, 2, SessionStatus.PHASE2, ng_item_ids
        )
        return {"success": True, "next_phase": 2, "ng_items": ng_item_ids}
    else:
        # Skip to Phase 3
        firestore_service.update_session_phase(
            session_id, 3, SessionStatus.PHASE3, ng_item_ids
        )
        return {"success": True, "next_phase": 3, "ng_items": ng_item_ids}


def validate_numeric(value: Optional[float], validation: NumericValidation) -> tuple[bool, str]:
    """Validate numeric value against validation rules."""
    if value is None:
        return False, "値が入力されていません"

    vtype = validation.validation_type

    if vtype == NumericValidationType.MAX:
        if validation.max_value is not None and value > validation.max_value:
            return False, f"値が上限({validation.max_value}{validation.unit})を超えています"

    elif vtype == NumericValidationType.MIN:
        if validation.min_value is not None and value < validation.min_value:
            return False, f"値が下限({validation.min_value}{validation.unit})を下回っています"

    elif vtype == NumericValidationType.RANGE:
        if validation.min_value is not None and value < validation.min_value:
            return False, f"値が範囲外です（{validation.min_value}〜{validation.max_value}{validation.unit}）"
        if validation.max_value is not None and value > validation.max_value:
            return False, f"値が範囲外です（{validation.min_value}〜{validation.max_value}{validation.unit}）"

    elif vtype == NumericValidationType.EXACT:
        if validation.expected_value is not None and value != validation.expected_value:
            return False, f"値が期待値({validation.expected_value}{validation.unit})と一致しません"

    elif vtype == NumericValidationType.TOLERANCE:
        if validation.base_value is not None and validation.tolerance is not None:
            diff = abs(value - validation.base_value)
            if diff > validation.tolerance:
                return False, f"値が許容範囲外です（{validation.base_value}±{validation.tolerance}{validation.unit}）"

    return True, ""


@app.post("/api/sessions/{session_id}/phase2/upload")
async def phase2_upload(
    session_id: str,
    file: UploadFile = File(...),
    item_id: str = Form(...),
    current_user: CurrentUser = Depends(require_tenant),
):
    """Upload photo for Phase 2 item."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    session = firestore_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Read file content
    file_content = await file.read()

    # Upload to storage
    upload_result = storage_service.upload_file(
        file_data=file_content,
        file_name=file.filename,
        content_type=file.content_type,
        session_id=session_id,
        item_id=item_id,
    )

    # Save attachment record
    attachment = Attachment(
        id=upload_result["id"],
        session_id=session_id,
        item_id=item_id,
        file_name=file.filename,
        file_type=file.content_type,
        storage_url=upload_result["storage_url"],
        thumbnail_url=upload_result.get("thumbnail_url"),
        uploaded_by=session.operator_id,
    )

    firestore_service.add_attachment(attachment)

    # Update item response with photo URL
    response = ItemResponse(
        item_id=item_id,
        item_type=ItemType.PHOTO,
        photo_url=upload_result["storage_url"],
        photo_verification_result="pending",
    )
    firestore_service.save_item_response(session_id, response)

    return {
        "success": True,
        "attachment_id": attachment.id,
        "storage_url": attachment.storage_url,
    }


PHOTO_VERIFICATION_PROMPT = """あなたは工場・現場の安全確認チェックリストの写真判定AIです。
写真が以下のチェック項目の要件を満たしているかを厳密に判定してください。

## チェック項目
項目名: {topic}
確認内容: {main_question}
{verification_section}

## 重要な判定ルール
- 写真の画質や構図ではなく、チェック項目の要件が実際に満たされているかを判定してください
- 例：「ヘルメットの着用」なら、人物がヘルメットを実際に被っているかを確認
- 例：「電源OFF」なら、スイッチがOFF位置にあるかを確認
- 要件が写真から確認できない場合は "fail" としてください
- 判断に迷う場合は安全側に倒し "fail" としてください

判定結果をJSON形式で返してください：
{{
  "result": "pass" または "fail",
  "message": "判定理由の説明（日本語で）"
}}"""


@app.post("/api/sessions/{session_id}/phase2/verify")
async def phase2_verify(
    session_id: str,
    item_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Verify uploaded photo using AI."""
    import json
    import re
    from google import genai

    firestore_service = get_firestore_service(current_user.tenant_id)
    session = firestore_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    template = firestore_service.get_template(session.template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Get the item and its verification prompt
    item = next((i for i in template.items if i.id == item_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    # Get the attachment
    attachment = firestore_service.get_attachment_by_item(session_id, item_id)
    if not attachment:
        raise HTTPException(status_code=404, detail="Photo not found")

    # Get the photo from storage
    photo_content = storage_service.download_file(attachment.storage_url)
    if not photo_content:
        raise HTTPException(status_code=500, detail="Failed to download photo")

    try:
        # Initialize Gemini client
        client = genai.Client(vertexai=True, project="tsugiai", location="global")

        # Create content with photo
        verification_section = ""
        if item.verification_prompt:
            verification_section = f"詳細な確認ポイント: {item.verification_prompt}"

        prompt = PHOTO_VERIFICATION_PROMPT.format(
            topic=item.topic,
            main_question=item.main_question,
            verification_section=verification_section,
        )
        file_part = types.Part.from_bytes(data=photo_content, mime_type=attachment.file_type)

        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=[
                types.Content(
                    role="user",
                    parts=[file_part, types.Part(text=prompt)],
                )
            ],
            config=types.GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=1024,
            ),
        )

        # Extract response text
        response_text = ""
        if response.candidates and response.candidates[0].content:
            for part in response.candidates[0].content.parts:
                if hasattr(part, "text") and part.text:
                    response_text += part.text

        # Parse JSON result
        result = "pending"
        message = ""
        json_match = re.search(r'\{[\s\S]*\}', response_text)
        if json_match:
            try:
                parsed = json.loads(json_match.group(0))
                result = parsed.get("result", "pending")
                message = parsed.get("message", "")
            except json.JSONDecodeError:
                result = "fail"
                message = "判定結果の解析に失敗しました"

        # Update item response with verification result
        item_response = ItemResponse(
            item_id=item_id,
            item_type=ItemType.PHOTO,
            photo_url=attachment.storage_url,
            photo_verification_result=result,
            photo_verification_message=message,
            is_valid=(result == "pass"),
        )
        firestore_service.save_item_response(session_id, item_response)

        # Add to NG items if failed
        if result == "fail" and item_id not in session.ng_item_ids:
            ng_items = list(session.ng_item_ids) + [item_id]
            firestore_service.update_session(session_id, {"ng_item_ids": ng_items})

        return {
            "success": True,
            "result": result,
            "message": message,
        }

    except Exception as e:
        return {
            "success": False,
            "error": f"写真の検証に失敗しました: {str(e)}",
        }


@app.post("/api/sessions/{session_id}/phase2/complete")
async def phase2_complete(
    session_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Complete Phase 2 and move to Phase 3."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    session = firestore_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Validate all required photo items have been uploaded
    template = firestore_service.get_template(session.template_id)
    if template:
        required_photo_items = [
            item for item in template.items
            if item.item_type == ItemType.PHOTO and item.is_required
        ]
        response_map = {r.item_id: r for r in session.item_responses}

        missing_items = []
        for item in required_photo_items:
            response = response_map.get(item.id)
            if response is None or not response.photo_url:
                missing_items.append({
                    "item_id": item.id,
                    "topic": item.topic,
                    "item_type": "photo",
                })

        if missing_items:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "未アップロードの写真項目があります",
                    "missing_items": missing_items,
                },
            )

    # Move to Phase 3
    firestore_service.update_session_phase(
        session_id, 3, SessionStatus.PHASE3
    )

    return {"success": True, "next_phase": 3}


@app.post("/api/sessions/{session_id}/phase3/start")
async def phase3_start(
    session_id: str,
    request: Phase3StartRequest,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Start Phase 3 with selected mode (chat/voice)."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    session = firestore_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    firestore_service.set_ai_conversation_mode(session_id, request.mode)

    return {"success": True, "mode": request.mode}


@app.post("/api/sessions/{session_id}/phase3/complete")
async def phase3_complete(
    session_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Complete Phase 3 and move to review phase."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    session = firestore_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    template = firestore_service.get_template(session.template_id)

    # Get conversation turns for the summary
    turns = firestore_service.get_turns(session_id)

    # Generate summary markdown with conversation history
    summary = generate_summary_markdown(session, template, turns)

    # Generate AI action items from conversation and responses
    from handover_agent.agent import generate_ai_action_items

    conversation_text = ""
    if turns:
        for turn in turns:
            role = turn.get("role", "unknown")
            content = turn.get("content", "")
            conversation_text += f"{role}: {content}\n"

    responses_summary = ""
    for resp in session.item_responses:
        item = next((i for i in template.items if i.id == resp.item_id), None) if template else None
        item_name = item.topic if item else resp.item_id
        value = get_response_value_str(resp)
        ng_mark = " [NG]" if resp.item_id in session.ng_item_ids or not resp.is_valid else ""
        ng_detail = f" - {resp.ng_detail}" if resp.ng_detail else ""
        responses_summary += f"- {item_name}: {value}{ng_mark}{ng_detail}\n"

    template_items_context = ""
    if template:
        for item in template.items:
            template_items_context += f"- {item.topic} ({item.item_type.value})\n"

    action_items = generate_ai_action_items(
        conversation_text=conversation_text,
        responses_summary=responses_summary,
        template_items_context=template_items_context,
    )

    firestore_service.update_session_summary(session_id, summary)
    firestore_service.update_session_action_items(session_id, action_items)
    firestore_service.update_session_phase(
        session_id, 4, SessionStatus.PENDING_REVIEW
    )

    return {"success": True, "next_phase": 4, "summary": summary, "action_items": action_items}


def generate_ai_conversation_summary(conversation_text: str) -> str:
    """Generate a prose summary of the AI conversation using Gemini."""
    from google import genai

    try:
        client = genai.Client()

        prompt = f"""以下は作業引き継ぎ時のAIと担当者の対話ログです。
この内容を次の担当者向けに、分かりやすい文章でサマリーしてください。

## ルール
1. 重要な報告事項や特記事項を中心にまとめる
2. 箇条書きではなく、読みやすい文章で書く
3. 「特になし」「大丈夫」などの回答は省略してよい
4. 問題があった場合は、その内容と対応状況を明記する
5. 次の担当者が知っておくべき情報を優先する
6. 100〜300文字程度で簡潔にまとめる
7. 敬語は使わず、です・ます調で書く

## 対話ログ
{conversation_text}

## サマリー（文章形式で出力）:"""

        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=1500,
            ),
        )

        if response and response.text:
            return response.text.strip()
        return ""
    except Exception as e:
        logger.error("Error generating AI summary: %s", e)
        return ""


def generate_summary_markdown(
    session: CheckoutSession,
    template: Optional[ChecklistTemplate],
    turns: Optional[list] = None
) -> str:
    """Generate summary markdown from session data including conversation history."""
    from datetime import datetime

    lines = [
        "# 引継ぎ簿",
        "",
        "## 基本情報",
        "",
        f"- **担当者**: {session.operator_name}",
        f"- **次担当**: {session.next_operator_name or '未指定'}",
        f"- **日時**: {datetime.now().strftime('%Y年%m月%d日 %H:%M')}",
        "",
    ]

    # Collect all items with responses
    all_items_for_table = []

    for response in session.item_responses:
        item = None
        if template:
            item = next((i for i in template.items if i.id == response.item_id), None)

        item_name = item.topic if item else response.item_id
        value = get_response_value_str(response)
        order = item.order if item else 999

        # Check if item is NG (respects expected_answer inversion)
        expected = getattr(item, 'expected_answer', 'ok') if item else 'ok'
        is_ng = (
            response.item_id in session.ng_item_ids or
            not response.is_valid or
            (response.item_type == ItemType.CHECKBOX and is_checkbox_ng(response.checkbox_value, expected))
        )

        status = "NG" if is_ng else "OK"
        all_items_for_table.append((item_name, value, status, order))

    # Sort by order
    all_items_for_table.sort(key=lambda x: x[3])

    # チェックリスト確認結果 (table format)
    lines.append("## ✅ チェックリスト確認結果")
    lines.append("")
    lines.append("| 項目 | 入力内容 | 状態 |")
    lines.append("|:-----|:---------|:----:|")

    for name, value, status, _ in all_items_for_table:
        status_badge = "✅" if status == "OK" else "⚠️"
        # Escape pipe characters in value
        escaped_value = value.replace("|", "\\|")
        lines.append(f"| {name} | {escaped_value} | {status_badge} |")

    if not all_items_for_table:
        lines.append("| (項目なし) | - | - |")
    lines.append("")

    # Add AI conversation section
    if turns:
        # Filter to user and assistant messages only
        phase3_turns = [t for t in turns if t.get("role") in ("user", "assistant")]

        if phase3_turns:
            # Generate AI conversation summary using Gemini
            lines.append("## 📝 AI確認のサマリー")
            lines.append("")

            # Build conversation text for summary
            # Skip initial greeting if first assistant message starts with "お疲れ様です"
            # This handles old sessions where the greeting was saved
            filtered_turns = phase3_turns
            if phase3_turns and phase3_turns[0].get("role") == "assistant":
                first_content = phase3_turns[0].get("content", "").strip()
                if first_content.startswith("お疲れ様です"):
                    # Skip the initial greeting
                    filtered_turns = phase3_turns[1:]

            # Also skip "チャットで確認します" if present (for backwards compatibility)
            filtered_turns = [
                t for t in filtered_turns
                if not (t.get("role") == "user" and t.get("content", "").strip() == "チャットで確認します")
            ]

            conversation_text = []
            for turn in filtered_turns:
                role = turn.get("role", "")
                content = turn.get("content", "").strip()
                if not content:
                    continue
                if role == "user":
                    conversation_text.append(f"担当者: {content}")
                elif role == "assistant":
                    conversation_text.append(f"AI: {content}")

            if conversation_text:
                # Generate AI summary
                ai_summary = generate_ai_conversation_summary("\n".join(conversation_text))
                if ai_summary:
                    lines.append(ai_summary)
                else:
                    lines.append("特記事項なし")
            else:
                lines.append("特記事項なし")
            lines.append("")

            # Full conversation log (simple format)
            lines.append("## 💬 AI確認の対話ログ")
            lines.append("")

            # (reuse filtered_turns from above - already excludes initial greeting)
            for turn in filtered_turns:
                role = turn.get("role", "")
                content = turn.get("content", "").strip()

                if not content:
                    continue

                if role == "user":
                    lines.append(f"👤 担当者: {content}")
                    lines.append("")
                elif role == "assistant":
                    lines.append(f"🤖 AI: {content}")
                    lines.append("")

    lines.append("---")

    return "\n".join(lines)


def get_response_value_str(response: ItemResponse) -> str:
    """Get string representation of response value."""
    if response.item_type == ItemType.CHECKBOX:
        return "OK" if response.checkbox_value else "NG"
    elif response.item_type == ItemType.NUMERIC:
        return str(response.numeric_value) if response.numeric_value is not None else "-"
    elif response.item_type == ItemType.TEXT:
        return response.text_value or "-"
    elif response.item_type == ItemType.SELECTION:
        return response.selection_value or "-"
    elif response.item_type == ItemType.PHOTO:
        result = response.photo_verification_result or "pending"
        return "合格" if result == "pass" else ("不合格" if result == "fail" else "確認中")
    return "-"


@app.put("/api/sessions/{session_id}/summary")
async def update_summary(
    session_id: str,
    request: UpdateSummaryRequest,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Update session summary markdown."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    session = firestore_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    firestore_service.update_session_summary(
        session_id, request.summary_markdown, edited=True
    )

    return {"success": True}


@app.put("/api/sessions/{session_id}/action-items")
async def update_action_items(
    session_id: str,
    request: UpdateActionItemsRequest,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Update session action items (Phase 4 - before completion)."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    session = firestore_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    firestore_service.update_session_action_items(session_id, request.action_items)

    return {"success": True}


@app.post("/api/sessions/{session_id}/complete")
async def complete_session_flow(
    session_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Complete the checkout flow and create handover note."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    session = firestore_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Create handover note
    handover = await generate_handover(session_id, current_user.tenant_id)

    # Mark session as completed
    firestore_service.complete_session(session_id)

    return {"success": True, "handover": handover}


@app.post("/api/sessions/{session_id}/restart")
async def restart_session(
    session_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Restart session from Phase 1."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    session = firestore_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Clear conversation turns
    firestore_service.clear_turns(session_id)

    # Reset session to Phase 1
    firestore_service.restart_session(session_id)

    return {"success": True, "message": "Session restarted"}


@app.post("/api/sessions/{session_id}/go-back")
async def go_back_phase(
    session_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Go back to previous phase."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    session = firestore_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    template = firestore_service.get_template(session.template_id)
    has_photo_items = template and any(item.item_type == ItemType.PHOTO for item in template.items)

    status_str = str(session.status.value) if hasattr(session.status, 'value') else str(session.status)

    # Determine previous phase based on current status
    if status_str == "completed":
        if session.current_phase == 3:
            # Session was erroneously completed from Phase 3 (agent tool call).
            # Go back as if in Phase 3.
            if has_photo_items:
                firestore_service.update_session_phase(session_id, 2, SessionStatus.PHASE2)
                return {"success": True, "previous_phase": 2}
            else:
                firestore_service.update_session_phase(session_id, 1, SessionStatus.PHASE1)
                return {"success": True, "previous_phase": 1}
        else:
            # Legitimately completed -> Phase 4 (pending_review)
            firestore_service.update_session_phase(session_id, 4, SessionStatus.PENDING_REVIEW)
            return {"success": True, "previous_phase": 4}
    elif status_str == "pending_review":
        # Phase 4 -> Phase 3
        firestore_service.update_session_phase(session_id, 3, SessionStatus.PHASE3)
        return {"success": True, "previous_phase": 3}
    elif status_str == "phase3":
        # Phase 3 -> Phase 2 (if has photo items) or Phase 1 (if no photo items)
        if has_photo_items:
            firestore_service.update_session_phase(session_id, 2, SessionStatus.PHASE2)
            return {"success": True, "previous_phase": 2}
        else:
            firestore_service.update_session_phase(session_id, 1, SessionStatus.PHASE1)
            return {"success": True, "previous_phase": 1}
    elif status_str == "phase2":
        # Phase 2 -> Phase 1
        firestore_service.update_session_phase(session_id, 1, SessionStatus.PHASE1)
        return {"success": True, "previous_phase": 1}
    else:
        # Already at Phase 1 or invalid status
        return {"success": False, "message": "Cannot go back from this phase"}


@app.post("/api/handovers/{handover_id}/cancel")
async def cancel_handover(
    handover_id: str,
    request: CancelHandoverRequest,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Cancel a handover note (admin action)."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    handover = firestore_service.get_handover(handover_id)
    if not handover:
        raise HTTPException(status_code=404, detail="Handover not found")

    firestore_service.cancel_handover(
        handover_id,
        cancelled_by=current_user.uid,
        reason=request.reason,
    )

    return {"success": True, "message": "Handover cancelled"}


@app.post("/api/handovers/{handover_id}/uncancel")
async def uncancel_handover(
    handover_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Uncancel a handover note (admin action)."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    handover = firestore_service.get_handover(handover_id)
    if not handover:
        raise HTTPException(status_code=404, detail="Handover not found")

    firestore_service.uncancel_handover(handover_id)

    return {"success": True, "message": "Handover uncancelled"}


# ==================== Handover Endpoints ====================

async def generate_handover(session_id: str, tenant_id: Optional[str] = None) -> dict:
    """Generate handover note for a completed session."""
    firestore_service = get_firestore_service(tenant_id)
    session = firestore_service.get_session(session_id)
    if not session:
        return {"error": "Session not found"}

    # Get template for item names
    template = firestore_service.get_template(session.template_id)
    turns = firestore_service.get_turns(session_id)
    attachments = firestore_service.get_attachments(session_id)

    # Use the new generate_summary_markdown for table-based format
    summary_markdown = generate_summary_markdown(session, template, turns)

    # Add attachments section if any
    if attachments:
        attachment_lines = ["\n## 📷 添付写真\n"]
        for att in attachments:
            att_dict = att.model_dump() if hasattr(att, 'model_dump') else att
            attachment_lines.append(f"- [{att_dict.get('file_name', '写真')}]({att_dict.get('storage_url', '')})")
        summary_markdown += "\n".join(attachment_lines)

    # Extract data for backwards compatibility
    ng_items = [
        item.topic for item in (template.items if template else [])
        if item.id in session.ng_item_ids
    ]

    # Save handover note
    # Set is_confirmed=True since user completed the full checkout flow with confirmation
    from datetime import datetime
    handover_id = str(uuid.uuid4())

    handover = HandoverNote(
        id=handover_id,
        session_id=session_id,
        template_id=session.template_id,
        operator_id=session.operator_id,
        operator_name=session.operator_name,
        next_operator_id=session.next_operator_id,
        next_operator_name=session.next_operator_name,
        summary_markdown=summary_markdown,
        extracted_data={
            "critical_items": ng_items,
            "pending_tasks": [],
            "equipment_issues": [],
            "safety_notes": [],
            "general_notes": [],
        },
        is_confirmed=True,
        confirmed_at=datetime.now().isoformat(),
        confirmed_by=session.operator_id,
        action_items=session.action_items,
    )

    firestore_service.create_handover(handover)

    # Create inbox notification for next operator if specified
    if session.next_operator_id:
        inbox_item = InboxItem(
            id=str(uuid.uuid4()),
            handover_id=handover_id,
            user_id=session.next_operator_id,
            tenant_id=tenant_id,
            handover_title=template.title if template else "引き継ぎ",
            operator_name=session.operator_name,
            created_at=datetime.now(),
            is_read=False,
            is_deleted=False,
        )
        firestore_service.create_inbox_item(inbox_item)

    return handover.model_dump()


@app.get("/api/handovers")
async def list_handovers(
    operator_id: Optional[str] = None,
    next_operator_id: Optional[str] = None,
    limit: int = 50,
    current_user: CurrentUser = Depends(require_tenant),
):
    """List handover notes."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    handovers = firestore_service.list_handovers(
        operator_id=operator_id,
        next_operator_id=next_operator_id,
        limit=limit,
    )
    return {"handovers": [h.model_dump() for h in handovers]}


@app.get("/api/handovers/{handover_id}")
async def get_handover(
    handover_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Get a specific handover note."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    handover = firestore_service.get_handover(handover_id)
    if not handover:
        raise HTTPException(status_code=404, detail="Handover not found")
    return handover.model_dump()


@app.post("/api/handovers/{handover_id}/confirm")
async def confirm_handover(
    handover_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Confirm a handover note."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    handover = firestore_service.get_handover(handover_id)
    if not handover:
        raise HTTPException(status_code=404, detail="Handover not found")

    firestore_service.confirm_handover(handover_id)
    return {"success": True, "message": "Handover confirmed"}


@app.delete("/api/handovers/{handover_id}")
async def delete_handover(
    handover_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Delete a handover note (admin action)."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    handover = firestore_service.get_handover(handover_id)
    if not handover:
        raise HTTPException(status_code=404, detail="Handover not found")

    # Also delete associated inbox items
    firestore_service.delete_inbox_items_for_handover(handover_id)
    firestore_service.delete_handover(handover_id)
    return {"success": True, "message": "Handover deleted"}


# ==================== Comment Endpoints ====================

@app.post("/api/handovers/{handover_id}/comments")
async def add_comment(
    handover_id: str,
    request: AddCommentRequest,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Add a comment to a handover note."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    handover = firestore_service.get_handover(handover_id)
    if not handover:
        raise HTTPException(status_code=404, detail="Handover not found")

    comment = Comment(
        id=str(uuid.uuid4()),
        handover_id=handover_id,
        author_id=request.author_id,
        author_name=request.author_name,
        content=request.content,
    )

    firestore_service.add_comment(comment)

    return {"success": True, "comment_id": comment.id}


@app.get("/api/handovers/{handover_id}/comments")
async def get_comments(
    handover_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Get all comments for a handover."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    comments = firestore_service.get_comments(handover_id)
    return {"comments": [c.model_dump() for c in comments]}


@app.post("/api/handovers/{handover_id}/comments/{comment_id}/resolve")
async def resolve_comment(
    handover_id: str,
    comment_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Mark a comment as resolved."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    firestore_service.resolve_comment(handover_id, comment_id)
    return {"success": True, "message": "Comment resolved"}


@app.post("/api/handovers/{handover_id}/action-responses")
async def save_action_response(
    handover_id: str,
    request: ActionResponseRequest,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Save action item response (next operator executes action)."""
    from datetime import datetime
    from models.checklist import ActionItemResponse, ItemType

    firestore_service = get_firestore_service(current_user.tenant_id)

    # Get the handover
    handover = firestore_service.get_handover(handover_id)
    if not handover:
        raise HTTPException(status_code=404, detail="Handover not found")

    # Create action response
    action_response = ActionItemResponse(
        action_id=request.action_id,
        item_type=ItemType(request.item_type),
        checkbox_value=request.checkbox_value,
        numeric_value=request.numeric_value,
        text_value=request.text_value,
        selection_value=request.selection_value,
        note=request.note,
        completed_at=datetime.now(),
        completed_by=request.completed_by,
        completed_by_name=request.completed_by_name,
    )

    # Save to firestore
    firestore_service.save_action_response(handover_id, action_response)

    return {"success": True, "message": "Action response saved"}


# ==================== Inbox Endpoints ====================

from models.checklist import InboxItem


@app.get("/api/inbox")
async def list_inbox(
    current_user: CurrentUser = Depends(require_tenant),
    limit: int = 50,
    offset: int = 0,
    unread_only: bool = False,
):
    """List inbox items for the current user."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    items = firestore_service.list_inbox_items(
        user_id=current_user.uid,
        include_deleted=False,
        unread_only=unread_only,
        limit=limit,
        offset=offset,
    )
    return {
        "items": [item.model_dump() for item in items],
        "total": len(items),
    }


@app.get("/api/inbox/count")
async def get_inbox_unread_count(
    current_user: CurrentUser = Depends(require_tenant),
):
    """Get unread inbox count for the current user."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    count = firestore_service.get_inbox_unread_count(current_user.uid)
    return {"count": count}


@app.get("/api/inbox/{item_id}")
async def get_inbox_item(
    item_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Get a specific inbox item."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    item = firestore_service.get_inbox_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")
    if item.user_id != current_user.uid:
        raise HTTPException(status_code=403, detail="Access denied")
    return item.model_dump()


@app.post("/api/inbox/{item_id}/read")
async def mark_inbox_read(
    item_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Mark an inbox item as read."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    item = firestore_service.get_inbox_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")
    if item.user_id != current_user.uid:
        raise HTTPException(status_code=403, detail="Access denied")
    firestore_service.mark_inbox_read(item_id)
    return {"success": True, "message": "Marked as read"}


@app.post("/api/inbox/{item_id}/unread")
async def mark_inbox_unread(
    item_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Mark an inbox item as unread."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    item = firestore_service.get_inbox_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")
    if item.user_id != current_user.uid:
        raise HTTPException(status_code=403, detail="Access denied")
    firestore_service.mark_inbox_unread(item_id)
    return {"success": True, "message": "Marked as unread"}


@app.delete("/api/inbox/{item_id}")
async def delete_inbox_item(
    item_id: str,
    current_user: CurrentUser = Depends(require_tenant),
):
    """Delete an inbox item (soft delete - handover is preserved)."""
    firestore_service = get_firestore_service(current_user.tenant_id)
    item = firestore_service.get_inbox_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")
    if item.user_id != current_user.uid:
        raise HTTPException(status_code=403, detail="Access denied")
    firestore_service.delete_inbox_item(item_id)
    return {"success": True, "message": "Inbox item deleted"}


# ==================== Template Builder Endpoints ====================

@app.post("/api/builder/chat")
async def template_builder_chat(request: TemplateBuilderRequest):
    """Chat with the template builder agent."""
    runner = Runner(app_name="template_builder", agent=template_builder_agent, session_service=session_service)

    # Use existing session if provided, otherwise create new one
    builder_session_id = None

    if request.session_id:
        # Try to get existing session
        try:
            existing_session = await session_service.get_session(
                app_name="template_builder",
                user_id="builder",
                session_id=request.session_id,
            )
            if existing_session:
                builder_session_id = existing_session.id
        except Exception:
            # Session not found, will create new one
            pass

    # Create new session if needed
    if not builder_session_id:
        adk_session = await session_service.create_session(
            app_name="template_builder",
            user_id="builder",
        )
        builder_session_id = adk_session.id

    # Extract response
    response_text = ""
    template_data = None

    async for event in runner.run_async(
        session_id=builder_session_id,
        user_id="builder",
        new_message=types.Content(
            role="user",
            parts=[types.Part(text=request.message)],
        ),
    ):
        if hasattr(event, "content") and event.content and event.content.parts:
            for part in event.content.parts:
                if hasattr(part, "text") and part.text:
                    response_text += part.text
                # Check for function response in parts
                if hasattr(part, "function_response") and part.function_response:
                    func_response = part.function_response
                    if hasattr(func_response, "response") and func_response.response:
                        resp_data = func_response.response
                        if isinstance(resp_data, dict) and "template" in resp_data:
                            template_data = resp_data["template"]
        # Check for tool results (alternative structure)
        if hasattr(event, "tool_results") and event.tool_results:
            for result in event.tool_results:
                if isinstance(result, dict) and "template" in result:
                    template_data = result["template"]
        # Check for actions with function responses
        if hasattr(event, "actions") and event.actions:
            for action in event.actions:
                if hasattr(action, "function_responses"):
                    for func_resp in action.function_responses:
                        if hasattr(func_resp, "response"):
                            resp_data = func_resp.response
                            if isinstance(resp_data, dict) and "template" in resp_data:
                                template_data = resp_data["template"]

    # Try to extract template from response text if not found via function calls
    # AI might output JSON directly in the response
    if not template_data and response_text:
        import json
        import re
        # Look for JSON block in response
        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', response_text)
        if json_match:
            try:
                parsed = json.loads(json_match.group(1))
                if "title" in parsed and "items" in parsed:
                    template_data = parsed
            except json.JSONDecodeError:
                pass
        # Also try to find raw JSON object
        if not template_data:
            json_match = re.search(r'\{[\s\S]*"title"[\s\S]*"items"[\s\S]*\}', response_text)
            if json_match:
                try:
                    parsed = json.loads(json_match.group(0))
                    if "title" in parsed and "items" in parsed:
                        template_data = parsed
                except json.JSONDecodeError:
                    pass

    # Parse quick replies
    quick_replies = []
    if "[QUICK_REPLIES:" in response_text:
        parts = response_text.split("[QUICK_REPLIES:")
        response_text = parts[0].strip()
        if len(parts) > 1:
            replies_part = parts[1].split("]")[0]
            quick_replies = [r.strip() for r in replies_part.split("|")]

    result = {
        "success": True,
        "session_id": builder_session_id,
        "message": response_text,
        "quick_replies": quick_replies,
    }

    if template_data:
        result["template"] = template_data
        result["template_created"] = True

    return result


# ==================== Speech-to-Text Endpoints ====================

@app.post("/api/speech/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(...),
    encoding: str = Form(default="WEBM_OPUS"),
    sample_rate: int = Form(default=48000),
    language_code: str = Form(default="ja-JP"),
):
    """Transcribe audio to text using Google Speech-to-Text."""
    audio_content = await audio.read()

    result = speech_service.transcribe_audio(
        audio_content=audio_content,
        encoding=encoding,
        sample_rate=sample_rate,
        language_code=language_code,
    )

    return result


class TTSRequest(BaseModel):
    text: str
    language_code: str = "ja-JP"
    voice_name: str = "ja-JP-Neural2-B"
    speaking_rate: float = 1.0


@app.post("/api/speech/synthesize")
async def synthesize_speech(request: TTSRequest):
    """Synthesize text to speech using Google Cloud Text-to-Speech."""
    result = speech_service.synthesize_speech(
        text=request.text,
        language_code=request.language_code,
        voice_name=request.voice_name,
        speaking_rate=request.speaking_rate,
    )
    return result


@app.post("/api/sessions/{session_id}/voice")
async def send_voice_message(
    session_id: str,
    audio: UploadFile = File(...),
    encoding: str = Form(default="WEBM_OPUS"),
    sample_rate: int = Form(default=48000),
    with_tts: str = Form(default="false"),
):
    """Send a voice message in the checkout session (transcribe + process + optional TTS)."""
    # Find session across all tenants
    global_service = FirestoreService(tenant_id=None)
    session = global_service.find_session_by_id(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.status != "in_progress":
        raise HTTPException(status_code=400, detail="Session is not in progress")

    # Transcribe audio
    audio_content = await audio.read()
    transcription = speech_service.transcribe_audio(
        audio_content=audio_content,
        encoding=encoding,
        sample_rate=sample_rate,
        language_code="ja-JP",
    )

    if not transcription.get("success") or not transcription.get("transcript"):
        return {
            "success": False,
            "error": "Could not transcribe audio",
            "transcription": transcription,
        }

    # Process the transcribed message using internal function
    message = transcription["transcript"]
    result = await _process_message_internal(
        session_id=session_id,
        message=message,
        tenant_id=session.tenant_id,
    )

    # Add transcription info to result
    result["transcription"] = {
        "text": message,
        "confidence": transcription.get("confidence", 0),
    }

    # If complete, generate handover note
    if result.get("is_complete"):
        handover = await generate_handover(session_id, session.tenant_id)
        result["handover"] = handover

    # Generate TTS audio if requested
    if with_tts.lower() == "true" and result.get("message"):
        # Clean up the message for TTS (remove special markers)
        tts_text = result["message"]
        # Remove [QUICK_REPLIES:...] and [PHOTO_REQUEST:...] markers
        import re
        tts_text = re.sub(r'\[QUICK_REPLIES:[^\]]*\]', '', tts_text)
        tts_text = re.sub(r'\[PHOTO_REQUEST:[^\]]*\]', '', tts_text)
        tts_text = tts_text.strip()

        if tts_text:
            tts_result = speech_service.synthesize_speech(
                text=tts_text,
                language_code="ja-JP",
                voice_name="ja-JP-Neural2-B",
                speaking_rate=1.15,  # Slightly faster for natural conversation
            )
            if tts_result.get("success"):
                result["audio_response"] = {
                    "audio_content": tts_result["audio_content"],
                    "audio_format": tts_result["audio_format"],
                    "content_type": tts_result["content_type"],
                }

    return result


@app.get("/api/sessions/{session_id}/voice-greeting")
async def get_voice_greeting(session_id: str):
    """Get the initial greeting message with TTS audio for voice call mode.

    For Phase 3, generates a final review greeting instead of full checkout greeting.
    """
    # Find session across all tenants
    global_service = FirestoreService(tenant_id=None)
    session = global_service.find_session_by_id(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get tenant-scoped service
    tenant_service = get_firestore_service(session.tenant_id)

    # Check if this is Phase 3 (final review)
    is_phase3 = session.status == "phase3"

    if is_phase3:
        # Generate Phase 3 specific greeting
        ng_count = len(session.ng_item_ids)
        if ng_count > 0:
            greeting_text = f"お疲れ様です。入力内容を確認しました。NG項目が{ng_count}件あります。これらについて追加で伝えておくことはありますか？"
        else:
            greeting_text = "お疲れ様です。入力内容を確認しました。全項目OKですね。他に引き継ぎ事項や補足はありますか？"

        # Set AI conversation mode
        tenant_service.set_ai_conversation_mode(session_id, "voice")
    else:
        # Legacy: Get the last assistant message (should be the greeting)
        turns = tenant_service.get_turns(session_id)
        greeting_text = ""
        for turn in turns:
            if turn.get("role") == "assistant":
                greeting_text = turn.get("content", "")
                break

        if not greeting_text:
            greeting_text = "こんにちは。チェックアウトを開始します。"

    # Clean up the message for TTS
    import re
    tts_text = greeting_text
    tts_text = re.sub(r'\[QUICK_REPLIES:[^\]]*\]', '', tts_text)
    tts_text = re.sub(r'\[PHOTO_REQUEST:[^\]]*\]', '', tts_text)
    tts_text = tts_text.strip()

    # Generate TTS audio
    tts_result = speech_service.synthesize_speech(
        text=tts_text,
        language_code="ja-JP",
        voice_name="ja-JP-Neural2-B",
        speaking_rate=1.15,  # Slightly faster for natural conversation
    )

    return {
        "success": True,
        "message": greeting_text,
        "audio_response": {
            "audio_content": tts_result.get("audio_content"),
            "audio_format": tts_result.get("audio_format"),
            "content_type": tts_result.get("content_type"),
        } if tts_result.get("success") else None,
    }


@app.post("/api/sessions/{session_id}/voice-call")
async def send_voice_call_message(
    session_id: str,
    audio: UploadFile = File(...),
    encoding: str = Form(default="WEBM_OPUS"),
    sample_rate: int = Form(default=48000),
):
    """
    Voice call mode: Send voice message and get voice response.
    Always returns TTS audio for the AI response.
    Supports both legacy in_progress and new Phase 3 flow.
    """
    # Find session across all tenants
    global_service = FirestoreService(tenant_id=None)
    session = global_service.find_session_by_id(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Allow both in_progress (legacy) and phase3 (new flow) statuses
    if session.status not in ("in_progress", "phase3"):
        raise HTTPException(status_code=400, detail="Session is not active")

    # Transcribe audio
    audio_content = await audio.read()
    transcription = speech_service.transcribe_audio(
        audio_content=audio_content,
        encoding=encoding,
        sample_rate=sample_rate,
        language_code="ja-JP",
    )

    if not transcription.get("success") or not transcription.get("transcript"):
        # Generate TTS error message
        error_tts = speech_service.synthesize_speech(
            text="申し訳ありません。音声を聞き取れませんでした。もう一度お話しください。",
            language_code="ja-JP",
            voice_name="ja-JP-Neural2-B",
            speaking_rate=1.15,
        )
        return {
            "success": False,
            "error": "Could not transcribe audio",
            "message": "申し訳ありません。音声を聞き取れませんでした。もう一度お話しください。",
            "audio_response": error_tts if error_tts.get("success") else None,
            "transcription": transcription,
        }

    # Process the transcribed message using internal function
    message = transcription["transcript"]
    result = await _process_message_internal(
        session_id=session_id,
        message=message,
        tenant_id=session.tenant_id,
    )

    # Add transcription info to result
    result["transcription"] = {
        "text": message,
        "confidence": transcription.get("confidence", 0),
    }

    # For Phase 3 sessions, don't generate handover here (it will be done in Phase 4)
    # For legacy in_progress sessions, generate handover when complete
    if result.get("is_complete") and session.status == "in_progress":
        handover = await generate_handover(session_id, session.tenant_id)
        result["handover"] = handover

    # Always generate TTS audio for voice call mode
    if result.get("message"):
        # Clean up the message for TTS
        import re
        tts_text = result["message"]
        tts_text = re.sub(r'\[QUICK_REPLIES:[^\]]*\]', '', tts_text)
        tts_text = re.sub(r'\[PHOTO_REQUEST:[^\]]*\]', '', tts_text)
        tts_text = tts_text.strip()

        if tts_text:
            tts_result = speech_service.synthesize_speech(
                text=tts_text,
                language_code="ja-JP",
                voice_name="ja-JP-Neural2-B",
                speaking_rate=1.15,  # Slightly faster for natural conversation
            )
            if tts_result.get("success"):
                result["audio_response"] = {
                    "audio_content": tts_result["audio_content"],
                    "audio_format": tts_result["audio_format"],
                    "content_type": tts_result["content_type"],
                }

    return result


# ==================== Gemini Live API WebSocket ====================

def get_live_system_prompt(session: CheckoutSession, template: Optional[ChecklistTemplate]) -> str:
    """Generate system prompt for Gemini Live API voice call."""
    is_phase3 = session.status == "phase3"

    if is_phase3:
        # Phase 3: Focus on NG items and additional notes
        ng_items_text = ""
        ng_count = len(session.ng_item_ids) if session.ng_item_ids else 0
        total_items = len(session.item_responses) if session.item_responses else 0

        if session.ng_item_ids and template:
            ng_items = [item for item in template.items if item.id in session.ng_item_ids]
            ng_items_text = "\n".join([f"- {item.topic}: {item.main_question}" for item in ng_items])

        responses_text = ""
        for response in session.item_responses:
            item = next((i for i in template.items if i.id == response.item_id), None) if template else None
            item_name = item.topic if item else response.item_id
            value = get_response_value_str(response)
            status = "NG" if response.item_id in session.ng_item_ids else "OK"
            responses_text += f"- {item_name}: {value} ({status})\n"

        return f"""あなたは作業引き継ぎを支援するAIアシスタントです。
担当者の{session.operator_name}さんと音声通話中です。

## 状況
Phase 1で入力された確認結果を基に、最終確認を行っています。

## 入力された回答
{responses_text}

## NG項目（追加確認が必要）
{ng_items_text if ng_items_text else "なし"}

## 会話の進め方（この順番で必ず進めること）

### ステップ1: 全体確認の報告（最初に必ず行う）
「お疲れ様です。入力いただいたチェックリストを確認しました。
[NGがある場合] 全○項目のうち、○件のNG項目があります。
[NGがない場合] 全項目OKとなっています。」

### ステップ2: NG項目・重要事項の深掘り
NG項目や重要キーワード（火災・事故・異常・故障・漏れ・警報など）がある場合：
- 1回目: 「○○について詳しく教えてください」
- 2回目: 「現在の状況は？対応は済んでいますか？」
- 3回目: 「次の担当者に伝えておくことはありますか？」

### ステップ3: その他の確認（必ず行う）
NG項目の確認が終わったら、必ず聞く：
「他に引き継ぎ事項や、伝えておきたいことはありますか？」

### ステップ4: 終了確認（勝手に終了しない）
ユーザーが「特にない」「ない」などと回答したら、必ず確認する：
「では、以上で確認を終了してよろしいですか？」

### ステップ5: 終了
ユーザーが「はい」「大丈夫」などと回答したら：
「確認ありがとうございました。以上で終了です。お疲れ様でした。」

## 重要ルール
- **勝手に終了しない** - 必ずユーザーに終了確認を取る
- **その他の確認を省略しない** - NG確認後、必ず他の引き継ぎ事項を聞く
- 日本語で話す
- 短く簡潔に話す（1-2文程度）
- 一度に1つの質問だけする
"""
    else:
        # Legacy full checkout mode
        items_text = ""
        if template:
            items_text = "\n".join([f"- {item.topic}: {item.main_question}" for item in template.items])

        return f"""あなたは作業引き継ぎを支援するAIアシスタントです。
担当者の{session.operator_name}さんと音声通話でチェックアウトを行います。

## チェックリスト項目
{items_text}

## ルール
1. 日本語で話す
2. 短く簡潔に話す（1-2文程度）
3. 一度に1つの項目だけ確認する
4. 回答を受けたら次の項目へ進む
5. すべての項目を確認したら「以上で確認は終了です」と伝える
6. フレンドリーだが丁寧に話す

まず挨拶から始めてください。
"""


@app.websocket("/ws/voice/{session_id}")
async def websocket_voice_call(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for real-time voice conversation using Gemini Live API.

    This implements a raw WebSocket proxy to Gemini Live API, following the official
    Google Cloud implementation pattern for maximum compatibility.
    """
    import ssl
    import certifi
    import websockets
    import google.auth
    from google.auth.transport.requests import Request

    await websocket.accept()

    # Find session
    global_service = FirestoreService(tenant_id=None)
    session = global_service.find_session_by_id(session_id)
    if not session:
        await websocket.close(code=4004, reason="Session not found")
        return

    # Get template
    tenant_service = get_firestore_service(session.tenant_id)
    template = tenant_service.get_template(session.template_id)

    # Generate system prompt
    system_prompt = get_live_system_prompt(session, template)

    # Set AI conversation mode
    tenant_service.set_ai_conversation_mode(session_id, "voice_live")

    # Get access token using default credentials
    def get_access_token():
        try:
            creds, _ = google.auth.default()
            if not creds.valid:
                creds.refresh(Request())
            return creds.token
        except Exception as e:
            logger.error("Error generating access token: %s", e)
            return None

    access_token = get_access_token()
    if not access_token:
        logger.error("Failed to get access token")
        await websocket.close(code=1008, reason="Authentication failed")
        return

    # Build Gemini Live API WebSocket URL
    project_id = os.environ.get("GOOGLE_CLOUD_PROJECT", "tsugiai")
    model_name = "gemini-live-2.5-flash-native-audio"
    api_host = "us-central1-aiplatform.googleapis.com"
    service_url = f"wss://{api_host}/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent"
    model_uri = f"projects/{project_id}/locations/us-central1/publishers/google/models/{model_name}"

    # Create SSL context
    ssl_context = ssl.create_default_context(cafile=certifi.where())

    # Headers for authentication
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {access_token}",
    }

    # Track conversation for summary
    conversation_turns = []
    current_ai_transcript = []
    current_user_transcript = []

    try:
        async with websockets.connect(
            service_url,
            additional_headers=headers,
            ssl=ssl_context
        ) as gemini_ws:
            logger.info("Connected to Gemini Live API for session %s", session_id)

            # Send setup message immediately after connection
            setup_message = {
                "setup": {
                    "model": model_uri,
                    "generation_config": {
                        "response_modalities": ["AUDIO"],
                        "speech_config": {
                            "voice_config": {
                                "prebuilt_voice_config": {
                                    "voice_name": "Aoede"
                                }
                            }
                        }
                    },
                    "system_instruction": {
                        "parts": [{"text": system_prompt}]
                    },
                    "realtime_input_config": {
                        "automatic_activity_detection": {
                            "disabled": False,
                            "silence_duration_ms": 1000,
                            "prefix_padding_ms": 300
                        }
                    },
                    # Enable transcription for both input (user) and output (AI)
                    "input_audio_transcription": {},
                    "output_audio_transcription": {}
                }
            }
            await gemini_ws.send(json.dumps(setup_message))

            # Wait for setup complete, then send initial greeting trigger
            setup_complete_received = False

            async def client_to_gemini():
                """Forward messages from browser client to Gemini."""
                try:
                    while True:
                        data = await websocket.receive_text()
                        msg = json.loads(data)
                        msg_type = msg.get("type")

                        if msg_type == "audio":
                            # Convert to Gemini's expected format
                            media = msg.get("media", {})
                            gemini_msg = {
                                "realtime_input": {
                                    "media_chunks": [{
                                        "mime_type": media.get("mimeType", "audio/pcm"),
                                        "data": media.get("data", "")
                                    }]
                                }
                            }
                            await gemini_ws.send(json.dumps(gemini_msg))
                        elif msg_type == "end":
                            break
                        else:
                            # Forward other messages as-is (for future extensions)
                            await gemini_ws.send(json.dumps(msg))
                except WebSocketDisconnect:
                    pass
                except Exception as e:
                    logger.error("Error in client_to_gemini: %s", e)

            async def gemini_to_client():
                """Forward messages from Gemini to browser client."""
                nonlocal current_ai_transcript, current_user_transcript
                try:
                    async for message in gemini_ws:
                        data = json.loads(message)

                        # Handle setup complete
                        if data.get("setupComplete"):
                            await websocket.send_json({"type": "ready"})

                            # Send initial greeting trigger to make AI speak first
                            greeting_trigger = {
                                "client_content": {
                                    "turns": [{
                                        "role": "user",
                                        "parts": [{"text": "こんにちは、引き継ぎを始めてください。"}]
                                    }],
                                    "turn_complete": True
                                }
                            }
                            await gemini_ws.send(json.dumps(greeting_trigger))
                            continue

                        server_content = data.get("serverContent", {})

                        # Handle turn complete
                        if server_content.get("turnComplete"):
                            if current_ai_transcript:
                                full_text = "".join(current_ai_transcript)
                                conversation_turns.append({"role": "assistant", "content": full_text})
                                await websocket.send_json({
                                    "type": "transcript",
                                    "role": "assistant",
                                    "text": full_text
                                })
                                current_ai_transcript = []
                            await websocket.send_json({"type": "turn_complete"})
                            continue

                        # Handle interruption
                        if server_content.get("interrupted"):
                            current_ai_transcript = []
                            await websocket.send_json({"type": "interrupted"})
                            continue

                        # Handle model turn (audio output)
                        model_turn = server_content.get("modelTurn", {})
                        parts = model_turn.get("parts", [])
                        for part in parts:
                            inline_data = part.get("inlineData", {})
                            if inline_data.get("data"):
                                # Forward audio to client
                                await websocket.send_json({
                                    "type": "audio",
                                    "data": inline_data.get("data"),
                                    "mimeType": inline_data.get("mimeType", "audio/pcm;rate=24000")
                                })
                            if part.get("text"):
                                current_ai_transcript.append(part.get("text"))

                        # Handle output transcription (AI speech → text)
                        output_transcription = server_content.get("outputTranscription", {})
                        if output_transcription.get("text"):
                            text = output_transcription.get("text")
                            current_ai_transcript.append(text)
                            # Send partial transcription to client for real-time display
                            await websocket.send_json({
                                "type": "transcript_partial",
                                "role": "assistant",
                                "text": text,
                                "finished": output_transcription.get("finished", False)
                            })

                        # Handle input transcription (User speech → text)
                        input_transcription = server_content.get("inputTranscription", {})
                        if input_transcription:
                            text = input_transcription.get("text", "")
                            finished = input_transcription.get("finished", False)

                            # Helper function to clean Japanese text spaces
                            def clean_japanese_spaces(text):
                                import re
                                # Japanese character ranges: Hiragana, Katakana, Kanji, punctuation
                                # \u3000-\u303f: Japanese punctuation
                                # \u3040-\u309f: Hiragana
                                # \u30a0-\u30ff: Katakana
                                # \u4e00-\u9fff: CJK Unified Ideographs (Kanji)
                                # \uff00-\uffef: Fullwidth forms
                                jp_chars = r'[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff\uff00-\uffef]'
                                # Remove spaces between Japanese characters
                                text = re.sub(f'({jp_chars})\\s+({jp_chars})', r'\1\2', text)
                                # Apply multiple times to catch all cases
                                text = re.sub(f'({jp_chars})\\s+({jp_chars})', r'\1\2', text)
                                text = re.sub(f'({jp_chars})\\s+({jp_chars})', r'\1\2', text)
                                return text.strip()

                            # Accumulate transcription text
                            if text:
                                current_user_transcript.append(text)
                                # Join and clean up spaces for Japanese text
                                full_text_so_far = "".join(current_user_transcript)
                                full_text_so_far = clean_japanese_spaces(full_text_so_far)
                                await websocket.send_json({
                                    "type": "transcript_partial",
                                    "role": "user",
                                    "text": full_text_so_far,
                                    "finished": finished
                                })

                            # When finished, save the complete transcription
                            if finished:
                                full_text = "".join(current_user_transcript)
                                full_text = clean_japanese_spaces(full_text)
                                if full_text:
                                    conversation_turns.append({"role": "user", "content": full_text})
                                    await websocket.send_json({
                                        "type": "transcript",
                                        "role": "user",
                                        "text": full_text
                                    })
                                current_user_transcript.clear()  # Reset for next user turn

                except Exception as e:
                    logger.error("Error in gemini_to_client: %s", e)

            # Run both tasks concurrently
            done, pending = await asyncio.wait(
                [
                    asyncio.create_task(client_to_gemini()),
                    asyncio.create_task(gemini_to_client()),
                ],
                return_when=asyncio.FIRST_COMPLETED,
            )

            # Cancel pending tasks
            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

            # Save conversation turns to Firestore
            for turn in conversation_turns:
                tenant_service.add_turn(session_id, turn["role"], turn["content"])

    except Exception as e:
        import traceback
        logger.error("WebSocket error: %s", e)
        traceback.print_exc()
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ==================== Template File Analysis ====================

TEMPLATE_EXTRACTION_PROMPT = """あなたはチェックリストテンプレートを抽出するAIです。
アップロードされたファイル（PDF、画像、Excel）から、チェックリストの項目を抽出してください。

## 出力形式（必ずこのJSON形式で出力）
```json
{
  "title": "抽出したチェックリストのタイトル",
  "description": "チェックリストの説明",
  "items": [
    {
      "topic": "確認項目名",
      "main_question": "確認する質問文",
      "priority": "P0|P1|P2|P3",
      "category": "safety|equipment|task|handover|other",
      "is_required": true,
      "needs_photo": false
    }
  ]
}
```

## 優先度の判定
- P0: 安全に関わる最重要項目
- P1: 必ず確認が必要な重要項目
- P2: 通常の確認項目
- P3: 任意の確認項目

## カテゴリ
- safety: 安全・セキュリティ
- equipment: 設備・機器
- task: 作業・タスク
- handover: 引き継ぎ・連絡
- other: その他

## ルール
1. ファイルから読み取れるチェック項目をすべて抽出
2. 項目がない場合は空の配列を返す
3. 必ずJSON形式で出力
4. 日本語で出力"""


@app.post("/api/templates/analyze-file")
async def analyze_template_file(
    file: UploadFile = File(...),
):
    """Analyze uploaded file (PDF, image, Excel) and extract checklist template."""
    import json
    import re
    from google import genai

    # Read file content
    file_content = await file.read()
    file_name = file.filename or "uploaded_file"
    content_type = file.content_type or "application/octet-stream"

    # Determine MIME type (PDF and images only)
    mime_type = content_type
    if file_name.endswith(".pdf"):
        mime_type = "application/pdf"
    elif file_name.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
        if file_name.endswith(".png"):
            mime_type = "image/png"
        elif file_name.endswith((".jpg", ".jpeg")):
            mime_type = "image/jpeg"
        elif file_name.endswith(".gif"):
            mime_type = "image/gif"
        elif file_name.endswith(".webp"):
            mime_type = "image/webp"
    elif file_name.endswith((".xlsx", ".xls")):
        return {
            "success": False,
            "error": "Excelファイルは現在サポートされていません。PDFまたは画像ファイルをアップロードしてください。",
        }

    try:
        # Initialize Gemini client
        client = genai.Client(vertexai=True, project="tsugiai", location="global")

        # Create content with file
        file_part = types.Part.from_bytes(data=file_content, mime_type=mime_type)

        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        file_part,
                        types.Part(text=TEMPLATE_EXTRACTION_PROMPT),
                    ],
                )
            ],
            config=types.GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=4096,
            ),
        )

        # Extract response text
        response_text = ""
        if response.candidates and response.candidates[0].content:
            for part in response.candidates[0].content.parts:
                if hasattr(part, "text") and part.text:
                    response_text += part.text

        # Parse JSON from response
        template_data = None
        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', response_text)
        if json_match:
            try:
                template_data = json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass

        if not template_data:
            # Try to find raw JSON
            json_match = re.search(r'\{[\s\S]*"title"[\s\S]*"items"[\s\S]*\}', response_text)
            if json_match:
                try:
                    template_data = json.loads(json_match.group(0))
                except json.JSONDecodeError:
                    pass

        if template_data:
            return {
                "success": True,
                "template": template_data,
                "source_file": file_name,
            }
        else:
            return {
                "success": False,
                "error": "テンプレートの抽出に失敗しました",
                "raw_response": response_text[:500],
            }

    except Exception as e:
        return {
            "success": False,
            "error": f"ファイルの解析に失敗しました: {str(e)}",
        }


# ==================== Health Check ====================

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8080))
    host = os.environ.get("HOST", "0.0.0.0")

    uvicorn.run(app, host=host, port=port)
