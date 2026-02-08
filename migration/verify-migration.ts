/**
 * Verification Script: Verify multi-tenant migration
 *
 * This script checks:
 * 1. Default tenant exists and has correct structure
 * 2. All users have tenantId and are members of the tenant
 * 3. All interviews/sessions/templates have tenantId
 * 4. Tenant collections have the migrated data
 *
 * Usage:
 *   npx ts-node migration/verify-migration.ts
 */

import * as admin from "firebase-admin";
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

interface VerificationResult {
  check: string;
  status: "pass" | "fail" | "warn";
  message: string;
  details?: string[];
}

const results: VerificationResult[] = [];

function addResult(check: string, status: "pass" | "fail" | "warn", message: string, details?: string[]) {
  results.push({ check, status, message, details });
}

async function checkDefaultTenant(): Promise<void> {
  console.log("Checking default tenant...");

  const tenantDoc = await db.collection("tenants").doc(DEFAULT_TENANT_ID).get();

  if (!tenantDoc.exists) {
    addResult("Default Tenant", "fail", "Default tenant does not exist");
    return;
  }

  const tenantData = tenantDoc.data()!;
  const issues: string[] = [];

  if (!tenantData.name) issues.push("Missing name");
  if (!tenantData.ownerId) issues.push("Missing ownerId");
  if (!tenantData.plan) issues.push("Missing plan");
  if (!tenantData.settings) issues.push("Missing settings");

  if (issues.length > 0) {
    addResult("Default Tenant", "warn", "Default tenant exists but has issues", issues);
  } else {
    addResult("Default Tenant", "pass", `Default tenant exists: "${tenantData.name}"`);
  }
}

async function checkUsers(): Promise<void> {
  console.log("Checking users...");

  const usersSnapshot = await db.collection("users").get();
  const membersSnapshot = await db
    .collection("tenants")
    .doc(DEFAULT_TENANT_ID)
    .collection("members")
    .get();

  const memberIds = new Set(membersSnapshot.docs.map((doc) => doc.id));
  const usersWithoutTenant: string[] = [];
  const usersNotInMembers: string[] = [];
  let approvedUsers = 0;

  for (const userDoc of usersSnapshot.docs) {
    const userData = userDoc.data();
    const userId = userDoc.id;

    // Skip pending users
    if (userData.role === "pending") continue;

    approvedUsers++;

    if (!userData.tenantId) {
      usersWithoutTenant.push(userId);
    }

    if (!memberIds.has(userId)) {
      usersNotInMembers.push(userId);
    }
  }

  if (usersWithoutTenant.length > 0) {
    addResult(
      "Users with tenantId",
      "fail",
      `${usersWithoutTenant.length} users missing tenantId`,
      usersWithoutTenant.slice(0, 10)
    );
  } else {
    addResult("Users with tenantId", "pass", `All ${approvedUsers} approved users have tenantId`);
  }

  if (usersNotInMembers.length > 0) {
    addResult(
      "Users in tenant members",
      "fail",
      `${usersNotInMembers.length} users not in tenant members`,
      usersNotInMembers.slice(0, 10)
    );
  } else {
    addResult("Users in tenant members", "pass", `All ${approvedUsers} approved users are tenant members`);
  }
}

async function checkInterviews(): Promise<void> {
  console.log("Checking interviews...");

  // Check global collection
  const globalInterviewsSnapshot = await db.collection("interviews").get();
  const globalWithoutTenant: string[] = [];

  for (const doc of globalInterviewsSnapshot.docs) {
    if (!doc.data().tenantId) {
      globalWithoutTenant.push(doc.id);
    }
  }

  // Check tenant collection
  const tenantInterviewsSnapshot = await db
    .collection("tenants")
    .doc(DEFAULT_TENANT_ID)
    .collection("interviews")
    .get();

  if (globalWithoutTenant.length > 0) {
    addResult(
      "Interviews with tenantId",
      "fail",
      `${globalWithoutTenant.length} interviews missing tenantId`,
      globalWithoutTenant.slice(0, 10)
    );
  } else {
    addResult(
      "Interviews with tenantId",
      "pass",
      `All ${globalInterviewsSnapshot.size} interviews have tenantId`
    );
  }

  addResult(
    "Interviews in tenant",
    tenantInterviewsSnapshot.size > 0 ? "pass" : "warn",
    `${tenantInterviewsSnapshot.size} interviews in tenant collection`
  );
}

async function checkSessions(): Promise<void> {
  console.log("Checking sessions...");

  // Check global collection
  const globalSessionsSnapshot = await db.collection("sessions").get();
  const globalWithoutTenant: string[] = [];

  for (const doc of globalSessionsSnapshot.docs) {
    if (!doc.data().tenantId) {
      globalWithoutTenant.push(doc.id);
    }
  }

  // Check tenant collection
  const tenantSessionsSnapshot = await db
    .collection("tenants")
    .doc(DEFAULT_TENANT_ID)
    .collection("sessions")
    .get();

  if (globalWithoutTenant.length > 0) {
    addResult(
      "Sessions with tenantId",
      "fail",
      `${globalWithoutTenant.length} sessions missing tenantId`,
      globalWithoutTenant.slice(0, 10)
    );
  } else {
    addResult(
      "Sessions with tenantId",
      "pass",
      `All ${globalSessionsSnapshot.size} sessions have tenantId`
    );
  }

  addResult(
    "Sessions in tenant",
    tenantSessionsSnapshot.size > 0 ? "pass" : "warn",
    `${tenantSessionsSnapshot.size} sessions in tenant collection`
  );
}

