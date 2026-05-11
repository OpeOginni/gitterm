#!/bin/sh
set -eu

CONTEXT_DIR="${GITTERM_CONTEXT_DIR:-/workspace/.gitterm}"
AGENT_MD="$CONTEXT_DIR/aws-runtime-context.md"
AWS_TASK_ROLE_NAME="${AWS_TASK_ROLE_NAME:-gitterm-task}"

mkdir -p "$CONTEXT_DIR"

write_static_header() {
    cat > "$AGENT_MD" <<'EOF'
# GitTerm Agent Runtime Context

EOF

    cat >> "$AGENT_MD" <<'EOF'

## AWS Runtime Context

This file is generated when the workspace container starts. It describes the AWS identity and IAM policies visible from inside this container.

Use this file as operational context before creating AWS resources. The IAM policy documents below are the source of truth for what AWS actions are allowed.

If an AWS action is denied, do not keep retrying the same action. Read the relevant policy statement, adjust the resource name/region/role boundary, or ask the user/admin for more access.

## General AWS Guidance

- Lambda creation requires an execution role and usually requires `iam:PassRole`.
- If IAM role creation is allowed, the policy may require a specific role name prefix and a permissions boundary.
- If `iam:PermissionsBoundary` is required, always pass that boundary when creating roles.
- If `iam:PassRole` is restricted to a role ARN pattern, only use roles matching that pattern.
- If you can create IAM roles and can only pass roles matching a specific ARN pattern, create new service roles with names that match the passable pattern. For example, if `iam:PassRole` only allows `arn:aws:iam::<account>:role/gitterm-lambda-gen-*`, create Lambda execution roles named `gitterm-lambda-gen-<app-name>`.
- Do not create a role with one name pattern and then try to pass a different existing role. Create/use the role that satisfies both `iam:CreateRole` and `iam:PassRole` policy statements.
- If `aws:RequestedRegion` is restricted, create resources in that region.
- Do not use existing AWS roles unless the policies below clearly allow reading and passing those roles.
- Do not attempt broad IAM admin actions unless the policies below explicitly allow them.

EOF
}

append_section() {
    title="$1"
    printf '\n## %s\n\n' "$title" >> "$AGENT_MD"
}

append_json_block() {
    printf '```json\n' >> "$AGENT_MD"
    cat >> "$AGENT_MD"
    printf '\n```\n' >> "$AGENT_MD"
}

append_text_block() {
    printf '```text\n' >> "$AGENT_MD"
    cat >> "$AGENT_MD"
    printf '\n```\n' >> "$AGENT_MD"
}

write_static_header

if ! command -v aws >/dev/null 2>&1; then
    append_section "AWS CLI"
    printf 'AWS CLI was not found in this container.\n' >> "$AGENT_MD"
    exit 0
fi

IDENTITY_JSON="$(aws sts get-caller-identity --output json 2>/dev/null || true)"

append_section "AWS Identity"
if [ -n "$IDENTITY_JSON" ]; then
    printf '%s\n' "$IDENTITY_JSON" | append_json_block
else
    printf 'AWS credentials were not available or `sts:GetCallerIdentity` was denied.\n' >> "$AGENT_MD"
    exit 0
fi

ACCOUNT_ID="$(printf '%s' "$IDENTITY_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{console.log(JSON.parse(s).Account||'')}catch{}})" 2>/dev/null || true)"
ARN="$(printf '%s' "$IDENTITY_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{console.log(JSON.parse(s).Arn||'')}catch{}})" 2>/dev/null || true)"
ROLE_NAME="$AWS_TASK_ROLE_NAME"

append_section "Detected Runtime Role"
printf -- '- Account ID: `%s`\n' "$ACCOUNT_ID" >> "$AGENT_MD"
printf -- '- Role name used for IAM policy lookup: `%s`\n' "$ROLE_NAME" >> "$AGENT_MD"
printf -- '- Current identity ARN: `%s`\n' "$ARN" >> "$AGENT_MD"

