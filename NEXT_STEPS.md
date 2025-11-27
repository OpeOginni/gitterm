# GitPad - Next Steps

## Overview
Three major features to implement for production readiness:

1. **Authentication on Terminal UI** (Priority: High)
2. **Git Operations Support** (Priority: Medium)
3. **Auto-shutdown Inactive Services** (Priority: Medium)

---

## 1. Authentication on Terminal UI

### Objective
Secure terminal access via subdomains with cookie-based authentication using Cloudflare + wildcard DNS + reverse proxy.

### Architecture Overview
- **Cloudflare:** Manages wildcard DNS (`*.gitterm.dev`) and SSL/TLS
- **Reverse Proxy:** Routes subdomain requests to correct workspace backend
- **Database Mapping:** Stores workspace ↔ subdomain ↔ backend mapping
- **ttyd Terminal:** Runs in Railway container on port 7681
- **Auth:** Cookies validated at proxy level before forwarding to terminal

**Flow:**
```
User visits: alice-workspace.gitterm.dev
    ↓
Cloudflare wildcard DNS routes to proxy
    ↓
Proxy inspects Host header
    ↓
Proxy validates session cookie
    ↓
Proxy looks up workspace in DB: alice-workspace → Railway container IP
    ↓
Proxy forwards to container:7681 (ttyd terminal)
    ↓
Terminal opens with authenticated session
```

### Implementation Steps

#### Step 1: Cloudflare DNS Setup
- [ ] Add your domain to Cloudflare
- [ ] Configure wildcard DNS record:
  ```
  Type   Name      Content
  CNAME  *         your-proxy-ip-or-hostname
  ```
- [ ] Enable Cloudflare proxy (orange cloud icon)
- [ ] Ensure SSL/TLS is set to "Full (strict)"
- [ ] This allows `*.gitterm.dev` to resolve to your proxy

#### Step 2: Set Up Reverse Proxy Service
- [ ] Choose proxy: Traefik, NGINX, or custom Node.js proxy
- [ ] Deploy proxy on Railway or separate VPS
- [ ] Proxy listens on port 80/443
- [ ] Proxy maintains mapping: subdomain → workspace backend

**Recommended: Simple Node.js proxy using `http-proxy`:**
```typescript
// apps/proxy/index.ts
import httpProxy from 'http-proxy';
import { db, eq } from '@gitpad/db';
import { workspace } from '@gitpad/db/schema/workspace';

const proxy = httpProxy.createProxyServer({});

async function getWorkspaceBackend(subdomain: string) {
  // Extract workspace ID from subdomain
  const workspaceId = subdomain.split('.')[0];
  
  // Look up in DB
  const ws = await db.select().from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  
  if (!ws) return null;
  
  // Return Railway container URL or IP
  return ws.backendUrl; // e.g., "https://service-xyz.railway.app:7681"
}

http.createServer(async (req, res) => {
  const host = req.headers.host; // e.g., "alice-workspace.gitterm.dev"
  const subdomain = host.split('.')[0]; // "alice-workspace"
  
  // Validate session cookie
  const sessionCookie = req.headers.cookie?.includes('auth_token=');
  if (!sessionCookie) {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('Unauthorized');
    return;
  }
  
  // Get backend
  const backend = await getWorkspaceBackend(subdomain);
  if (!backend) {
    res.writeHead(404);
    res.end('Workspace not found');
    return;
  }
  
  // Forward request
  proxy.web(req, res, { target: backend });
}).listen(80);
```

#### Step 3: Database Schema Update
- [ ] Add columns to workspace table:
  ```sql
  ALTER TABLE workspace 
  ADD COLUMN subdomain VARCHAR(255) UNIQUE,
  ADD COLUMN backend_url TEXT,
  ADD COLUMN proxy_verified_at TIMESTAMP;
  ```
- [ ] Subdomain format: `{workspace-id}.gitterm.dev`
- [ ] Backend URL: Railway container service URL

