"""Tools for the checkout agent."""

import uuid
from datetime import datetime
from typing import Optional

# These will be injected at runtime
_firestore_service = None
_storage_service = None
_current_session_id = None


def set_services(firestore_service, storage_service):
    """Set the service instances for tools to use."""
    global _firestore_service, _storage_service
    _firestore_service = firestore_service
    _storage_service = storage_service


def set_current_session(session_id: str):
    """Set the current session ID."""
    global _current_session_id
    _current_session_id = session_id


def save_check_response(
    item_id: str,
    response_text: str,
    priority: str = "P2",
    status: str = "pending",
    needs_followup: bool = False,
) -> dict:
    """
    Save a response for a checklist item.

    Args:
        item_id: The ID of the checklist item being responded to
        response_text: The user's response text
        priority: Priority level (P0, P1, P2, P3)
        status: Status (pending, done, blocked, na)
        needs_followup: Whether this item needs follow-up

    Returns:
        Confirmation of saved response
    """
    if not _firestore_service or not _current_session_id:
        return {"success": False, "error": "Session not initialized"}

    from models.checklist import CheckoutResponse, Priority, CheckItemStatus

    response = CheckoutResponse(
        item_id=item_id,
        response_text=response_text,
        priority=Priority(priority),
        status=CheckItemStatus(status),
        needs_followup=needs_followup,
    )

    _firestore_service.add_response(_current_session_id, response)

    return {
        "success": True,
        "item_id": item_id,
        "priority": priority,
        "message": f"Response saved for item {item_id}",
    }


def add_to_parking_lot(topic: str, reason: str) -> dict:
    """
    Add a topic to the parking lot for later discussion.

    Args:
        topic: The topic to save for later
        reason: Why this topic was deferred

    Returns:
        Confirmation message
    """
    if not _firestore_service or not _current_session_id:
        return {"success": False, "error": "Session not initialized"}

    session = _firestore_service.get_session(_current_session_id)
    if session:
        parking_lot = session.parking_lot + [f"{topic}: {reason}"]
        _firestore_service.update_session(_current_session_id, {"parking_lot": parking_lot})

    return {
        "success": True,
        "message": f"Added '{topic}' to parking lot",
    }


def request_photo(
    item_id: str,
    description: str,
) -> dict:
    """
    Request a photo attachment from the user.

    Args:
        item_id: The checklist item this photo is for
        description: Description of what photo is needed

    Returns:
        Photo request information
    """
    return {
        "action": "request_photo",
        "item_id": item_id,
        "description": description,
        "message": f"写真添付リクエスト: {description}",
    }


def mark_item_complete(item_id: str) -> dict:
    """
    Mark a checklist item as complete.

    Args:
        item_id: The ID of the item to mark complete

    Returns:
        Confirmation message
    """
    if not _firestore_service or not _current_session_id:
        return {"success": False, "error": "Session not initialized"}

    session = _firestore_service.get_session(_current_session_id)
    if session:
        # Update the response status for this item
        for response in session.responses:
            if response.item_id == item_id:
                response.status = "done"
        _firestore_service.update_session(
            _current_session_id,
            {"responses": [r.model_dump() for r in session.responses]}
        )

    return {
        "success": True,
        "item_id": item_id,
        "message": f"Item {item_id} marked as complete",
    }


def get_session_progress() -> dict:
    """
    Get the current progress of the checkout session.

    Returns:
        Progress information including completed items and pending items
    """
    if not _firestore_service or not _current_session_id:
        return {"success": False, "error": "Session not initialized"}

    session = _firestore_service.get_session(_current_session_id)
    if not session:
        return {"success": False, "error": "Session not found"}

    template = _firestore_service.get_template(session.template_id)
    if not template:
        return {"success": False, "error": "Template not found"}

    completed_ids = {r.item_id for r in session.responses if r.status == "done"}
    all_items = {item.id: item.topic for item in template.items}

    pending_items = [
        {"id": item_id, "topic": topic}
        for item_id, topic in all_items.items()
        if item_id not in completed_ids
    ]

    critical_items = [
        r for r in session.responses
        if r.priority in ["P0", "P1"] and r.needs_followup
    ]

    return {
        "success": True,
        "total_items": len(all_items),
        "completed_count": len(completed_ids),
        "pending_items": pending_items,
        "critical_items": len(critical_items),
        "parking_lot": session.parking_lot,
    }


def complete_checkout() -> dict:
    """
    Complete the checkout session and trigger handover note generation.

    Returns:
        Completion confirmation
    """
    if not _firestore_service or not _current_session_id:
        return {"success": False, "error": "Session not initialized"}

    # Phase 3 sessions should NOT be completed by the agent tool.
    # Phase 3 completion is handled by the phase3/complete endpoint.
    session = _firestore_service.get_session(_current_session_id)
    if session and str(getattr(session.status, 'value', session.status)) == "phase3":
        return {
            "success": True,
            "session_id": _current_session_id,
            "message": "会話が完了しました。引き継ぎ簿を作成します。",
        }

    _firestore_service.complete_session(_current_session_id)

    return {
        "success": True,
        "session_id": _current_session_id,
        "message": "Checkout completed. Handover note will be generated.",
        "action": "generate_handover",
    }
