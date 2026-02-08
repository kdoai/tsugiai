import * as admin from "firebase-admin";
import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { v4 as uuidv4 } from "uuid";

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

// ==================== Types ====================

type TenantRole = "owner" | "admin" | "user" | "viewer";
type MemberStatus = "active" | "invited" | "suspended";
type TenantPlan = "free" | "starter" | "professional" | "enterprise";

interface TenantSettings {
  allowPublicInterviews: boolean;
  maxMembers: number;
  maxInterviews: number;
}

interface TenantRecord {
  id: string;
  name: string;
  plan: TenantPlan;
  ownerId: string;
  settings: TenantSettings;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

interface TenantMember {
  userId: string;
  tenantId: string;
  role: TenantRole;
  displayName: string | null;
  email: string | null;
  status: MemberStatus;
  invitedBy?: string;
  invitedAt?: admin.firestore.Timestamp;
  joinedAt?: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

interface Invitation {
  id: string;
  tenantId: string;
  tenantName: string;
  email: string;
  role: TenantRole;
  invitedBy: string;
  invitedByName: string;
  token: string;
  expiresAt: admin.firestore.Timestamp;
  status: "pending" | "accepted" | "expired" | "cancelled";
  createdAt: admin.firestore.Timestamp;
}

// ==================== Helper Functions ====================

/**
 * Check if user is an admin (legacy or global)
 */
async function isUserAdmin(uid: string): Promise<boolean> {
  // Check admins collection
  const adminDoc = await db.collection("admins").doc(uid).get();
  if (adminDoc.exists) {
    return true;
  }

  // Check users collection for admin role
  const userDoc = await db.collection("users").doc(uid).get();
  if (userDoc.exists) {
    const userData = userDoc.data();
    return userData?.role === "admin" || userData?.globalRole === "superadmin";
  }

  return false;
}

/**
 * Check if user is a tenant admin (owner or admin)
 */
async function isTenantAdmin(uid: string, tenantId: string): Promise<boolean> {
  const memberDoc = await db
    .collection("tenants")
    .doc(tenantId)
    .collection("members")
    .doc(uid)
    .get();

  if (!memberDoc.exists) {
    return false;
  }

  const memberData = memberDoc.data();
  return memberData?.status === "active" && ["owner", "admin"].includes(memberData?.role);
}

/**
 * Get user display name
 */
async function getUserDisplayName(uid: string): Promise<string> {
  const userDoc = await db.collection("users").doc(uid).get();
  if (userDoc.exists) {
    const userData = userDoc.data();
    return userData?.displayName || userData?.email || "Unknown";
  }

  const authUser = await admin.auth().getUser(uid);
  return authUser.displayName || authUser.email || "Unknown";
}

/**
 * Generate a secure random token
 */
function generateToken(): string {
  return uuidv4() + "-" + uuidv4();
}

// ==================== Cloud Functions ====================

/**
 * Create a new tenant
 * Called by authenticated users who want to create a new organization
 */
export const createTenant = onCall(
  { region: "asia-northeast1" },
  async (request: CallableRequest<{ name: string }>) => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { name } = request.data;
    const uid = request.auth.uid;

    if (!name || name.trim().length < 2) {
      throw new HttpsError("invalid-argument", "テナント名は2文字以上で入力してください");
    }

    // Get user info
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : null;

    // Check if user already has a tenant
    if (userData?.tenantId) {
      throw new HttpsError("already-exists", "すでにテナントに所属しています");
    }

    // Create tenant
    const tenantId = uuidv4();
    const now = admin.firestore.Timestamp.now();

    const tenant: TenantRecord = {
      id: tenantId,
      name: name.trim(),
      plan: "free",
      ownerId: uid,
      settings: {
        allowPublicInterviews: true,
        maxMembers: 5,
        maxInterviews: 10,
      },
      createdAt: now,
      updatedAt: now,
    };

    // Create tenant member record for owner
    const ownerMember: TenantMember = {
      userId: uid,
      tenantId,
      role: "owner",
      displayName: userData?.displayName || null,
      email: userData?.email || request.auth.token.email || null,
      status: "active",
      joinedAt: now,
      updatedAt: now,
    };

    // Use a batch to create tenant and member atomically
    const batch = db.batch();
    batch.set(db.collection("tenants").doc(tenantId), tenant);
    batch.set(
      db.collection("tenants").doc(tenantId).collection("members").doc(uid),
      ownerMember
    );
    batch.update(db.collection("users").doc(uid), {
      tenantId,
      updatedAt: now,
    });
    await batch.commit();

    return {
      success: true,
      tenantId,
      message: "テナントを作成しました",
    };
  }
);

/**
 * Invite a user to a tenant
 * Called by tenant admins to invite new members
 */
export const inviteUser = onCall(
  { region: "asia-northeast1" },
  async (request: CallableRequest<{ tenantId: string; email: string; role: TenantRole }>) => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { tenantId, email, role } = request.data;
    const uid = request.auth.uid;

    if (!tenantId || !email || !role) {
      throw new HttpsError("invalid-argument", "必須パラメータが不足しています");
    }

    // Validate email
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      throw new HttpsError("invalid-argument", "有効なメールアドレスを入力してください");
    }