#### Step 4: Workspace Creation with Subdomain Assignment
- [ ] When workspace is created, assign subdomain: `{workspace-id}`
- [ ] Store Railway backend URL
- [ ] Insert mapping into DB
- [ ] Proxy automatically routes to it

**Pseudocode:**
```typescript
createService: protectedProcedure
  .mutation(async ({ input, ctx }) => {
    // ... create Railway service ...
    
    const subdomain = `${newWorkspace.id}`;
    const backendUrl = `https://${serviceCreate.railwayDomain}:7681`;
    
    await db.update(workspace)
      .set({
        subdomain,
        backendUrl,
        domain: `${subdomain}.gitterm.dev`
      })
      .where(eq(workspace.id, newWorkspace.id));
    
    return { workspace: newWorkspace };
  })
```

#### Step 5: Backend Proxy Validation Middleware
- [ ] Create middleware to validate workspace ownership
- [ ] Extract user from cookie, validate it owns workspace
- [ ] Prevent cross-user access

**Middleware:**
```typescript
export async function validateProxyAccess(
  subdomain: string,
  userId: string
): Promise<boolean> {
  const ws = await db.select().from(workspace)
    .where(and(
      eq(workspace.subdomain, subdomain),
      eq(workspace.userId, userId)
    ));
  
  return ws.length > 0;
}
```

#### Step 6: Frontend Updates
- [ ] Instance card shows: `alice-workspace.gitterm.dev`
- [ ] "Open Terminal" button links to: `https://alice-workspace.gitterm.dev`
- [ ] Opens in new tab/window
- [ ] Cookie already authenticated from main domain

#### Step 7: Proxy Deployment
- [ ] Deploy proxy service to Railway or VPS
- [ ] Configure environment variables:
  - `DATABASE_URL` - Connection to workspace DB
  - `PORT` - 80/443
- [ ] Point Cloudflare to proxy IP/domain
- [ ] Test with ngrok first (for local testing)

#### Step 8: Testing with ngrok (Local)
- [ ] Run proxy locally: `node proxy.ts`
- [ ] Create ngrok tunnel: `ngrok http 3000`
- [ ] Update hosts file to point to ngrok URL
- [ ] Create test workspace
- [ ] Verify subdomain routing works
- [ ] Verify cookies are validated

#### Step 9: Production Testing
- [ ] Deploy proxy to Railway
- [ ] Point Cloudflare to Railway proxy URL
- [ ] Test end-to-end subdomain access
- [ ] Verify SSL/TLS works
- [ ] Load test multiple concurrent workspaces
- [ ] Test cleanup/deletion of workspaces

---

## 2. Git Operations Support

### Objective
Allow users to commit, push, and manage git operations from both terminal and dashboard.

### Current State
- Container clones repo on startup via `REPO_URL` env var
- Users can run git commands in terminal
- **Missing:** Credentials for pushing changes

### Implementation Steps

#### Step 1: Choose Credential Strategy
- [ ] **Option A (Recommended):** SSH Key Management
  - Users add SSH key in dashboard
  - Store encrypted in DB
  - Mount at `/root/.ssh/id_rsa` in container
  - Container configures git to use SSH

- [ ] **Option B:** GitHub Token
  - Users provide personal access token
  - Pass as `GITHUB_TOKEN` env var
  - Configure git credential helper

**Decision:** Use SSH keys for security + support for any git provider (not just GitHub)

#### Step 2: SSH Key Storage
- [ ] Add migration: `ALTER TABLE user ADD COLUMN ssh_public_key TEXT, ssh_private_key_encrypted TEXT;`
- [ ] Create endpoint to upload/store SSH keys
- [ ] Encrypt private keys at rest (use bcrypt or similar)
- [ ] Add validation for RSA/ED25519 keys

**Endpoint:**
```typescript
uploadSSHKey: protectedProcedure
  .input(z.object({
    publicKey: z.string(),
    privateKey: z.string(),
  }))
  .mutation(async ({ input, ctx }) => {
    // Validate keys
    // Encrypt private key
    // Store in DB
  })
```

