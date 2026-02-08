# Multi-Tenant Migration Scripts

This directory contains migration scripts to migrate existing data to the multi-tenant architecture.

## Prerequisites

1. **Service Account Key**: Place your Firebase service account JSON file as `service-account.json` in the project root directory (parent of this migration folder).

   - Go to Firebase Console > Project Settings > Service Accounts
   - Click "Generate new private key"
   - Save the file as `service-account.json` in the project root

2. **Install dependencies**:
   ```bash
   cd migration
   npm install
   ```

## Migration Steps

### Step 1: Dry Run (Preview Changes)

First, run the migration in dry-run mode to preview what changes will be made:

```bash
npm run migrate:dry-run
```

This will show you:
- How many users will be migrated
- How many interviews/sessions/templates will be moved
- Any potential errors or issues

No changes will be made to Firestore.

### Step 2: Run Live Migration

After reviewing the dry-run output, run the actual migration:

```bash
npm run migrate:live
```

**Warning**: This will modify your Firestore data. Make sure you have a backup!

The migration will:
1. Create a "default" tenant
2. Update all users with `tenantId` and create member records
3. Copy interviews to `/tenants/default/interviews`
4. Copy sessions (with turns) to `/tenants/default/sessions`
5. Copy templates to `/tenants/default/templates`
6. Copy handovers (with comments) to `/tenants/default/handovers`

### Step 3: Verify Migration

After migration, verify that everything was migrated correctly:

```bash
npm run verify
```

This will check:
- Default tenant exists and has correct structure
- All users have `tenantId` and are in the tenant's members collection
- All data has been properly migrated

## Rollback

The migration preserves original data and adds `tenantId` fields to existing documents. To rollback:

1. Remove `tenantId` field from users, interviews, sessions, templates, handovers
2. Delete the `/tenants` collection

## Data Structure After Migration

### Before Migration
```
/users/{userId}
/interviews/{interviewId}
/sessions/{sessionId}
  /turns/{turnId}
/templates/{templateId}
/handovers/{handoverId}
  /comments/{commentId}
```

### After Migration
```
/users/{userId}
  - tenantId: "default"
/tenants/default
  - id, name, plan, ownerId, settings
  /members/{userId}
    - userId, email, displayName, role, status
  /interviews/{interviewId}
    - (all original fields) + tenantId
  /sessions/{sessionId}
    - (all original fields) + tenantId
    /turns/{turnId}
  /templates/{templateId}
    - (all original fields) + tenantId
  /handovers/{handoverId}
    - (all original fields) + tenantId
    /comments/{commentId}

# Original collections are preserved with tenantId added
/interviews/{interviewId}
  - (all original fields) + tenantId
/sessions/{sessionId}
  - (all original fields) + tenantId
/templates/{templateId}
  - (all original fields) + tenantId
/handovers/{handoverId}
  - (all original fields) + tenantId
```

## Troubleshooting

### "Permission denied" errors

Make sure your service account has the necessary permissions:
- Firestore Data Owner
- Firebase Authentication Admin

### "Document not found" errors

Some documents might have been deleted. The migration will skip these and continue.

### Users not being migrated

Users with `role: "pending"` are not added as tenant members. They need to be approved first.

## Support

If you encounter issues, check:
1. Service account permissions
2. Firestore security rules (temporarily set to open during migration if needed)
3. Console output for specific error messages
