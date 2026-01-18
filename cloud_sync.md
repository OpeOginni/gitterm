Cloud Workspace Sync - Product Requirements Document

1. Executive Summary
   Enable users to seamlessly sync their OpenCode workspace state to the cloud, allowing them to resume work across devices. The solution leverages OpenCode's snapshot system for change detection while implementing a content-addressed chunked sync for efficient file storage—similar to rsync, Dropbox, and GitPod.
   Key Decision: Store file contents as chunked, content-addressed objects. This provides deduplication, minimal bandwidth usage, and resume capability without requiring git commits or syncing git objects.

---

2. Goals
   Primary Goals

- ✅ Enable cloud backup and restore of OpenCode sessions + worktree state
- ✅ Allow seamless workspace resumption across devices
- ✅ Preserve full session history (messages, tool outputs, revert capability)
- ✅ Work regardless of user's git commit status
  Non-Goals
- ❌ Sync user's remote git repositories (handled by existing git workflows)
- ❌ Sync OpenCode's internal git objects (implementation detail, not transport layer)
- ❌ Real-time collaboration (single-user workspace sync only)

---

3. User Stories
   As a developer who works on multiple machines
   Given I have a laptop and desktop  
   When I finish working on my laptop and sync  
   Then I should be able to resume on my desktop with identical files and session history
   As a developer who doesn't commit often
   Given I have uncommitted changes and an active OpenCode session  
   When I sync to the cloud  
   Then all my uncommitted work and conversation context should be preserved
   As a developer who accidentally breaks something
   Given I have an OpenCode session synced to the cloud  
   When I need to revert to an earlier state  
   Then I should be able to restore any previous snapshot with full file state
   As a developer with limited bandwidth
   Given I make small changes to large files  
   When I sync to the cloud  
   Then only the changed portions should be uploaded

---

4. Technical Architecture
   4.1 Core Components
   ┌─────────────────────────────────────────────────────────────┐
   │ User Machine │
   ├─────────────────────────────────────────────────────────────┤
   │ Worktree (/Users/joe/todo-app/) │
   │ ├── src/App.tsx │
   │ ├── src/components/TaskItem.tsx │
   │ └── ... │
   │ │
   │ OpenCode State (~/.opencode/data/) │
   │ ├── sessions/sess-1.json │
   │ └── snapshot/abc123/ (internal git objects) │
   │ │
   │ Sync Client │
   │ ├── Chunker (splits files into chunks) │
   │ ├── Manifest Builder (maps snapshots → files → chunks) │
   │ └── Uploader/Downloader │
   └─────────────────────────────────────────────────────────────┘
   ↕
   HTTPS + Auth
   ↕
   ┌─────────────────────────────────────────────────────────────┐
   │ Cloud Backend │
   ├─────────────────────────────────────────────────────────────┤
   │ API Layer │
   │ ├── POST /workspaces/{id}/sync │
   │ ├── GET /workspaces/{id}/manifests/{hash} │
   │ ├── POST /objects/batch │
   │ └── GET /objects/{hash} │
   │ │
   │ Storage Layer (S3-compatible) │
   │ ├── workspaces/{id}/ │
   │ │ ├── sessions/ │
   │ │ ├── manifests/ │
   │ │ └── current.json │
   │ └── objects/ │
   │ └── {hash_prefix}/{hash} │
   └─────────────────────────────────────────────────────────────┘
   4.2 Design Decisions
   | Decision | Rationale |
   |----------|-----------|
   | Content-addressed chunked sync | Deduplication, resume capability, minimal bandwidth |
   | Fixed-size chunks (256KB) | Simple implementation, good balance |
   | BLAKE3 hashing | Fast, collision-resistant, industry standard |
   | OpenCode snapshots for change detection | Leverage existing system, semantic checkpoints |
   | Optional git clone on restore | User may or may not have remote repo |

---