#### Step 3: Container SSH Configuration
- [ ] Mount SSH key as Railway secret
- [ ] Update entrypoint to configure git:
  ```bash
  mkdir -p /root/.ssh
  echo "$SSH_PRIVATE_KEY" > /root/.ssh/id_rsa
  chmod 600 /root/.ssh/id_rsa
  ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null
  git config --global user.email "$GIT_EMAIL"
  git config --global user.name "$GIT_USER_NAME"
  ```

#### Step 4: Dashboard Git Operations API
- [ ] Create git operations router: `packages/api/src/routers/git.ts`
- [ ] Implement endpoints:
  - `commitChanges` - Stage and commit files
  - `pushChanges` - Push to remote
  - `pullChanges` - Pull from remote
  - `getStatus` - Show git status
  - `getLog` - Show commit history

**Example endpoint:**
```typescript
commitChanges: protectedProcedure
  .input(z.object({
    workspaceId: z.string(),
    message: z.string(),
    files: z.record(z.string()), // { "path": "content" }
  }))
  .mutation(async ({ input, ctx }) => {
    const workspace = await validateWorkspaceOwnership(input.workspaceId, ctx.session.user.id);
    
    const repo = simpleGit(`/mnt/workspaces/${input.workspaceId}`);
    
    // Write files
    for (const [path, content] of Object.entries(input.files)) {
      await fs.writeFile(path, content);
      await repo.add(path);
    }
    
    // Commit and push
    await repo.commit(input.message);
    await repo.push('origin', 'main');
    
    return { success: true };
  })
```

#### Step 5: Frontend Git Dashboard
- [ ] Create git status component showing:
  - Modified files
  - Commit history
  - Current branch
- [ ] Add commit dialog
- [ ] Add push/pull buttons

#### Step 6: Testing
- [ ] Test SSH key generation and storage
- [ ] Test commit from dashboard
- [ ] Test push to GitHub/GitLab
- [ ] Test pull from remote

---

## 3. Auto-shutdown Inactive Services

### Objective
Automatically pause or terminate services that haven't been used, with smart detection of uncommitted changes.

### Database Schema Update
- [ ] Add `lastActivityAt` timestamp column to workspace table
- [ ] Add `sleepStatus` enum: 'active' | 'paused' | 'terminated'

**Migration:**
```sql
ALTER TABLE workspace 
ADD COLUMN last_activity_at TIMESTAMP DEFAULT NOW(),
ADD COLUMN sleep_status VARCHAR(20) DEFAULT 'active';
```

### Implementation Steps

#### Step 1: Activity Tracking
- [ ] Create middleware to update `lastActivityAt` on every workspace API call
- [ ] Track in ttyd proxy (terminal access)
- [ ] Track in git operations

**Example middleware:**
```typescript
export async function updateWorkspaceActivity(workspaceId: string) {
  await db.update(workspace)
    .set({ lastActivityAt: new Date() })
    .where(eq(workspace.id, workspaceId));
}
```

#### Step 2: Inactivity Detection Service
- [ ] Create background job (node-cron or Bull queue)
- [ ] Run every 15 minutes to check for inactive workspaces
- [ ] Thresholds:
  - 30 minutes: Check for uncommitted changes
  - 24 hours: Terminate completely