async function checkTemplates(): Promise<void> {
  console.log("Checking templates...");

  // Check global collection
  const globalTemplatesSnapshot = await db.collection("templates").get();

  if (globalTemplatesSnapshot.empty) {
    addResult("Templates", "pass", "No templates collection found (skipping)");
    return;
  }

  const globalWithoutTenant: string[] = [];

  for (const doc of globalTemplatesSnapshot.docs) {
    if (!doc.data().tenantId) {
      globalWithoutTenant.push(doc.id);
    }
  }

  // Check tenant collection
  const tenantTemplatesSnapshot = await db
    .collection("tenants")
    .doc(DEFAULT_TENANT_ID)
    .collection("templates")
    .get();

  if (globalWithoutTenant.length > 0) {
    addResult(
      "Templates with tenantId",
      "fail",
      `${globalWithoutTenant.length} templates missing tenantId`,
      globalWithoutTenant.slice(0, 10)
    );
  } else {
    addResult(
      "Templates with tenantId",
      "pass",
      `All ${globalTemplatesSnapshot.size} templates have tenantId`
    );
  }

  addResult(
    "Templates in tenant",
    tenantTemplatesSnapshot.size > 0 ? "pass" : "warn",
    `${tenantTemplatesSnapshot.size} templates in tenant collection`
  );
}

async function checkHandovers(): Promise<void> {
  console.log("Checking handovers...");

  // Check global collection
  const globalHandoversSnapshot = await db.collection("handovers").limit(1).get();

  if (globalHandoversSnapshot.empty) {
    addResult("Handovers", "pass", "No handovers collection found (skipping)");
    return;
  }

  const allHandoversSnapshot = await db.collection("handovers").get();
  const globalWithoutTenant: string[] = [];

  for (const doc of allHandoversSnapshot.docs) {
    if (!doc.data().tenantId) {
      globalWithoutTenant.push(doc.id);
    }
  }

  // Check tenant collection
  const tenantHandoversSnapshot = await db
    .collection("tenants")
    .doc(DEFAULT_TENANT_ID)
    .collection("handovers")
    .get();

  if (globalWithoutTenant.length > 0) {
    addResult(
      "Handovers with tenantId",
      "fail",
      `${globalWithoutTenant.length} handovers missing tenantId`,
      globalWithoutTenant.slice(0, 10)
    );
  } else {
    addResult(
      "Handovers with tenantId",
      "pass",
      `All ${allHandoversSnapshot.size} handovers have tenantId`
    );
  }

  addResult(
    "Handovers in tenant",
    tenantHandoversSnapshot.size > 0 ? "pass" : "warn",
    `${tenantHandoversSnapshot.size} handovers in tenant collection`
  );
}

function printResults(): void {
  console.log("\n========================================");
  console.log("VERIFICATION RESULTS");
  console.log("========================================\n");

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const warned = results.filter((r) => r.status === "warn").length;

  for (const result of results) {
    const icon = result.status === "pass" ? "[PASS]" : result.status === "fail" ? "[FAIL]" : "[WARN]";
    const color =
      result.status === "pass" ? "\x1b[32m" : result.status === "fail" ? "\x1b[31m" : "\x1b[33m";
    const reset = "\x1b[0m";

    console.log(`${color}${icon}${reset} ${result.check}: ${result.message}`);
    if (result.details && result.details.length > 0) {
      result.details.forEach((detail) => console.log(`       - ${detail}`));
      if (result.details.length === 10) {
        console.log(`       ... and more`);
      }
    }
  }

  console.log("\n----------------------------------------");
  console.log(`Total: ${results.length} checks`);
  console.log(`  \x1b[32mPassed: ${passed}\x1b[0m`);
  if (failed > 0) console.log(`  \x1b[31mFailed: ${failed}\x1b[0m`);
  if (warned > 0) console.log(`  \x1b[33mWarnings: ${warned}\x1b[0m`);
  console.log("========================================\n");

  if (failed > 0) {
    console.log("Migration verification FAILED. Please run the migration script.");
    process.exit(1);
  } else if (warned > 0) {
    console.log("Migration verification passed with warnings.");
    process.exit(0);
  } else {
    console.log("Migration verification PASSED!");
    process.exit(0);
  }
}

async function main() {
  console.log("========================================");
  console.log("MULTI-TENANT MIGRATION VERIFICATION");
  console.log("========================================\n");

  try {
    await checkDefaultTenant();
    await checkUsers();
    await checkInterviews();
    await checkSessions();
    await checkTemplates();
    await checkHandovers();

    printResults();
  } catch (error: any) {
    console.error("Verification failed:", error.message);
    process.exit(1);
  }
}

main();