5. Data Models
   5.1 Manifest Schema
   interface Manifest {
   workspace: string // Workspace ID
   snapshot: string // OpenCode snapshot hash
   created_at: number // Unix timestamp
   parent_snapshot?: string // For incremental sync

files: {
[path: string]: {
size: number
chunks: string[] // Array of BLAKE3 chunk hashes
mode?: number // File permissions (optional)
}
}
}
Example:
{
workspace: abc123,
snapshot: def456ghi,
created_at: 1736976000000,
files: {
src/App.tsx: {
size: 2410,
chunks: [
b3:1a92c4e8d7f5b0a1,
b3:8f13e2d4c6a0b9e8,
b3:aa4477ff33bb22aa
]
},
src/components/TaskItem.tsx: {
size: 1234,
chunks: [b3:9911...]
}
}
}
5.2 Sync Payload
interface SyncRequest {
workspace: string
baseline_snapshot?: string // Last synced snapshot
current_snapshot: string // Current OpenCode snapshot

// Files changed (from Snapshot.patch())
changed_files: string[]

// New manifests to upload
manifests: Manifest[]

// New chunks to upload
chunks: {
hash: string
data: ArrayBuffer
}[]
}
interface SyncResponse {
// Required chunks to download
required_chunks: string[]

// Latest manifest
manifest: Manifest

// Session data (optional)
sessions?: Session[]
}
5.3 Session Schema (from OpenCode)
interface Session {
id: string
workspace: string
messages: Message[]
parts: Part[]
revert?: {
messageID: string
partID?: string
snapshot: string
diff: string
}
created_at: number
updated_at: number
}

---

6. Workflow Specifications
   6.1 Initial Sync (Baseline)
   Command: opencode sync --init
   Flow:
1. Create baseline OpenCode snapshot
1. Read all tracked files from worktree
1. Chunk files into 256KB pieces
1. Hash each chunk with BLAKE3
1. Build manifest: snapshot → files → chunks
1. Upload missing chunks to cloud
1. Upload manifest
1. Store manifest hash locally as current.json
   Result:

- Cloud has complete file state as chunked objects
- Workspace has reference to baseline manifest
  6.2 Incremental Sync
  Command: opencode sync
  Flow:

1. Create new OpenCode snapshot
2. Get changed files: Snapshot.patch(baseline_snapshot)
3. For each changed file:
   - Re-chunk the file
   - Compare chunk hashes with baseline manifest
   - Identify new chunks
4. Upload only new chunks
5. Build new manifest referencing existing + new chunks
6. Upload manifest
7. Update current.json
   Result:

- Only changed data uploaded
- Cloud has incremental history
  6.3 Restore from Cloud
  Command: opencode workspace pull <workspace-id>
  Flow:

1. Clone/fetch git repo (if available)
2. Download latest manifest
3. Download required chunks
4. Reassemble files from chunks
5. Write files to worktree
6. Download session data
7. Restore sessions to local storage
8. (Optional) Rebuild OpenCode snapshot git objects
   Result:

- Worktree restored to exact state
- Full conversation history available
- Can continue work immediately
  6.4 Snapshot Revert
  Command: opencode revert --snapshot <hash>
  Flow:

1. Download manifest for snapshot
2. Download required chunks
3. Reassemble files
4. Write files to worktree
5. Session revert handled by OpenCode
   Result:

- Files restored to snapshot state
- Conversation truncated to that point

---

7. Implementation Phases
   Phase 1: MVP (Must-Have)
   Chunking & Hashing

- [ ] Fixed-size chunker (256KB)
- [ ] BLAKE3 hashing
- [ ] Chunk deduplication
- [ ] Chunk upload/download
      Manifest Management
- [ ] Manifest schema
- [ ] Manifest builder
- [ ] Manifest storage
- [ ] Current manifest tracking
      Sync Logic
- [ ] Initial sync (baseline)
- [ ] Incremental sync
- [ ] Change detection via OpenCode snapshots
- [ ] Session sync
      Cloud Backend
- [ ] Object storage API
- [ ] Manifest API
- [ ] Session API
- [ ] Workspace API
      CLI Commands
- [ ] opencode sync
- [ ] opencode sync --init
- [ ] opencode workspace pull <id>
- [ ] opencode remote connect <url>
      Phase 2: Enhancements
- [ ] Rolling hash chunks (better dedup)
- [ ] Delta encoding within chunks
- [ ] Compression (gzip/zstd)
- [ ] Resume interrupted uploads
- [ ] Progress bars
- [ ] Dry-run mode
      Phase 3: Advanced Features
- [ ] Encryption at rest (per workspace)
- [ ] Garbage collection
- [ ] Snapshot pruning
- [ ] Conflict resolution
- [ ] Workspace sharing
- [ ] Web UI for session history

---

