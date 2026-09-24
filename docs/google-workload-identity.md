# Google Cloud Workload Identity Federation

GitTerm can authenticate `gcloud` and Google client libraries without storing a service-account
JSON key. A running workspace receives a five-minute GitTerm OIDC assertion, exchanges it through
Google Security Token Service, and impersonates one explicitly configured service account.

## 1. Configure the GitTerm issuer

In **Admin → Integrations**, enable Google Cloud and enter your public API issuer URL, ending in
`/api/workload-identity`. Generate the deployment-wide RS256 key there. GitTerm stores it
envelope-encrypted in the database using the deployment encryption master key; only admins can
rotate it. Never put the private key in the repository or a user's workspace.

Existing deployments with `WORKLOAD_IDENTITY_*` env settings keep working until an admin saves
the issuer in the app. To migrate, use the same issuer URL already trusted by Google. The old
public key remains in JWKS for 15 minutes after rotation so short-lived assertions can expire.

Legacy environment setup (only for existing deployments):

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out workload-identity.pem
```

Configure the server:

```text
WORKLOAD_IDENTITY_ISSUER=https://api.gitterm.dev/api/workload-identity
WORKLOAD_IDENTITY_PRIVATE_KEY=<PEM contents; escaped newlines are accepted>
WORKLOAD_IDENTITY_KEY_ID=gitterm-workload-identity-v1
```

The issuer publishes discovery and JWKS documents at:

```text
<issuer>/.well-known/openid-configuration
<issuer>/jwks
```

## 2. Create a Google workload identity provider

Use a dedicated pool/provider for GitTerm. The allowed audience must be the provider's full resource
name and the integration attribute mapping is required.

```sh
PROJECT_NUMBER=123456789
POOL_ID=gitterm
PROVIDER_ID=gitterm
ISSUER=https://api.gitterm.dev/api/workload-identity
PROVIDER_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"

gcloud iam workload-identity-pools create "$POOL_ID" \
  --location=global \
  --project="$PROJECT_NUMBER" \
  --display-name="GitTerm workspaces"

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --location=global \
  --project="$PROJECT_NUMBER" \
  --workload-identity-pool="$POOL_ID" \
  --issuer-uri="$ISSUER" \
  --allowed-audiences="//iam.googleapis.com/${PROVIDER_RESOURCE}" \
  --attribute-mapping="google.subject=assertion.sub,attribute.integration_id=assertion.integration_id"
```

## 3. Create a service account for workspaces

Workspaces act as a Google service account. Create a dedicated one and grant it only the roles the
agent needs; these roles are the full extent of what a workspace can do in Google Cloud.

```sh
PROJECT_ID=my-project-123456

gcloud iam service-accounts create gitterm-agent \
  --project="$PROJECT_ID" \
  --display-name="GitTerm workspace agent"

# Example: read-only access to Cloud Storage. Repeat for each role the agent needs.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:gitterm-agent@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/storage.objectViewer"
```

The account's email is `gitterm-agent@<PROJECT_ID>.iam.gserviceaccount.com`. No key file is
created or downloaded.

## 4. Save the integration and authorize it

In **Dashboard → Integrations → Google Cloud → Add identity**, enter a display name, the project
ID, the project number, and the service-account email from step 3. The form assembles the
provider resource name (pool and provider IDs default to `gitterm`; expand *Use an existing pool or
provider* to change them) and shows the exact step 2 commands with this deployment's issuer filled
in, so you can run step 2 straight from the form.

After saving, the identity card shows the final command. It grants only this GitTerm identity
permission to impersonate the service account:

```sh
gcloud iam service-accounts add-iam-policy-binding SERVICE_ACCOUNT_EMAIL \
  --project=PROJECT_ID \
  --role=roles/iam.workloadIdentityUser \
  --member='PRINCIPAL_SET_COPIED_FROM_GITTERM'
```

Select the integration when creating a workspace, or pass `googleCloudIntegrationId` through the
SDK. GitTerm writes a non-key external-account ADC configuration to
`/run/gitterm/google/application-default-credentials.json` and sets the standard Google/gcloud
environment variables.

## Security notes

- The service account's IAM roles remain the real authorization boundary. Use a dedicated dev-only
  account with the smallest resource-level grants possible.
- Assertions are issued only while the workspace and integration are active and expire after five
  minutes.
- Removing the integration immediately prevents new assertions. Existing Google access tokens keep
  their normal short lifetime.
- Rotate the GitTerm signing key as a controlled deployment after existing five-minute assertions
  have expired.
