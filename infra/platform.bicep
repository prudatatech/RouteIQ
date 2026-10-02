// The app's data platform for one stage, on Azure Container Apps next to the backend:
//   <p>-gateway  public  https://<p>-gateway.<env domain>: /auth/v1 /rest/v1 /realtime/v1 /storage/v1
//   <p>-auth     sign-in (GoTrue)          <p>-rest      REST API over Postgres (PostgREST)
//   <p>-rt       live updates (Realtime)   <p>-storage   files (Storage API, S3 backend)
//   <p>-s3proxy  internal S3→Azure Blob translator; objects live in a private blob container.
//   (The Storage API's file backend can't run on Azure Files: it stores metadata as filesystem
//   extended attributes, which SMB rejects with EINVAL, so every upload 500s.)
// These are the same open-source services the app was built against, so supabase-js and the backend
// work unchanged with the gateway URL and this stage's keys. Data lives in the stage's Azure PostgreSQL
// server (infra/database.bicep). Deployed by infra/platform.sh; secrets come from infra/platform.<stage>.env.
param location string = 'centralindia'

@description('Container Apps environment name (shared by both stages)')
param envName string = 'margix-env'

@allowed(['live', 'test'])
param stage string = 'live'

param prefix string = 'margix'

@description('Postgres host, e.g. margix-test-pg.postgres.database.azure.com')
param pgHost string

@description('The stage web app URL (sign-in redirects, CORS)')
param siteUrl string

@description('Custom domain of the gateway, e.g. data.margixindia.com; empty uses the Azure address')
param dataDomain string = ''

@secure()
param jwtSecret string
@secure()
param anonKey string
@secure()
param serviceRoleKey string
@secure()
param authenticatorPassword string
@secure()
param authAdminPassword string
@secure()
param storageAdminPassword string
@secure()
param realtimeAdminPassword string
@secure()
param realtimeSecretKeyBase string
@secure()
param s3proxyIdentity string
@secure()
param s3proxyCredential string

@description('Optional SMTP for password reset emails (e.g. smtp.resend.com); empty disables mail')
param smtpHost string = ''
param smtpUser string = ''
@secure()
param smtpPass string = ''
param smtpSender string = ''

var p = stage == 'live' ? prefix : '${prefix}-test'
var gatewayHost = empty(dataDomain) ? '${p}-gateway.${env.properties.defaultDomain}' : dataDomain
var minReplicas = stage == 'live' ? 1 : 0
var blobAccountName = take(toLower(replace('${p}objects${uniqueString(resourceGroup().id, p)}', '-', '')), 24)
var objectsContainer = '${p}-objects'

resource env 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: envName
}

// ── Files: a private blob container holding the storage service's objects ────
// (The old <p>files… Azure Files accounts held nothing — uploads never worked there —
// and can be deleted by hand once this is live.)
resource blobSa 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: blobAccountName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    accessTier: 'Hot'
  }
}

resource objects 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: '${blobSa.name}/default/${objectsContainer}'
  properties: { publicAccess: 'None' }
}

var dbBase = 'postgres://{0}:{1}@${pgHost}:5432/postgres?sslmode=require'