    // Validate role
    if (!["admin", "user", "viewer"].includes(role)) {
      throw new HttpsError("invalid-argument", "無効なロールです");
    }

    // Check if user is a tenant admin
    const isTenantAdminResult = await isTenantAdmin(uid, tenantId);
    const isGlobalAdmin = await isUserAdmin(uid);

    if (!isTenantAdminResult && !isGlobalAdmin) {
      throw new HttpsError("permission-denied", "テナント管理者権限が必要です");
    }

    // Get tenant info
    const tenantDoc = await db.collection("tenants").doc(tenantId).get();
    if (!tenantDoc.exists) {
      throw new HttpsError("not-found", "テナントが見つかりません");
    }

    const tenantData = tenantDoc.data() as TenantRecord;

    // Check if user already exists in the tenant
    const existingMembersSnapshot = await db
      .collection("tenants")
      .doc(tenantId)
      .collection("members")
      .where("email", "==", email.toLowerCase())
      .get();

    if (!existingMembersSnapshot.empty) {
      throw new HttpsError("already-exists", "このユーザーはすでにテナントに所属しています");
    }

    // Check for existing pending invitation
    const existingInvitationSnapshot = await db
      .collection("invitations")
      .where("tenantId", "==", tenantId)
      .where("email", "==", email.toLowerCase())
      .where("status", "==", "pending")
      .get();

    if (!existingInvitationSnapshot.empty) {
      throw new HttpsError("already-exists", "このメールアドレスには既に招待が送信されています");
    }

    // Get inviter display name
    const inviterName = await getUserDisplayName(uid);

    // Create invitation
    const invitationId = uuidv4();
    const token = generateToken();
    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    );

    const invitation: Invitation = {
      id: invitationId,
      tenantId,
      tenantName: tenantData.name,
      email: email.toLowerCase(),
      role,
      invitedBy: uid,
      invitedByName: inviterName,
      token,
      expiresAt,
      status: "pending",
      createdAt: now,
    };

    await db.collection("invitations").doc(invitationId).set(invitation);

    return {
      success: true,
      invitationId,
      token,
      message: `${email}に招待を送信しました`,
    };
  }
);

/**
 * Accept an invitation to join a tenant
 * Called by users who have received an invitation
 */
