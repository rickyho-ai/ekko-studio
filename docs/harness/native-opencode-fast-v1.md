# Native OpenCode Fast V1

Normal OpenCode chat now uses `@opencode/client@2.0.20` over the existing native
background service. `Service.discover({ version: '2.0.20' })` discovers and
authenticates without starting/restarting a process. `EKKO_OPENCODE_SERVICE_FILE`
optionally selects an existing registration file; otherwise native XDG discovery
applies. There is no hardcoded service port and no unauthenticated fallback.

Studio persists only its existing session row's `agent_native_session_id`,
`agent_session_id`, workspace cache, and explicit `modelRoute`. Native OpenCode
owns session history and location. Read/resume project the latest bounded native
assistant result (32 KiB) and diff metadata (20 files); no native messages are
inserted in Studio's messages table. Continuation never creates a session.

The normal chat dispatcher bypasses scoped config, proxy/token preparation and
the print-process runner. `startCodingAgentRun('opencode', ...)` explicitly rejects
the retired per-conversation launcher. The old launch preparation helpers remain
for unrelated terminal/configuration functionality; they are not a fallback for
the native chat path. Existing isolated sessions are not migrated or replaced.

## Native Magpie configuration — approval required

Nothing in this change applies configuration to the live service. Generate a
reviewable **fragment**, not a replacement for existing native configuration:

```bash
cd /home/nxai/Projects/rickyho-ai/ekko-studio
node scripts/native-opencode-magpie-config.mjs > /tmp/opencode/native-magpie-fragment.json
```

It derives exact model IDs from Magpie `/v1/models`, defines native Responses and
Messages providers for the two caller identities, and loads the local native
plugin `integrations/opencode-magpie`. No default model, per-session credential,
proxy URL, or isolated DB is generated. The plugin adds the **native session ID**
as `X-Magpie-Session` on all native model requests. Caller identity and protocol
remain separate; Magpie still owns accounts and model execution.

An operator must approve and merge the fragment's providers/plugins into the
native service's existing config, preserving all unrelated settings, and activate
that config separately. Do not overwrite the config or restart a service as part
of this task. The adapter rejects unavailable/aliased models, a missing active
plugin, or an incorrect endpoint/package before prompt admission.

## Remaining runtime acceptance (A–E)

These commands are **not run by the coding agent**. They create/send prompts to
the shared native service, and require approval and a candidate Ekko instance
running this commit. Do not target formal `ekko-shadow.service`. Closing/reopening
the browser is sufficient for C; no formal service restart is required.

Set these once in the same Terminal. Choose an exact ID from Magpie's catalog:

```bash
cd /home/nxai/Projects/rickyho-ai/ekko-studio
export EKKO_URL='http://127.0.0.1:YOUR_APPROVED_CANDIDATE_PORT'
export EKKO_TOKEN='YOUR_EXISTING_CANDIDATE_API_TOKEN'
export WORKSPACE='/home/nxai/Projects/rickyho-ai/ekko-studio'
export MODEL_ID='codex/gpt-5.5'
export EKKO_SESSION="native-fast-v1-$(date +%s)"
mkdir -p /tmp/opencode
git -C "$WORKSPACE" rev-parse HEAD > /tmp/opencode/native-fast-v1-head
git -C "$WORKSPACE" status --porcelain > /tmp/opencode/native-fast-v1-git-before
```

### A. Ekko creates native session A and sends the initial prompt

```bash
curl --fail-with-body --max-time 180 -sS "$EKKO_URL/api/studio/chat-run/runs" \
  -H "Authorization: Bearer $EKKO_TOKEN" -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg sid "$EKKO_SESSION" --arg dir "$WORKSPACE" --arg model "$MODEL_ID" \
    '{session_id:$sid,profile:"default",source:"coding_agent",coding_agent_id:"opencode",workspace:$dir,
      modelRoute:{agentId:"opencode",routeId:"codex",modelId:$model},timeout_ms:170000,include_events:true,
      input:"Do not change any files or run shell commands. Reply exactly NATIVE_FAST_V1_A."}')" \
  | tee /tmp/opencode/native-fast-v1-A.json
jq -e '.ok == true and .output == "NATIVE_FAST_V1_A"' /tmp/opencode/native-fast-v1-A.json
curl --fail-with-body -sS "$EKKO_URL/api/studio/sessions/$EKKO_SESSION/native-opencode" \
  -H "Authorization: Bearer $EKKO_TOKEN" > /tmp/opencode/native-fast-v1-state-A.json
export OC_A="$(jq -er '.opencodeSessionId' /tmp/opencode/native-fast-v1-state-A.json)"
printf '%s\n' "$OC_A"
```

