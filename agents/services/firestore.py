"""Firestore service for data persistence."""

import os
import time
from datetime import datetime
from typing import Optional
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

# In-memory template cache: { (tenant_id, template_id): (timestamp, template) }
_template_cache: dict[tuple, tuple[float, "ChecklistTemplate"]] = {}
_TEMPLATE_CACHE_TTL = 300  # 5 minutes

from models.checklist import (
    ChecklistTemplate,
    CheckoutSession,
    HandoverNote,
    Comment,
    Attachment,
    CheckoutResponse,
    ItemResponse,
    SessionStatus,
    InboxItem,
    ActionItemResponse,
)


def _migrate_template_data(data: dict) -> dict:
    """Migrate template data to handle deprecated item types.

    Converts ai_confirmation items to text type for backward compatibility.
    """
    if "items" in data and data["items"]:
        for item in data["items"]:
            if item.get("item_type") == "ai_confirmation":
                item["item_type"] = "text"
    return data


class FirestoreService:
    """Service for Firestore operations with tenant support."""

    def __init__(self, tenant_id: Optional[str] = None):
        project_id = os.environ.get("GOOGLE_CLOUD_PROJECT")
        self.db = firestore.Client(project=project_id)
        self.tenant_id = tenant_id

    def _tenant_collection(self, collection_name: str):
        """Get tenant-scoped collection reference."""
        if self.tenant_id:
            return self.db.collection("tenants").document(self.tenant_id).collection(collection_name)
        # Fallback to global collection (for backward compatibility)
        return self.db.collection(collection_name)

    def _get_tenant_filter(self):
        """Get tenantId filter for global collection queries."""
        if self.tenant_id:
            return FieldFilter("tenantId", "==", self.tenant_id)
        return None

    # ==================== Templates ====================

    def create_template(self, template: ChecklistTemplate) -> str:
        """Create a new checklist template."""
        template_data = template.model_dump()
        if self.tenant_id:
            template_data["tenantId"] = self.tenant_id
        doc_ref = self._tenant_collection("templates").document(template.id)
        doc_ref.set(template_data)
        _template_cache.pop((self.tenant_id, template.id), None)
        return template.id

    def get_template(self, template_id: str) -> Optional[ChecklistTemplate]:
        """Get a template by ID (with in-memory cache, TTL 5 min)."""
        cache_key = (self.tenant_id, template_id)
        cached = _template_cache.get(cache_key)
        if cached and (time.time() - cached[0]) < _TEMPLATE_CACHE_TTL:
            return cached[1]

        doc = self._tenant_collection("templates").document(template_id).get()
        if doc.exists:
            data = _migrate_template_data(doc.to_dict())
            template = ChecklistTemplate(**data)
            _template_cache[cache_key] = (time.time(), template)
            return template
        return None

    def list_templates(self, active_only: bool = True) -> list[ChecklistTemplate]:
        """List all templates for the current tenant."""
        query = self._tenant_collection("templates")
        if active_only:
            query = query.where(filter=FieldFilter("is_active", "==", True))
        docs = query.stream()
        return [ChecklistTemplate(**_migrate_template_data(doc.to_dict())) for doc in docs]

    def update_template(self, template_id: str, data: dict) -> None:
        """Update a template."""
        self._tenant_collection("templates").document(template_id).update(data)
        _template_cache.pop((self.tenant_id, template_id), None)

    # ==================== Sessions ====================

    def create_session(self, session: CheckoutSession) -> str:
        """Create a new checkout session."""
        session_data = session.model_dump()
        if self.tenant_id:
            session_data["tenantId"] = self.tenant_id
        doc_ref = self._tenant_collection("sessions").document(session.id)
        doc_ref.set(session_data)
        return session.id

    def get_session(self, session_id: str) -> Optional[CheckoutSession]:
        """Get a session by ID."""
        doc = self._tenant_collection("sessions").document(session_id).get()
        if doc.exists:
            return CheckoutSession(**doc.to_dict())
        return None

    def find_session_by_id(self, session_id: str) -> Optional[CheckoutSession]:
        """Find a session by ID across all tenants using collection group query."""
        # Use collection group query to search across all tenants
        query = self.db.collection_group("sessions").where(
            filter=FieldFilter("id", "==", session_id)
        ).limit(1)
        docs = list(query.stream())
        if docs:
            return CheckoutSession(**docs[0].to_dict())
        return None

    def update_session(self, session_id: str, data: dict) -> None:
        """Update a session."""
        self._tenant_collection("sessions").document(session_id).update(data)

    def add_response(self, session_id: str, response: CheckoutResponse) -> None:
        """Add a response to a session."""
        session = self.get_session(session_id)
        if session:
            responses = session.responses + [response]
            self.update_session(session_id, {"responses": [r.model_dump() for r in responses]})

    def complete_session(self, session_id: str) -> None:
        """Mark a session as completed."""
        self.update_session(session_id, {
            "status": SessionStatus.COMPLETED.value,
            "ended_at": datetime.now(),
        })

    # ==================== Phase-based Session Methods ====================

    def save_item_response(self, session_id: str, response: ItemResponse) -> None:
        """Save or update an item response in a session."""
        session = self.get_session(session_id)
        if not session:
            return

        # Find and update existing response or add new one
        responses = list(session.item_responses)
        found = False
        for i, r in enumerate(responses):
            if r.item_id == response.item_id:
                responses[i] = response
                found = True
                break

        if not found:
            responses.append(response)

        self.update_session(session_id, {
            "item_responses": [r.model_dump() for r in responses]
        })

    def save_item_responses(self, session_id: str, responses: list[ItemResponse]) -> None:
        """Save multiple item responses at once."""
        self.update_session(session_id, {
            "item_responses": [r.model_dump() for r in responses]
        })

    def update_session_phase(
        self,
        session_id: str,
        phase: int,
        status: SessionStatus,
        ng_item_ids: Optional[list[str]] = None
    ) -> None:
        """Update session phase and status."""
        update_data = {
            "current_phase": phase,
            "status": status.value,
        }

        if ng_item_ids is not None:
            update_data["ng_item_ids"] = ng_item_ids

        # Set phase completion timestamp
        if phase == 2:
            update_data["phase1_completed_at"] = datetime.now()
        elif phase == 3:
            update_data["phase2_completed_at"] = datetime.now()
        elif phase == 4:
            update_data["phase3_completed_at"] = datetime.now()

        self.update_session(session_id, update_data)

    def set_ai_conversation_mode(self, session_id: str, mode: str) -> None:
        """Set AI conversation mode (chat/voice) for Phase 3."""
        self.update_session(session_id, {"ai_conversation_mode": mode})

    def update_session_summary(
        self,
        session_id: str,
        summary_markdown: str,
        edited: bool = False
    ) -> None:
        """Update the summary markdown for Phase 4."""
        self.update_session(session_id, {
            "summary_markdown": summary_markdown,
            "summary_edited": edited,
        })

    def update_session_action_items(
        self,
        session_id: str,
        action_items: list[dict]
    ) -> None:
        """Update the action items for Phase 4."""
        self.update_session(session_id, {
            "action_items": action_items,
        })

    def restart_session(self, session_id: str) -> None:
        """Restart a session from the beginning."""
        self.update_session(session_id, {
            "status": SessionStatus.PHASE1.value,
            "current_phase": 1,
            "item_responses": [],
            "ng_item_ids": [],
            "summary_markdown": "",
            "summary_edited": False,
            "phase1_completed_at": None,
            "phase2_completed_at": None,
            "phase3_completed_at": None,
            "ai_conversation_mode": None,
        })

    def list_sessions(
        self,
        operator_id: Optional[str] = None,
        status_in: Optional[list[str]] = None,
        limit: int = 20,
    ) -> list[CheckoutSession]:
        """List sessions with optional filters."""
        query = self._tenant_collection("sessions")

        if operator_id:
            query = query.where(filter=FieldFilter("operator_id", "==", operator_id))
        if status_in:
            query = query.where(filter=FieldFilter("status", "in", status_in))

        query = query.order_by("started_at", direction=firestore.Query.DESCENDING).limit(limit)
        docs = query.stream()
        return [CheckoutSession(**doc.to_dict()) for doc in docs]

    def delete_session(self, session_id: str) -> None:
        """Delete a session and its turns subcollection."""
        session_ref = self._tenant_collection("sessions").document(session_id)
        # Delete turns subcollection first
        turns = session_ref.collection("turns").stream()
        for turn in turns:
            turn.reference.delete()
        # Delete the session document
        session_ref.delete()

    # ==================== Turns (Conversation History) ====================

    def add_turn(self, session_id: str, role: str, content: str,
                 item_id: Optional[str] = None, quick_replies: Optional[list[str]] = None) -> str:
        """Add a conversation turn."""
        turn_ref = self._tenant_collection("sessions").document(session_id).collection("turns").document()
        turn_data = {
            "id": turn_ref.id,
            "session_id": session_id,
            "role": role,
            "content": content,
            "item_id": item_id,
            "quick_replies": quick_replies or [],
            "timestamp": datetime.now(),
        }
        turn_ref.set(turn_data)
        return turn_ref.id

    def get_turns(self, session_id: str) -> list[dict]:
        """Get all turns for a session."""
        turns = (
            self._tenant_collection("sessions")
            .document(session_id)
            .collection("turns")
            .order_by("timestamp")
            .stream()
        )
        return [turn.to_dict() for turn in turns]

    def clear_turns(self, session_id: str) -> None:
        """Clear all turns for a session (for restart)."""
        turns_ref = (
            self._tenant_collection("sessions")
            .document(session_id)
            .collection("turns")
        )
        # Delete all turns in batches
        docs = turns_ref.stream()
        batch = self.db.batch()
        count = 0
        for doc in docs:
            batch.delete(doc.reference)
            count += 1
            if count >= 500:  # Firestore batch limit
                batch.commit()
                batch = self.db.batch()
                count = 0
        if count > 0:
            batch.commit()

    # ==================== Handover Notes ====================

    def create_handover(self, handover: HandoverNote) -> str:
        """Create a handover note."""
        handover_data = handover.model_dump()
        if self.tenant_id:
            handover_data["tenantId"] = self.tenant_id
        doc_ref = self._tenant_collection("handovers").document(handover.id)
        doc_ref.set(handover_data)
        return handover.id

    def get_handover(self, handover_id: str) -> Optional[HandoverNote]:
        """Get a handover note by ID."""
        doc = self._tenant_collection("handovers").document(handover_id).get()
        if doc.exists:
            return HandoverNote(**doc.to_dict())
        return None

    def get_handover_by_session(self, session_id: str) -> Optional[HandoverNote]:
        """Get handover note for a session."""
        docs = (
            self._tenant_collection("handovers")
            .where(filter=FieldFilter("session_id", "==", session_id))
            .limit(1)
            .stream()
        )
        for doc in docs:
            return HandoverNote(**doc.to_dict())
        return None

    def list_handovers(
        self,
        operator_id: Optional[str] = None,
        next_operator_id: Optional[str] = None,
        limit: int = 50
    ) -> list[HandoverNote]:
        """List handover notes with optional filters."""
        query = self._tenant_collection("handovers")

        if operator_id:
            query = query.where(filter=FieldFilter("operator_id", "==", operator_id))
        if next_operator_id:
            query = query.where(filter=FieldFilter("next_operator_id", "==", next_operator_id))

        query = query.order_by("created_at", direction=firestore.Query.DESCENDING).limit(limit)
        docs = query.stream()
        return [HandoverNote(**doc.to_dict()) for doc in docs]

    def confirm_handover(self, handover_id: str) -> None:
        """Confirm a handover note."""
        self._tenant_collection("handovers").document(handover_id).update({
            "is_confirmed": True,
            "confirmed_at": datetime.now(),
        })

    def update_handover(self, handover_id: str, data: dict) -> None:
        """Update a handover note."""
        self._tenant_collection("handovers").document(handover_id).update(data)

    def save_action_response(
        self,
        handover_id: str,
        action_response: "ActionItemResponse"
    ) -> None:
        """Save or update an action item response in a handover note."""
        from google.cloud.firestore_v1 import ArrayUnion, ArrayRemove

        handover_ref = self._tenant_collection("handovers").document(handover_id)
        handover = handover_ref.get()

        if not handover.exists:
            return

        handover_data = handover.to_dict()
        existing_responses = handover_data.get("action_responses", [])

        # Find and update existing response or add new one
        response_dict = action_response.model_dump()
        # Convert datetime to ISO string for Firestore
        if response_dict.get("completed_at"):
            response_dict["completed_at"] = response_dict["completed_at"].isoformat()

        # Remove existing response for this action_id if any
        updated_responses = [
            r for r in existing_responses
            if r.get("action_id") != action_response.action_id
        ]
        # Add the new response
        updated_responses.append(response_dict)

        # Update the handover
        handover_ref.update({
            "action_responses": updated_responses
        })

    def cancel_handover(
        self,
        handover_id: str,
        cancelled_by: str,
        reason: Optional[str] = None
    ) -> None:
        """Cancel a handover note (admin action)."""
        self._tenant_collection("handovers").document(handover_id).update({
            "is_cancelled": True,
            "cancelled_at": datetime.now(),
            "cancelled_by": cancelled_by,
            "cancellation_reason": reason,
            # Also unconfirm if it was confirmed
            "is_confirmed": False,
            "confirmed_at": None,
        })

    def uncancel_handover(self, handover_id: str) -> None:
        """Uncancel a handover note."""
        self._tenant_collection("handovers").document(handover_id).update({
            "is_cancelled": False,
            "cancelled_at": None,
            "cancelled_by": None,
            "cancellation_reason": None,
        })

    def delete_handover(self, handover_id: str) -> None:
        """Delete a handover note permanently."""
        # Delete comments subcollection first
        comments_ref = (
            self._tenant_collection("handovers")
            .document(handover_id)
            .collection("comments")
        )
        for doc in comments_ref.stream():
            doc.reference.delete()

        # Delete the handover document
        self._tenant_collection("handovers").document(handover_id).delete()

    # ==================== Comments ====================

    def add_comment(self, comment: Comment) -> str:
        """Add a comment to a handover."""
        doc_ref = (
            self._tenant_collection("handovers")
            .document(comment.handover_id)
            .collection("comments")
            .document(comment.id)
        )
        doc_ref.set(comment.model_dump())
        return comment.id

    def get_comments(self, handover_id: str) -> list[Comment]:
        """Get all comments for a handover."""
        docs = (
            self._tenant_collection("handovers")
            .document(handover_id)
            .collection("comments")
            .order_by("created_at")
            .stream()
        )
        return [Comment(**doc.to_dict()) for doc in docs]

    def resolve_comment(self, handover_id: str, comment_id: str) -> None:
        """Mark a comment as resolved."""
        (
            self._tenant_collection("handovers")
            .document(handover_id)
            .collection("comments")
            .document(comment_id)
            .update({"is_resolved": True})
        )

    # ==================== Attachments ====================

    def add_attachment(self, attachment: Attachment) -> str:
        """Add an attachment record."""
        doc_ref = (
            self._tenant_collection("sessions")
            .document(attachment.session_id)
            .collection("attachments")
            .document(attachment.id)
        )
        doc_ref.set(attachment.model_dump())
        return attachment.id

    def get_attachments(self, session_id: str) -> list[Attachment]:
        """Get all attachments for a session."""
        docs = (
            self._tenant_collection("sessions")
            .document(session_id)
            .collection("attachments")
            .order_by("uploaded_at")
            .stream()
        )
        return [Attachment(**doc.to_dict()) for doc in docs]

    def get_attachment_by_item(self, session_id: str, item_id: str) -> Optional[Attachment]:
        """Get attachment for a specific item."""
        docs = (
            self._tenant_collection("sessions")
            .document(session_id)
            .collection("attachments")
            .where(filter=FieldFilter("item_id", "==", item_id))
            .limit(1)
            .stream()
        )
        for doc in docs:
            return Attachment(**doc.to_dict())
        return None

    def delete_attachment(self, session_id: str, attachment_id: str) -> None:
        """Delete an attachment record."""
        (
            self._tenant_collection("sessions")
            .document(session_id)
            .collection("attachments")
            .document(attachment_id)
            .delete()
        )

    # ==================== Inbox ====================

    def create_inbox_item(self, inbox_item: InboxItem) -> str:
        """Create an inbox notification item."""
        item_data = inbox_item.model_dump()
        if self.tenant_id:
            item_data["tenantId"] = self.tenant_id
        doc_ref = self._tenant_collection("inbox").document(inbox_item.id)
        doc_ref.set(item_data)
        return inbox_item.id

    def get_inbox_item(self, item_id: str) -> Optional[InboxItem]:
        """Get an inbox item by ID."""
        doc = self._tenant_collection("inbox").document(item_id).get()
        if doc.exists:
            return InboxItem(**doc.to_dict())
        return None

    def list_inbox_items(
        self,
        user_id: str,
        include_deleted: bool = False,
        unread_only: bool = False,
        limit: int = 50,
        offset: int = 0
    ) -> list[InboxItem]:
        """List inbox items for a user."""
        query = self._tenant_collection("inbox").where(
            filter=FieldFilter("user_id", "==", user_id)
        )

        if not include_deleted:
            query = query.where(filter=FieldFilter("is_deleted", "==", False))

        if unread_only:
            query = query.where(filter=FieldFilter("is_read", "==", False))

        query = query.order_by("created_at", direction=firestore.Query.DESCENDING)

        # Apply offset and limit
        if offset > 0:
            query = query.offset(offset)
        query = query.limit(limit)

        docs = query.stream()
        return [InboxItem(**doc.to_dict()) for doc in docs]

    def get_inbox_unread_count(self, user_id: str) -> int:
        """Get unread inbox count for a user using count() aggregation."""
        query = (
            self._tenant_collection("inbox")
            .where(filter=FieldFilter("user_id", "==", user_id))
            .where(filter=FieldFilter("is_deleted", "==", False))
            .where(filter=FieldFilter("is_read", "==", False))
        )
        result = query.count().get()
        return result[0][0].value

    def mark_inbox_read(self, item_id: str) -> None:
        """Mark an inbox item as read."""
        self._tenant_collection("inbox").document(item_id).update({
            "is_read": True,
            "read_at": datetime.now(),
        })

    def mark_inbox_unread(self, item_id: str) -> None:
        """Mark an inbox item as unread."""
        self._tenant_collection("inbox").document(item_id).update({
            "is_read": False,
            "read_at": None,
        })

    def delete_inbox_item(self, item_id: str) -> None:
        """Soft delete an inbox item (removes from list but keeps handover)."""
        self._tenant_collection("inbox").document(item_id).update({
            "is_deleted": True,
            "deleted_at": datetime.now(),
        })

    def delete_inbox_items_for_handover(self, handover_id: str) -> None:
        """Delete all inbox items for a specific handover (when handover is deleted)."""
        docs = (
            self._tenant_collection("inbox")
            .where(filter=FieldFilter("handover_id", "==", handover_id))
            .stream()
        )
        for doc in docs:
            doc.reference.delete()