export const acceptInvitation = onCall(
  { region: "asia-northeast1" },
  async (request: CallableRequest<{ token: string }>) => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { token } = request.data;
    const uid = request.auth.uid;

    if (!token) {
      throw new HttpsError("invalid-argument", "招待トークンが必要です");
    }

    // Find invitation by token
    const invitationSnapshot = await db
      .collection("invitations")
      .where("token", "==", token)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (invitationSnapshot.empty) {
      throw new HttpsError("not-found", "有効な招待が見つかりません");
    }

    const invitationDoc = invitationSnapshot.docs[0];
    const invitation = invitationDoc.data() as Invitation;

    // Check if invitation is expired
    if (invitation.expiresAt.toDate() < new Date()) {
      await invitationDoc.ref.update({ status: "expired" });
      throw new HttpsError("failed-precondition", "招待の有効期限が切れています");
    }

    // Verify email matches (optional - could allow any authenticated user)
    const userEmail = request.auth.token.email?.toLowerCase();
    if (userEmail && invitation.email !== userEmail) {
      throw new HttpsError(
        "permission-denied",
        "この招待は別のメールアドレス宛てです"
      );
    }

    // Get user info
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : null;

    // Check if user already belongs to a tenant
    if (userData?.tenantId) {
      throw new HttpsError("already-exists", "すでに別のテナントに所属しています");
    }

    // Create tenant member record
    const now = admin.firestore.Timestamp.now();
    const member: TenantMember = {
      userId: uid,
      tenantId: invitation.tenantId,
      role: invitation.role,
      displayName: userData?.displayName || null,
      email: userEmail || invitation.email,
      status: "active",
      invitedBy: invitation.invitedBy,
      invitedAt: invitation.createdAt,
      joinedAt: now,
      updatedAt: now,
    };

    // Use a batch to update all documents atomically
    const batch = db.batch();
    batch.set(
      db
        .collection("tenants")
        .doc(invitation.tenantId)
        .collection("members")
        .doc(uid),
      member
    );
    batch.update(db.collection("users").doc(uid), {
      tenantId: invitation.tenantId,
      updatedAt: now,
    });
    batch.update(invitationDoc.ref, { status: "accepted" });
    await batch.commit();

    return {
      success: true,
      tenantId: invitation.tenantId,
      message: `${invitation.tenantName}に参加しました`,
    };
  }
);

/**
 * Cancel an invitation
 * Called by tenant admins to revoke a pending invitation
 */
export const cancelInvitation = onCall(
  { region: "asia-northeast1" },
  async (request: CallableRequest<{ invitationId: string }>) => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { invitationId } = request.data;
    const uid = request.auth.uid;

    if (!invitationId) {
      throw new HttpsError("invalid-argument", "招待IDが必要です");
    }

    // Get invitation
    const invitationDoc = await db.collection("invitations").doc(invitationId).get();
    if (!invitationDoc.exists) {
      throw new HttpsError("not-found", "招待が見つかりません");
    }

    const invitation = invitationDoc.data() as Invitation;

    if (invitation.status !== "pending") {
      throw new HttpsError("failed-precondition", "この招待は既に処理されています");
    }

    // Check if user is a tenant admin
    const isTenantAdminResult = await isTenantAdmin(uid, invitation.tenantId);
    const isGlobalAdmin = await isUserAdmin(uid);

    if (!isTenantAdminResult && !isGlobalAdmin) {
      throw new HttpsError("permission-denied", "テナント管理者権限が必要です");
    }

    // Cancel invitation
    await invitationDoc.ref.update({
      status: "cancelled",
      cancelledAt: admin.firestore.Timestamp.now(),
      cancelledBy: uid,
    });

    return {
      success: true,
      message: "招待をキャンセルしました",
    };
  }
);

/**
 * Delete a user (legacy function - updated for multi-tenant)
 * Called by admins to delete a user from the system
 */
export const deleteUser = onCall(
  { region: "asia-northeast1" },
  async (request: CallableRequest<{ uid: string }>) => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { uid: targetUid } = request.data;
    const callerUid = request.auth.uid;

    if (!targetUid) {
      throw new HttpsError("invalid-argument", "ユーザーIDが必要です");
    }

    // Check if caller is an admin
    const isAdmin = await isUserAdmin(callerUid);
    if (!isAdmin) {
      throw new HttpsError("permission-denied", "管理者権限が必要です");
    }

    // Prevent self-deletion
    if (callerUid === targetUid) {
      throw new HttpsError("invalid-argument", "自分自身を削除することはできません");
    }

    // Get user info before deletion
    const userDoc = await db.collection("users").doc(targetUid).get();
    const userData = userDoc.exists ? userDoc.data() : null;

    // Remove from tenant if belongs to one
    if (userData?.tenantId) {
      const memberRef = db
        .collection("tenants")
        .doc(userData.tenantId)
        .collection("members")
        .doc(targetUid);

      const memberDoc = await memberRef.get();
      if (memberDoc.exists) {
        const memberData = memberDoc.data();
        // Don't allow deletion of tenant owner
        if (memberData?.role === "owner") {
          throw new HttpsError(
            "failed-precondition",
            "テナントオーナーは削除できません。先にテナントを削除してください。"
          );
        }
        await memberRef.delete();
      }
    }

    // Delete user from Firestore
    await db.collection("users").doc(targetUid).delete();

    // Delete user from Firebase Auth
    try {
      await admin.auth().deleteUser(targetUid);
    } catch (authError) {
      console.error("Failed to delete user from Auth:", authError);
      // Continue even if Auth deletion fails - user is already removed from Firestore
    }

    return {
      success: true,
      message: "ユーザーを削除しました",
    };
  }
);