**Pseudocode:**
```typescript
cron.schedule('*/15 * * * *', async () => {
  // Find workspaces inactive > 30 min
  const staleWorkspaces = await db.select().from(workspace)
    .where(and(
      sql`NOW() - workspace.last_activity_at > INTERVAL '30 minutes'`,
      sql`workspace.sleep_status != 'paused'`
    ));

  for (const ws of staleWorkspaces) {
    // Check for uncommitted changes
    const hasChanges = await checkUncommittedChanges(ws.externalInstanceId);
    
    if (hasChanges) {
      // Pause container
      await railway.ServiceUpdate({ 
        id: ws.externalInstanceId,
        input: { status: 'paused' } 
      });
      
      // Update DB
      await db.update(workspace)
        .set({ sleepStatus: 'paused' })
        .where(eq(workspace.id, ws.id));
      
      // Notify user
      await notifyUser(ws.userId, `Workspace paused due to inactivity`);
    }
  }

  // Find workspaces inactive > 24 hours
  const terminateWorkspaces = await db.select().from(workspace)
    .where(sql`NOW() - workspace.last_activity_at > INTERVAL '24 hours'`);

  for (const ws of terminateWorkspaces) {
    await railway.ServiceDelete({ id: ws.externalInstanceId });
    
    await db.update(workspace)
      .set({ sleepStatus: 'terminated', endAt: new Date() })
      .where(eq(workspace.id, ws.id));
    
    await notifyUser(ws.userId, 'Workspace terminated due to prolonged inactivity');
  }
});
```

#### Step 3: Uncommitted Changes Detection
- [ ] Implement `checkUncommittedChanges(workspaceId)` function
- [ ] Use `simple-git` to run `git status --porcelain`
- [ ] Return boolean if changes exist

```typescript
async function checkUncommittedChanges(workspaceId: string): Promise<boolean> {
  const repo = simpleGit(`/mnt/workspaces/${workspaceId}`);
  const status = await repo.status();
  return status.files.length > 0;
}
```

#### Step 4: Resume Paused Workspaces
- [ ] Add API endpoint to resume paused workspace
- [ ] Show resume button in dashboard for paused workspaces
- [ ] Update `lastActivityAt` on resume

```typescript
resumeWorkspace: protectedProcedure
  .input(z.object({ workspaceId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    const workspace = await validateWorkspaceOwnership(input.workspaceId, ctx.session.user.id);
    
    if (workspace.sleepStatus !== 'paused') {
      throw new Error('Workspace is not paused');
    }
    
    // Resume on Railway
    await railway.ServiceUpdate({
      id: workspace.externalInstanceId,
      input: { status: 'running' }
    });
    
    // Update DB
    await db.update(workspace)
      .set({ 
        sleepStatus: 'active',
        lastActivityAt: new Date()
      })
      .where(eq(workspace.id, input.workspaceId));
    
    return { success: true };
  })
```

#### Step 5: Frontend Updates
- [ ] Show workspace status in instance card:
  - 🟢 Active
  - 🟡 Paused
  - ⚫ Terminated
- [ ] Add "Resume" button for paused workspaces
- [ ] Show "Uncommitted changes" warning before auto-pause
- [ ] Display inactivity timer (countdown to pause)

#### Step 6: Testing
- [ ] Test activity tracking on API calls
- [ ] Simulate 30-min+ inactivity and verify pause
- [ ] Simulate 24-hour+ inactivity and verify termination
- [ ] Test resume functionality
- [ ] Verify uncommitted changes detection

---

## Implementation Order (Recommended)

1. **Terminal Auth** (Highest ROI)
   - Estimated: 1-2 days
   - Unblocks: Secure workspace access
   - Dependencies: None

2. **Auto-shutdown** (Operational value)
   - Estimated: 1 day
   - Unblocks: Cost savings
   - Dependencies: Activity tracking

3. **Git Operations** (Most complex)
   - Estimated: 2-3 days
   - Unblocks: Full development workflow
   - Dependencies: SSH key management

---

## Technical Checklist

- [ ] Database migrations created and tested
- [ ] Backend endpoints implemented
- [ ] Frontend UI updated
- [ ] Integration tests written
- [ ] E2E tests created
- [ ] Documentation updated
- [ ] Deployment tested on staging
- [ ] Monitoring/alerts configured

---

## Notes

- **Security:** Always encrypt private keys, validate ownership before operations
- **Performance:** Cache git status results to avoid slow operations
- **UX:** Show user-friendly status messages and countdown timers
- **Monitoring:** Log all git operations and auth attempts for debugging

