/**
 * Migration Script: Migrate existing data to multi-tenant structure
 *
 * This script:
 * 1. Creates a default tenant
 * 2. Registers existing users as tenant members
 * 3. Moves templates/interviews to /tenants/default/interviews
 * 4. Moves sessions to /tenants/default/sessions
 * 5. Moves handovers to /tenants/default/handovers (if applicable)
 *
 * Usage:
 *   npx ts-node migration/migrate-to-multitenant.ts [--dry-run]
 *
 * Options:
 *   --dry-run: Preview changes without writing to Firestore
 */

import * as admin from "firebase-admin";
import { v4 as uuidv4 } from "uuid";
import * as path from "path";
import * as fs from "fs";

// Initialize Firebase Admin
// Try to use service account file if it exists, otherwise use Application Default Credentials
const serviceAccountPath = path.join(__dirname, "..", "service-account.json");

if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} else {
  // Use Application Default Credentials (gcloud auth application-default login)
  admin.initializeApp({
    projectId: "tsugiai",
  });
}

const db = admin.firestore();

// Configuration
const DEFAULT_TENANT_ID = "default";
const DEFAULT_TENANT_NAME = "デフォルト組織";
const DRY_RUN = process.argv.includes("--dry-run");

interface MigrationStats {
  usersProcessed: number;
  usersSkipped: number;
  interviewsMigrated: number;
  sessionsMigrated: number;
  handoversMigrated: number;
  templatesMigrated: number;
  errors: string[];
}

const stats: MigrationStats = {
  usersProcessed: 0,
  usersSkipped: 0,
  interviewsMigrated: 0,
  sessionsMigrated: 0,
  handoversMigrated: 0,
  templatesMigrated: 0,
  errors: [],
};

async function log(message: string) {
  const prefix = DRY_RUN ? "[DRY RUN] " : "";
  console.log(`${prefix}${message}`);
}