8. Performance Requirements
   | Metric | Target | Rationale |
   |--------|--------|-----------|
   | Chunk size | 256KB | Balance between dedup and overhead |
   | Hash computation | <100MB/s per core | BLAKE3 is fast |
   | Upload efficiency | >90% dedup for typical changes | Small edits = few new chunks |
   | Restore time | <10s for 100MB workspace | Parallel chunk download |
   | API latency | <500ms | Manifest operations |

---

9. Storage Considerations
   9.1 Growth Model
   Storage = Σ(unique chunks across all snapshots)
   Typical web project (100MB):

- Initial sync: ~400 chunks
- Small edit (1KB file): ~0-1 new chunks (most likely 0 if within existing chunk)
- Medium edit (50KB file): ~0-1 new chunks
- Large edit (500KB file): ~2 new chunks
  Key insight: Storage grows slowly, not linearly with snapshots.
  9.2 Garbage Collection Strategy
- Soft GC: Keep chunks referenced by last 10 manifests
- Hard GC: Keep chunks referenced by any manifest in last 30 days
- User-initiated: Delete old snapshots and their orphaned chunks
  9.3 Cost Estimation
  For 1,000 active users:
- Average workspace: 100MB
- Typical dedup: 70% across workspaces
- Effective storage: ~30GB
- S3 cost (us-east-1): ~$0.70/month

---

10. Security & Privacy
    10.1 Requirements

- [ ] Authentication for workspace access
- [ ] Encrypted transport (TLS 1.3)
- [ ] Workspace isolation (no cross-workspace data leaks)
- [ ] Session data privacy (no PII in manifests)
      10.2 Future: Encryption at Rest
      interface EncryptedChunk {
      hash: string
      iv: Uint8Array
      data: Uint8Array // AES-256-GCM encrypted
      }
      // Per-workspace encryption key
      // Key derived from workspace secret
      // Key rotation supported

---

11. Testing Strategy
    11.1 Unit Tests

- [ ] Chunking logic (edge cases: empty files, 1-chunk files, exact boundary)
- [ ] Hash computation (consistency, collision handling)
- [ ] Manifest building (correct chunk mapping)
- [ ] Change detection (Snapshot.patch integration)
      11.2 Integration Tests
- [ ] Full sync cycle (upload → download → verify)
- [ ] Incremental sync (multiple iterations)
- [ ] Restore scenarios (baseline, incremental, partial)
- [ ] Snapshot revert (file state, session state)
      11.3 Performance Tests
- [ ] Large file handling (100MB+)
- [ ] Many small files (10,000+)
- [ ] Deduplication effectiveness
- [ ] Concurrent syncs
      11.4 E2E Tests
- [ ] Cross-device sync (simulate laptop → desktop)
- [ ] Git integration (with/without remote repo)
- [ ] Session continuity (resume conversation)

---

12. Success Criteria
    Phase 1 Success

- [ ] Can sync workspace to cloud
- [ ] Can restore workspace on another machine
- [ ] Session history preserved
- [ ] Can revert to previous snapshots
- [ ] Bandwidth usage <10% of full-file upload for typical edits
      Overall Success
- [ ] Users report seamless cross-device workflow
- [ ] No data loss incidents in production
- [ ] Storage costs remain predictable
- [ ] API latency meets targets

---

13. Open Questions
1. Git integration: Should we auto-commit to a temporary branch before sync?
   - Decision: No. Work independently of git status.
1. Conflict resolution: What if user changes files locally and on cloud?
   - Decision: Cloud wins on restore, local changes backed up to .opencode-conflict/
1. Session compaction: Should we compress old sessions?
   - Decision: Phase 3 - optional compression for sessions >30 days old.
1. Chunk size tuning: Should chunk size be configurable?
   - Decision: Fixed at 256KB for MVP, tunable in Phase 2.

---

14. Appendix
    14.1 Glossary

- Baseline: First snapshot synced to cloud
- Chunk: Fixed-size portion of a file
- Content-addressed: Object storage where address = hash of content
- Manifest: Mapping from snapshot to files to chunks
- OpenCode snapshot: Git tree hash tracked by OpenCode (implementation detail)
- Sync manifest: Our data structure for cloud sync (transport layer)
  14.2 References
- BLAKE3 Specification (https://github.com/BLAKE3-team/BLAKE3-specs)
- rsync algorithm (https://rsync.samba.org/tech_report/)
- Git object model (https://git-scm.com/book/en/v2/Git-Internals-Git-Objects)
- Content-addressable storage (https://en.wikipedia.org/wiki/Content-addressable_storage)