// ── Sign-in ──────────────────────────────────────────────────────────────
resource auth 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${p}-auth'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: { external: false, targetPort: 9999, transport: 'http' }
      secrets: [
        { name: 'db-url', value: format(dbBase, 'supabase_auth_admin', uriComponent(authAdminPassword)) }
        { name: 'jwt-secret', value: jwtSecret }
        { name: 'smtp-pass', value: empty(smtpPass) ? 'unset' : smtpPass }
      ]
    }
    template: {
      containers: [{
        name: 'auth'
        image: 'supabase/gotrue:v2.177.0'
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [
          { name: 'GOTRUE_API_HOST', value: '0.0.0.0' }
          { name: 'GOTRUE_API_PORT', value: '9999' }
          { name: 'API_EXTERNAL_URL', value: 'https://${gatewayHost}/auth/v1' }
          { name: 'GOTRUE_DB_DRIVER', value: 'postgres' }
          { name: 'GOTRUE_DB_DATABASE_URL', secretRef: 'db-url' }
          { name: 'GOTRUE_SITE_URL', value: siteUrl }
          { name: 'GOTRUE_URI_ALLOW_LIST', value: '${siteUrl}/**' }
          { name: 'GOTRUE_DISABLE_SIGNUP', value: 'false' }
          { name: 'GOTRUE_JWT_ADMIN_ROLES', value: 'service_role' }
          { name: 'GOTRUE_JWT_AUD', value: 'authenticated' }
          { name: 'GOTRUE_JWT_DEFAULT_GROUP_NAME', value: 'authenticated' }
          { name: 'GOTRUE_JWT_EXP', value: '3600' }
          // Must equal the backend's SUPABASE_URL + /auth/v1, which it checks on every staff token
          { name: 'GOTRUE_JWT_ISSUER', value: 'https://${gatewayHost}/auth/v1' }
          { name: 'GOTRUE_JWT_SECRET', secretRef: 'jwt-secret' }
          { name: 'GOTRUE_EXTERNAL_EMAIL_ENABLED', value: 'true' }
          { name: 'GOTRUE_EXTERNAL_PHONE_ENABLED', value: 'false' }
          { name: 'GOTRUE_MAILER_AUTOCONFIRM', value: empty(smtpHost) ? 'true' : 'false' }
          { name: 'GOTRUE_SMTP_HOST', value: smtpHost }
          { name: 'GOTRUE_SMTP_PORT', value: '587' }
          { name: 'GOTRUE_SMTP_USER', value: smtpUser }
          { name: 'GOTRUE_SMTP_PASS', secretRef: 'smtp-pass' }
          { name: 'GOTRUE_SMTP_ADMIN_EMAIL', value: smtpSender }
          { name: 'GOTRUE_SMTP_SENDER_NAME', value: 'MargixIndia' }
          { name: 'GOTRUE_MAILER_URLPATHS_RECOVERY', value: '/auth/v1/verify' }
          { name: 'GOTRUE_MAILER_URLPATHS_CONFIRMATION', value: '/auth/v1/verify' }
        ]
      }]
      scale: { minReplicas: minReplicas, maxReplicas: 1 }
    }
  }
}

// ── REST API ──────────────────────────────────────────────────────────────
resource rest 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${p}-rest'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: { external: false, targetPort: 3000, transport: 'http' }
      secrets: [
        { name: 'db-uri', value: format(dbBase, 'authenticator', uriComponent(authenticatorPassword)) }
        { name: 'jwt-secret', value: jwtSecret }
      ]
    }
    template: {
      containers: [{
        name: 'rest'
        image: 'postgrest/postgrest:v12.2.12'
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [
          { name: 'PGRST_DB_URI', secretRef: 'db-uri' }
          { name: 'PGRST_DB_SCHEMAS', value: 'public' }
          { name: 'PGRST_DB_ANON_ROLE', value: 'anon' }
          { name: 'PGRST_JWT_SECRET', secretRef: 'jwt-secret' }
          { name: 'PGRST_DB_USE_LEGACY_GUCS', value: 'false' }
          { name: 'PGRST_APP_SETTINGS_JWT_SECRET', secretRef: 'jwt-secret' }
          { name: 'PGRST_APP_SETTINGS_JWT_EXP', value: '3600' }
          { name: 'PGRST_DB_POOL', value: '10' }
        ]
      }]
      scale: { minReplicas: minReplicas, maxReplicas: 1 }
    }
  }
}