async function createDefaultTenant(): Promise<void> {
  log("Creating default tenant...");

  const tenantRef = db.collection("tenants").doc(DEFAULT_TENANT_ID);
  const existingTenant = await tenantRef.get();

  if (existingTenant.exists) {
    log("Default tenant already exists, skipping creation");
    return;
  }

  const tenantData = {
    id: DEFAULT_TENANT_ID,
    name: DEFAULT_TENANT_NAME,
    plan: "free",
    ownerId: null, // Will be set to first admin
    settings: {
      allowPublicInterviews: true,
      maxMembers: 100,
      maxInterviews: 1000,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (!DRY_RUN) {
    await tenantRef.set(tenantData);
  }

  log("Default tenant created");
}

async function migrateUsers(): Promise<string | null> {
  log("Migrating users...");

  const usersSnapshot = await db.collection("users").get();
  let firstAdminId: string | null = null;

  for (const userDoc of usersSnapshot.docs) {
    const userData = userDoc.data();
    const userId = userDoc.id;

    // Check if user already has a tenantId
    if (userData.tenantId) {
      log(`User ${userId} already has tenantId, skipping`);
      stats.usersSkipped++;
      continue;
    }

    // Determine role in tenant based on existing role
    let tenantRole: string;
    if (userData.role === "admin") {
      tenantRole = firstAdminId ? "admin" : "owner";
      if (!firstAdminId) {
        firstAdminId = userId;
      }
    } else if (userData.role === "user") {
      tenantRole = "user";
    } else if (userData.role === "viewer") {
      tenantRole = "viewer";
    } else {
      // pending or unknown role - skip
      log(`User ${userId} has pending/unknown role, skipping tenant membership`);
      stats.usersSkipped++;
      continue;
    }

    // Create tenant member record
    const memberData = {
      userId,
      email: userData.email || "",
      displayName: userData.displayName || "",
      role: tenantRole,
      status: "active",
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (!DRY_RUN) {
      // Update user document with tenantId
      await db.collection("users").doc(userId).update({
        tenantId: DEFAULT_TENANT_ID,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Create member record in tenant
      await db
        .collection("tenants")
        .doc(DEFAULT_TENANT_ID)
        .collection("members")
        .doc(userId)
        .set(memberData);
    }

    log(`Migrated user ${userId} as ${tenantRole}`);
    stats.usersProcessed++;
  }

  // Set owner on tenant if found
  if (firstAdminId && !DRY_RUN) {
    await db.collection("tenants").doc(DEFAULT_TENANT_ID).update({
      ownerId: firstAdminId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    log(`Set tenant owner to ${firstAdminId}`);
  }

  return firstAdminId;
}

async function migrateInterviews(): Promise<void> {
  log("Migrating interviews...");

  const interviewsSnapshot = await db.collection("interviews").get();

  for (const interviewDoc of interviewsSnapshot.docs) {
    const interviewData = interviewDoc.data();
    const interviewId = interviewDoc.id;

    // Check if already migrated
    if (interviewData.tenantId) {
      log(`Interview ${interviewId} already has tenantId, skipping`);
      continue;
    }

    try {
      // Copy to tenant collection
      const newInterviewData = {
        ...interviewData,
        tenantId: DEFAULT_TENANT_ID,
        migratedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (!DRY_RUN) {
        // Create in tenant collection
        await db
          .collection("tenants")
          .doc(DEFAULT_TENANT_ID)
          .collection("interviews")
          .doc(interviewId)
          .set(newInterviewData);

        // Update original document with tenantId (for backward compatibility)
        await db.collection("interviews").doc(interviewId).update({
          tenantId: DEFAULT_TENANT_ID,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      log(`Migrated interview ${interviewId}`);
      stats.interviewsMigrated++;
    } catch (error: any) {
      log(`Error migrating interview ${interviewId}: ${error.message}`);
      stats.errors.push(`Interview ${interviewId}: ${error.message}`);
    }
  }
}

async function migrateSessions(): Promise<void> {
  log("Migrating sessions...");

  const sessionsSnapshot = await db.collection("sessions").get();

  for (const sessionDoc of sessionsSnapshot.docs) {
    const sessionData = sessionDoc.data();
    const sessionId = sessionDoc.id;

    // Check if already migrated
    if (sessionData.tenantId) {
      log(`Session ${sessionId} already has tenantId, skipping`);
      continue;
    }

    try {
      // Copy to tenant collection
      const newSessionData = {
        ...sessionData,
        tenantId: DEFAULT_TENANT_ID,
        migratedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (!DRY_RUN) {
        // Create in tenant collection
        const tenantSessionRef = db
          .collection("tenants")
          .doc(DEFAULT_TENANT_ID)
          .collection("sessions")
          .doc(sessionId);

        await tenantSessionRef.set(newSessionData);

        // Copy turns subcollection
        const turnsSnapshot = await sessionDoc.ref.collection("turns").get();
        for (const turnDoc of turnsSnapshot.docs) {
          await tenantSessionRef.collection("turns").doc(turnDoc.id).set(turnDoc.data());
        }

        // Update original document with tenantId (for backward compatibility)
        await db.collection("sessions").doc(sessionId).update({
          tenantId: DEFAULT_TENANT_ID,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      log(`Migrated session ${sessionId}`);
      stats.sessionsMigrated++;
    } catch (error: any) {
      log(`Error migrating session ${sessionId}: ${error.message}`);
      stats.errors.push(`Session ${sessionId}: ${error.message}`);
    }
  }
}

async function migrateTemplates(): Promise<void> {
  log("Migrating templates...");

  const templatesSnapshot = await db.collection("templates").get();

  for (const templateDoc of templatesSnapshot.docs) {
    const templateData = templateDoc.data();
    const templateId = templateDoc.id;

    // Check if already migrated
    if (templateData.tenantId) {
      log(`Template ${templateId} already has tenantId, skipping`);
      continue;
    }

    try {
      // Copy to tenant collection
      const newTemplateData = {
        ...templateData,
        tenantId: DEFAULT_TENANT_ID,
        migratedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (!DRY_RUN) {
        // Create in tenant collection
        await db
          .collection("tenants")
          .doc(DEFAULT_TENANT_ID)
          .collection("templates")
          .doc(templateId)
          .set(newTemplateData);

        // Update original document with tenantId (for backward compatibility)
        await db.collection("templates").doc(templateId).update({
          tenantId: DEFAULT_TENANT_ID,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      log(`Migrated template ${templateId}`);
      stats.templatesMigrated++;
    } catch (error: any) {
      log(`Error migrating template ${templateId}: ${error.message}`);
      stats.errors.push(`Template ${templateId}: ${error.message}`);
    }
  }
}

async function migrateHandovers(): Promise<void> {
  log("Migrating handovers...");

  // Check if handovers collection exists
  const handoversSnapshot = await db.collection("handovers").limit(1).get();
  if (handoversSnapshot.empty) {
    log("No handovers collection found, skipping");
    return;
  }

  const allHandoversSnapshot = await db.collection("handovers").get();

  for (const handoverDoc of allHandoversSnapshot.docs) {
    const handoverData = handoverDoc.data();
    const handoverId = handoverDoc.id;

    // Check if already migrated
    if (handoverData.tenantId) {
      log(`Handover ${handoverId} already has tenantId, skipping`);
      continue;
    }

    try {
      // Copy to tenant collection
      const newHandoverData = {
        ...handoverData,
        tenantId: DEFAULT_TENANT_ID,
        migratedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (!DRY_RUN) {
        // Create in tenant collection
        const tenantHandoverRef = db
          .collection("tenants")
          .doc(DEFAULT_TENANT_ID)
          .collection("handovers")
          .doc(handoverId);

        await tenantHandoverRef.set(newHandoverData);

        // Copy comments subcollection if exists
        const commentsSnapshot = await handoverDoc.ref.collection("comments").get();
        for (const commentDoc of commentsSnapshot.docs) {
          await tenantHandoverRef.collection("comments").doc(commentDoc.id).set(commentDoc.data());
        }

        // Update original document with tenantId (for backward compatibility)
        await db.collection("handovers").doc(handoverId).update({
          tenantId: DEFAULT_TENANT_ID,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      log(`Migrated handover ${handoverId}`);
      stats.handoversMigrated++;
    } catch (error: any) {
      log(`Error migrating handover ${handoverId}: ${error.message}`);
      stats.errors.push(`Handover ${handoverId}: ${error.message}`);
    }
  }
}

async function printSummary(): Promise<void> {
  console.log("\n========================================");
  console.log("MIGRATION SUMMARY");
  console.log("========================================");
  if (DRY_RUN) {
    console.log("MODE: DRY RUN (no changes made)");
  } else {
    console.log("MODE: LIVE");
  }
  console.log("----------------------------------------");
  console.log(`Users processed: ${stats.usersProcessed}`);
  console.log(`Users skipped: ${stats.usersSkipped}`);
  console.log(`Interviews migrated: ${stats.interviewsMigrated}`);
  console.log(`Sessions migrated: ${stats.sessionsMigrated}`);
  console.log(`Templates migrated: ${stats.templatesMigrated}`);
  console.log(`Handovers migrated: ${stats.handoversMigrated}`);
  console.log("----------------------------------------");
  if (stats.errors.length > 0) {
    console.log(`ERRORS (${stats.errors.length}):`);
    stats.errors.forEach((error) => console.log(`  - ${error}`));
  } else {
    console.log("No errors encountered");
  }
  console.log("========================================\n");
}

async function main() {
  console.log("========================================");
  console.log("MULTI-TENANT MIGRATION SCRIPT");
  console.log("========================================\n");

  if (DRY_RUN) {
    console.log("Running in DRY RUN mode - no changes will be made\n");
  } else {
    console.log("Running in LIVE mode - changes will be written to Firestore\n");
    console.log("Starting in 5 seconds... Press Ctrl+C to cancel\n");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  try {
    // Step 1: Create default tenant
    await createDefaultTenant();

    // Step 2: Migrate users
    await migrateUsers();

    // Step 3: Migrate interviews
    await migrateInterviews();

    // Step 4: Migrate sessions
    await migrateSessions();

    // Step 5: Migrate templates
    await migrateTemplates();

    // Step 6: Migrate handovers
    await migrateHandovers();

    // Print summary
    await printSummary();

    console.log("Migration completed successfully!");
  } catch (error: any) {
    console.error("Migration failed:", error.message);
    process.exit(1);
  }

  process.exit(0);
}

main();
