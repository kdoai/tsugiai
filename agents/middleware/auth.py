"""Authentication middleware for tenant-scoped access."""

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import firebase_admin
from firebase_admin import auth, credentials, firestore

# Initialize Firebase Admin if not already done
if not firebase_admin._apps:
    # Try to use service account file if it exists
    service_account_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if service_account_path and os.path.exists(service_account_path):
        cred = credentials.Certificate(service_account_path)
        firebase_admin.initialize_app(cred)
    else:
        # Use Application Default Credentials
        firebase_admin.initialize_app()

# Security scheme
security = HTTPBearer(auto_error=False)


class CurrentUser:
    """Represents the authenticated user with tenant context."""

    def __init__(
        self,
        uid: str,
        email: Optional[str],
        tenant_id: Optional[str],
        tenant_role: Optional[str],
    ):
        self.uid = uid
        self.email = email
        self.tenant_id = tenant_id
        self.tenant_role = tenant_role

    @property
    def is_tenant_admin(self) -> bool:
        """Check if user is tenant admin or owner."""
        return self.tenant_role in ["owner", "admin"]

    @property
    def is_tenant_owner(self) -> bool:
        """Check if user is tenant owner."""
        return self.tenant_role == "owner"


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[CurrentUser]:
    """
    Extract and verify the Firebase ID token from the Authorization header.
    Returns CurrentUser with tenant context, or None if no auth provided.
    """
    if not credentials:
        return None

    token = credentials.credentials

    try:
        # Verify the Firebase ID token
        decoded_token = auth.verify_id_token(token)
        uid = decoded_token["uid"]
        email = decoded_token.get("email")

        # Get user's tenant info from Firestore
        db = firestore.client()
        user_doc = db.collection("users").document(uid).get()

        tenant_id = None
        tenant_role = None

        if user_doc.exists:
            user_data = user_doc.to_dict()
            tenant_id = user_data.get("tenantId")

            # Get tenant role from members collection
            if tenant_id:
                member_doc = (
                    db.collection("tenants")
                    .document(tenant_id)
                    .collection("members")
                    .document(uid)
                    .get()
                )
                if member_doc.exists:
                    tenant_role = member_doc.to_dict().get("role")

        return CurrentUser(
            uid=uid,
            email=email,
            tenant_id=tenant_id,
            tenant_role=tenant_role,
        )
    except Exception as e:
        logger.warning("Auth error: %s", e)
        raise HTTPException(status_code=401, detail="Invalid authentication token")


async def require_auth(
    current_user: Optional[CurrentUser] = Depends(get_current_user),
) -> CurrentUser:
    """Require authentication - raises 401 if not authenticated."""
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return current_user


async def require_tenant(
    current_user: CurrentUser = Depends(require_auth),
) -> CurrentUser:
    """Require user to belong to a tenant - raises 403 if no tenant."""
    if not current_user.tenant_id:
        raise HTTPException(status_code=403, detail="User does not belong to any tenant")
    return current_user


async def require_tenant_admin(
    current_user: CurrentUser = Depends(require_tenant),
) -> CurrentUser:
    """Require user to be tenant admin or owner."""
    if not current_user.is_tenant_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user