// ── Live updates ─────────────────────────────────────────────────────────
// Realtime picks its tenant from the first label of the Host header; the gateway calls it by its app
// name, so the self-hosted tenant is named after the app.
resource rt 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${p}-rt'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: { external: false, targetPort: 4000, transport: 'http' }
      secrets: [
        { name: 'db-password', value: realtimeAdminPassword }
        { name: 'jwt-secret', value: jwtSecret }
        { name: 'secret-key-base', value: realtimeSecretKeyBase }
        { name: 'db-enc-key', value: take(realtimeSecretKeyBase, 16) }
      ]
    }
    template: {
      containers: [{
        name: 'rt'
        image: 'supabase/realtime:v2.59.1'
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'PORT', value: '4000' }
          { name: 'DB_HOST', value: pgHost }
          { name: 'DB_PORT', value: '5432' }
          { name: 'DB_USER', value: 'supabase_realtime_admin' }
          { name: 'DB_PASSWORD', secretRef: 'db-password' }
          { name: 'DB_NAME', value: 'postgres' }
          { name: 'DB_SSL', value: 'true' }
          { name: 'DB_AFTER_CONNECT_QUERY', value: 'SET search_path TO _realtime' }
          { name: 'DB_ENC_KEY', secretRef: 'db-enc-key' }
          { name: 'API_JWT_SECRET', secretRef: 'jwt-secret' }
          { name: 'SECRET_KEY_BASE', secretRef: 'secret-key-base' }
          { name: 'ERL_AFLAGS', value: '-proto_dist inet_tcp' }
          { name: 'DNS_NODES', value: '\'\'' }
          { name: 'RLIMIT_NOFILE', value: '10000' }
          { name: 'APP_NAME', value: 'realtime' }
          { name: 'SEED_SELF_HOST', value: 'true' }
          { name: 'SELF_HOST_TENANT_NAME', value: '${p}-rt' }
          { name: 'RUN_JANITOR', value: 'true' }
        ]
      }]
      scale: { minReplicas: minReplicas, maxReplicas: 1 }
    }
  }
}

// ── Files: S3→Azure Blob translator ─────────────────────────────────────
// The Storage API speaks S3; s3proxy answers it on the internal network and keeps the
// objects in the blob container above. Reachable only inside the environment.
resource s3proxy 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${p}-s3proxy'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: { external: false, targetPort: 80, transport: 'http' }
      secrets: [
        { name: 's3-identity', value: s3proxyIdentity }
        { name: 's3-credential', value: s3proxyCredential }
        { name: 'blob-key', value: blobSa.listKeys().keys[0].value }
      ]
    }
    template: {
      containers: [{
        name: 's3proxy'
        image: 'andrewgaul/s3proxy:2.7.0'
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [
          { name: 'S3PROXY_ENDPOINT', value: 'http://0.0.0.0:80' }
          { name: 'S3PROXY_AUTHORIZATION', value: 'aws-v2-or-v4' }
          { name: 'S3PROXY_IDENTITY', secretRef: 's3-identity' }
          { name: 'S3PROXY_CREDENTIAL', secretRef: 's3-credential' }
          { name: 'JCLOUDS_PROVIDER', value: 'azureblob' }
          // The image hands an unset JCLOUDS_AZUREBLOB_AUTH to jclouds as an empty string, which crashes start-up
          // ("No enum constant AuthType."): name the auth type (the storage account key) explicitly.
          { name: 'JCLOUDS_AZUREBLOB_AUTH', value: 'azureKey' }
          { name: 'JCLOUDS_AZUREBLOB_ACCOUNT', value: blobSa.name }
          { name: 'JCLOUDS_IDENTITY', value: blobSa.name }
          { name: 'JCLOUDS_CREDENTIAL', secretRef: 'blob-key' }
          { name: 'JCLOUDS_ENDPOINT', value: 'https://${blobSa.name}.blob.${environment().suffixes.storage}' }
        ]
      }]
      scale: { minReplicas: minReplicas, maxReplicas: 1 }
    }
  }
  dependsOn: [objects]
}