append_section "Attached Role Policies"
ATTACHED_POLICIES_ERROR="/tmp/gitterm-attached-policies-error.txt"
ATTACHED_POLICIES_JSON="$(aws iam list-attached-role-policies --role-name "$ROLE_NAME" --output json 2>"$ATTACHED_POLICIES_ERROR" || true)"
if [ -n "$ATTACHED_POLICIES_JSON" ]; then
    printf '%s\n' "$ATTACHED_POLICIES_JSON" | append_json_block

    POLICY_ARNS="$(printf '%s' "$ATTACHED_POLICIES_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{for (const p of JSON.parse(s).AttachedPolicies||[]) console.log(p.PolicyArn)}catch{}})" 2>/dev/null || true)"
    for POLICY_ARN in $POLICY_ARNS; do
        append_section "Policy Document: $POLICY_ARN"
        POLICY_META_ERROR="/tmp/gitterm-policy-meta-error.txt"
        POLICY_META="$(aws iam get-policy --policy-arn "$POLICY_ARN" --output json 2>"$POLICY_META_ERROR" || true)"
        VERSION_ID="$(printf '%s' "$POLICY_META" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{console.log(JSON.parse(s).Policy.DefaultVersionId||'')}catch{}})" 2>/dev/null || true)"
        if [ -n "$VERSION_ID" ]; then
            POLICY_VERSION_ERROR="/tmp/gitterm-policy-version-error.txt"
            POLICY_VERSION_JSON="$(aws iam get-policy-version --policy-arn "$POLICY_ARN" --version-id "$VERSION_ID" --output json 2>"$POLICY_VERSION_ERROR" || true)"
            if [ -n "$POLICY_VERSION_JSON" ]; then
                printf '%s\n' "$POLICY_VERSION_JSON" | append_json_block
            else
                printf 'Could not read this policy version. AWS error:\n\n' >> "$AGENT_MD"
                cat "$POLICY_VERSION_ERROR" | append_text_block
            fi
        else
            printf 'Could not determine the default policy version. AWS error, if any:\n\n' >> "$AGENT_MD"
            cat "$POLICY_META_ERROR" | append_text_block
        fi
    done
else
    printf 'Could not list attached role policies. AWS error:\n\n' >> "$AGENT_MD"
    cat "$ATTACHED_POLICIES_ERROR" | append_text_block
fi

append_section "Inline Role Policies"
INLINE_POLICIES_ERROR="/tmp/gitterm-inline-policies-error.txt"
INLINE_POLICIES_JSON="$(aws iam list-role-policies --role-name "$ROLE_NAME" --output json 2>"$INLINE_POLICIES_ERROR" || true)"
if [ -n "$INLINE_POLICIES_JSON" ]; then
    printf '%s\n' "$INLINE_POLICIES_JSON" | append_json_block

    POLICY_NAMES="$(printf '%s' "$INLINE_POLICIES_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{for (const p of JSON.parse(s).PolicyNames||[]) console.log(p)}catch{}})" 2>/dev/null || true)"
    for POLICY_NAME in $POLICY_NAMES; do
        append_section "Inline Policy Document: $POLICY_NAME"
        INLINE_POLICY_ERROR="/tmp/gitterm-inline-policy-error.txt"
        INLINE_POLICY_JSON="$(aws iam get-role-policy --role-name "$ROLE_NAME" --policy-name "$POLICY_NAME" --output json 2>"$INLINE_POLICY_ERROR" || true)"
        if [ -n "$INLINE_POLICY_JSON" ]; then
            printf '%s\n' "$INLINE_POLICY_JSON" | append_json_block
        else
            printf 'Could not read this inline policy. AWS error:\n\n' >> "$AGENT_MD"
            cat "$INLINE_POLICY_ERROR" | append_text_block
        fi
    done
else
    printf 'Could not list inline role policies. AWS error:\n\n' >> "$AGENT_MD"
    cat "$INLINE_POLICIES_ERROR" | append_text_block
fi

append_section "If Introspection Is Incomplete"
cat >> "$AGENT_MD" <<'EOF'
If this file does not include policy documents, IAM self-inspection is probably denied. In that case, AWS `AccessDenied` errors are the next source of truth.

When an error says a resource is not authorized, pay close attention to:

- the exact AWS action
- the exact resource ARN
- the requested region
- any required role name prefix
- any required permissions boundary
- any `iam:PassRole` service condition
EOF