### B. Continue uses the same session A

```bash
curl --fail-with-body -sS "$EKKO_URL/api/studio/sessions/$EKKO_SESSION/native-opencode/continue" \
  -H "Authorization: Bearer $EKKO_TOKEN" -H 'Content-Type: application/json' \
  --data '{"input":"Do not change any files or run shell commands. Reply exactly NATIVE_FAST_V1_B."}' \
  | jq -e --arg id "$OC_A" '.opencodeSessionId == $id and .admissionId != null'
```

This endpoint returns durable admission, not a false claim of execution success.

### C. Close/reopen Ekko, then continue session A

Close and reopen the candidate browser UI, then run this in the same Terminal:

```bash
curl --fail-with-body -sS "$EKKO_URL/api/studio/sessions/$EKKO_SESSION/native-opencode/continue" \
  -H "Authorization: Bearer $EKKO_TOKEN" -H 'Content-Type: application/json' \
  --data '{"input":"Do not change any files or run shell commands. Reply exactly NATIVE_FAST_V1_C."}' \
  | jq -e --arg id "$OC_A" '.opencodeSessionId == $id and .admissionId != null'
```

For a candidate backend process reopen, reuse its existing Studio state directory;
do not restart or change the formal service. The focused SQLite reload test also
verifies this boundary without relying on process-local session caches.

### D. Confirm authoritative native workspace and unchanged Git state

```bash
OC_A="$OC_A" WORKSPACE="$WORKSPACE" node --input-type=module - <<'JS'
import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import { Service } from '@opencode/client/service'
import { OpenCode } from '@opencode/client'
const endpoint = await Service.discover({ version: '2.0.20' })
assert(endpoint, 'Existing service required; no process will be started')
const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
await client.session.wait({ sessionID: process.env.OC_A }, { signal: AbortSignal.timeout(120000) })
const native = await client.session.get({ sessionID: process.env.OC_A })
assert.equal(native.id, process.env.OC_A)
assert.equal(native.location.directory, await realpath(process.env.WORKSPACE))
console.log({ id: native.id, workspace: native.location.directory, model: native.model, outcome: native.outcome })
JS
test "$(git -C "$WORKSPACE" rev-parse HEAD)" = "$(cat /tmp/opencode/native-fast-v1-head)"
git -C "$WORKSPACE" status --porcelain > /tmp/opencode/native-fast-v1-git-after
diff -u /tmp/opencode/native-fast-v1-git-before /tmp/opencode/native-fast-v1-git-after
```

### E. Confirm the Magpie-backed call succeeded

After D has waited for native execution:

```bash
curl --fail-with-body -sS "$EKKO_URL/api/studio/sessions/$EKKO_SESSION/native-opencode" \
  -H "Authorization: Bearer $EKKO_TOKEN" \
  | jq -e --arg id "$OC_A" --arg model "$MODEL_ID" \
    '.opencodeSessionId == $id and .isWorking == false and .outcome == "succeeded"
      and .model.providerID == "magpie-opencode-codex" and .model.id == $model
      and .output == "NATIVE_FAST_V1_C"'
```

## Fast V1 limitations

Text prompts only. Native permissions/tools are handled in native OpenCode, not
mirrored into Studio. Normal chat observers wait up to two minutes; a timeout
does not cancel native work or create a replacement. Read/reopen reattaches by the
persisted ID. Native config activation and live Magpie execution remain pending
operator approval. Group/workflow legacy launch calls fail explicitly rather than
silently returning to the retired spawn architecture.