/**
 * Leave a tenant
 * Called by users who want to leave their current tenant
 */
export const leaveTenant = onCall(
  { region: "asia-northeast1" },
  async (request: CallableRequest) => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const uid = request.auth.uid;

    // Get user info
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      throw new HttpsError("not-found", "ユーザーが見つかりません");
    }

    const userData = userDoc.data();
    if (!userData?.tenantId) {
      throw new HttpsError("failed-precondition", "テナントに所属していません");
    }

    const tenantId = userData.tenantId;

    // Check if user is the owner
    const memberDoc = await db
      .collection("tenants")
      .doc(tenantId)
      .collection("members")
      .doc(uid)
      .get();

    if (memberDoc.exists) {
      const memberData = memberDoc.data();
      if (memberData?.role === "owner") {
        throw new HttpsError(
          "failed-precondition",
          "オーナーはテナントを離れることができません。先に別のオーナーを指定するか、テナントを削除してください。"
        );
      }
    }

    // Remove from tenant
    const batch = db.batch();
    batch.delete(
      db.collection("tenants").doc(tenantId).collection("members").doc(uid)
    );
    batch.update(db.collection("users").doc(uid), {
      tenantId: null,
      updatedAt: admin.firestore.Timestamp.now(),
    });
    await batch.commit();

    return {
      success: true,
      message: "テナントを離れました",
    };
  }
);

/**
 * Transfer tenant ownership
 * Called by the current owner to transfer ownership to another admin
 */
export const transferOwnership = onCall(
  { region: "asia-northeast1" },
  async (request: CallableRequest<{ tenantId: string; newOwnerId: string }>) => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { tenantId, newOwnerId } = request.data;
    const uid = request.auth.uid;

    if (!tenantId || !newOwnerId) {
      throw new HttpsError("invalid-argument", "必須パラメータが不足しています");
    }

    // Check if caller is the tenant owner
    const callerMemberDoc = await db
      .collection("tenants")
      .doc(tenantId)
      .collection("members")
      .doc(uid)
      .get();

    if (!callerMemberDoc.exists || callerMemberDoc.data()?.role !== "owner") {
      throw new HttpsError("permission-denied", "オーナー権限が必要です");
    }

    // Check if new owner is a tenant member
    const newOwnerMemberDoc = await db
      .collection("tenants")
      .doc(tenantId)
      .collection("members")
      .doc(newOwnerId)
      .get();

    if (!newOwnerMemberDoc.exists) {
      throw new HttpsError("not-found", "指定されたユーザーはテナントメンバーではありません");
    }

    if (newOwnerMemberDoc.data()?.status !== "active") {
      throw new HttpsError("failed-precondition", "指定されたユーザーはアクティブではありません");
    }

    // Transfer ownership
    const now = admin.firestore.Timestamp.now();
    const batch = db.batch();

    // Update current owner to admin
    batch.update(callerMemberDoc.ref, {
      role: "admin",
      updatedAt: now,
    });

    // Update new owner
    batch.update(newOwnerMemberDoc.ref, {
      role: "owner",
      updatedAt: now,
    });

    // Update tenant owner ID
    batch.update(db.collection("tenants").doc(tenantId), {
      ownerId: newOwnerId,
      updatedAt: now,
    });

    await batch.commit();

    return {
      success: true,
      message: "オーナー権限を移譲しました",
    };
  }
);