// ── Files ──────────────────────────────────────────────────────────────
resource storage 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${p}-storage'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: { external: false, targetPort: 5000, transport: 'http' }
      secrets: [
        { name: 'db-url', value: format(dbBase, 'supabase_storage_admin', uriComponent(storageAdminPassword)) }
        { name: 'jwt-secret', value: jwtSecret }
        { name: 'anon-key', value: anonKey }
        { name: 'service-key', value: serviceRoleKey }
        { name: 's3-identity', value: s3proxyIdentity }
        { name: 's3-credential', value: s3proxyCredential }
      ]
    }
    template: {
      containers: [{
        name: 'storage'
        image: 'supabase/storage-api:v1.25.7'
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [
          { name: 'ANON_KEY', secretRef: 'anon-key' }
          { name: 'SERVICE_KEY', secretRef: 'service-key' }
          { name: 'POSTGREST_URL', value: 'http://${p}-rest' }
          { name: 'PGRST_JWT_SECRET', secretRef: 'jwt-secret' }
          { name: 'AUTH_JWT_SECRET', secretRef: 'jwt-secret' }
          { name: 'DATABASE_URL', secretRef: 'db-url' }
          { name: 'FILE_SIZE_LIMIT', value: '52428800' }
          // A signed upload link lives 60 s by default: too short for a driver's photo on a slow mobile network
          { name: 'UPLOAD_SIGNED_URL_EXPIRATION_TIME', value: '900' }
          { name: 'STORAGE_BACKEND', value: 's3' }
          { name: 'GLOBAL_S3_BUCKET', value: objectsContainer }
          { name: 'GLOBAL_S3_ENDPOINT', value: 'http://${p}-s3proxy' }
          { name: 'GLOBAL_S3_FORCE_PATH_STYLE', value: 'true' }
          { name: 'AWS_ACCESS_KEY_ID', secretRef: 's3-identity' }
          { name: 'AWS_SECRET_ACCESS_KEY', secretRef: 's3-credential' }
          { name: 'TENANT_ID', value: 'stub' }
          { name: 'REGION', value: 'us-east-1' }
          { name: 'ENABLE_IMAGE_TRANSFORMATION', value: 'false' }
          { name: 'DB_INSTALL_ROLES', value: 'false' }
        ]
      }]
      scale: { minReplicas: minReplicas, maxReplicas: 1 }
    }
  }
  dependsOn: [s3proxy]
}

// ── Gateway: one public address, the paths supabase-js expects ──────────────
var kongConfig = {
  _format_version: '2.1'
  _transform: true
  services: [
    { name: 'auth', url: 'http://${p}-auth', routes: [{ name: 'auth', strip_path: true, paths: ['/auth/v1/'] }], plugins: [{ name: 'cors' }] }
    { name: 'rest', url: 'http://${p}-rest/', routes: [{ name: 'rest', strip_path: true, paths: ['/rest/v1/'] }], plugins: [{ name: 'cors' }] }
    { name: 'realtime', url: 'http://${p}-rt/socket', routes: [{ name: 'realtime', strip_path: true, paths: ['/realtime/v1/'] }], plugins: [{ name: 'cors' }] }
    { name: 'realtime-api', url: 'http://${p}-rt/api', routes: [{ name: 'realtime-api', strip_path: true, paths: ['/realtime/v1/api'] }], plugins: [{ name: 'cors' }] }
    { name: 'storage', url: 'http://${p}-storage/', routes: [{ name: 'storage', strip_path: true, paths: ['/storage/v1/'] }], plugins: [{ name: 'cors' }] }
  ]
}

resource gateway 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${p}-gateway'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: { external: true, targetPort: 8000, transport: 'auto', allowInsecure: false }
    }
    template: {
      containers: [{
        name: 'gateway'
        image: 'kong:2.8.1'
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [
          { name: 'KONG_DATABASE', value: 'off' }
          { name: 'KONG_DECLARATIVE_CONFIG_STRING', value: string(kongConfig) }
          { name: 'KONG_DNS_ORDER', value: 'LAST,A,CNAME' }
          { name: 'KONG_PLUGINS', value: 'request-transformer,cors' }
          { name: 'KONG_PROXY_LISTEN', value: '0.0.0.0:8000' }
          { name: 'KONG_NGINX_PROXY_PROXY_BUFFER_SIZE', value: '160k' }
          { name: 'KONG_NGINX_PROXY_PROXY_BUFFERS', value: '64 160k' }
        ]
      }]
      scale: { minReplicas: minReplicas, maxReplicas: 1 }
    }
  }
  dependsOn: [auth, rest, rt, storage]
}

output gatewayUrl string = 'https://${gateway.properties.configuration.ingress.fqdn}'
