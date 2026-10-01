// MargixIndia on Azure. Resource-group scope; deploy.sh creates the group first.
// Two stages share one resource group: `live` (default) owns the shared resources (logs, registry, pull
// identity and its AcrPull role, Container Apps environment). `test` creates only its own apps and web
// app and points at the shared ones by name, so a live deploy never changes because of test.
// Nothing here is account-specific: names derive from `prefix`, the ACR suffix from the group id.
targetScope = 'resourceGroup'

@description('Region for everything except the Static Web App.')
param location string = 'centralindia'

@description('Static Web Apps is not offered in every region (not in Central India). Used only for the SWA resource.')
param webLocation string = 'eastasia'

@description('live owns the shared resources and keeps the plain app names (<prefix>-api ...); test adds <prefix>-test-api, -ml, -web and needs live deployed first.')
@allowed([ 'live', 'test' ])
param stage string = 'live'

@description('Name prefix: <prefix>-api, <prefix>-ml, <prefix>-web ...')
@minLength(2)
@maxLength(12)
param prefix string = 'margix'

@description('Image for the api app. deploy.sh passes the image currently running so a re-deploy never rolls back.')
param apiImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Image for the ml app. Same rule as apiImage.')
param mlImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Port the placeholder image listens on. Real images listen on the ports below.')
param placeholderPort int = 80

@description('Minimum api replicas. Defaults: live 1 (see the hard requirement below), test 0 (scales to zero).')
@minValue(0)
@maxValue(1)
param apiMinReplicas int = stage == 'live' ? 1 : 0

@description('Optional custom web domain (e.g. margixindia.com). Live only: added to CORS and used as WEB_APP_URL.')
param customDomain string = ''

@description('Extra CORS regexes, comma separated (default: the old Vercel preview pattern, for the cutover period).')
param extraCorsPatterns string = '^https://margixindia-[a-z0-9-]+\\.vercel\\.app$'

@description('Extra exact CORS origins, comma separated (e.g. the current Vercel production URL during cutover).')
param extraAllowedOrigins string = ''

@description('Secret values keyed by environment variable name, built from infra/secrets.env by deploy.sh. Blank ones are omitted.')
@secure()
param secretValues object = {}

var isLive = stage == 'live'
// live keeps the plain names; test inserts "test": margix-test-api ...
var appPrefix = isLive ? prefix : '${prefix}-${stage}'

// Names and ids of the shared resources, computed so the test stage can use them without declaring them.
var logsName = '${prefix}-logs'
var acrName = take('${prefix}acr${uniqueString(resourceGroup().id)}', 50)
var pullIdentityName = '${prefix}-pull'
var envName = '${prefix}-env'
// the suffix is documented both with and without a leading dot; replace() makes either form <name>.azurecr.io
var acrLoginServer = replace('${acrName}.${environment().suffixes.acrLoginServer}', '..', '.')
var pullIdentityId = resourceId('Microsoft.ManagedIdentity/userAssignedIdentities', pullIdentityName)
var envId = resourceId('Microsoft.App/managedEnvironments', envName)

var apiPort = 8000
var mlPort = 8001

var isPlaceholderApi = startsWith(apiImage, 'mcr.microsoft.com/k8se/quickstart')
var isPlaceholderMl = startsWith(mlImage, 'mcr.microsoft.com/k8se/quickstart')

// Secrets: one Container App secret per non-blank key, exposed under the same env var name.
// The ml app only ever needs Supabase.
var mlSecretKeys = [
  'SUPABASE_URL'
  'SUPABASE_SERVICE_ROLE_KEY'
]
var setKeys = filter(items(secretValues), e => !empty(e.value))
var apiSecrets = map(setKeys, e => {
  name: toLower(replace(e.key, '_', '-'))
  value: e.value
})
var apiSecretEnv = map(setKeys, e => {
  name: e.key
  secretRef: toLower(replace(e.key, '_', '-'))
})
var mlSetKeys = filter(setKeys, e => contains(mlSecretKeys, e.key))
var mlSecrets = map(mlSetKeys, e => {
  name: toLower(replace(e.key, '_', '-'))
  value: e.value
})
var mlSecretEnv = map(mlSetKeys, e => {
  name: e.key
  secretRef: toLower(replace(e.key, '_', '-'))
})

// ---------------------------------------------------------------- observability
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (isLive) {
  name: logsName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ---------------------------------------------------------------- registry + identity
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = if (isLive) {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

resource pullIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (isLive) {
  name: pullIdentityName
  location: location
}

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
// Needs the deployer to be Owner or User Access Administrator on the resource group.
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (isLive) {
  name: guid(acr.id, pullIdentity.id, acrPullRoleId)
  scope: acr
  properties: {
    principalId: pullIdentity!.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

// ---------------------------------------------------------------- web (Static Web App)
resource web 'Microsoft.Web/staticSites@2023-12-01' = {
  name: '${appPrefix}-web'
  location: webLocation
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {}
}

// ---------------------------------------------------------------- container apps environment
resource env 'Microsoft.App/managedEnvironments@2024-03-01' = if (isLive) {
  name: envName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs!.properties.customerId
        sharedKey: logs!.listKeys().primarySharedKey
      }
    }
  }
}

var registries = [
  {
    server: acrLoginServer
    identity: pullIdentityId
  }
]
var identityBlock = {
  type: 'UserAssigned'
  userAssignedIdentities: {
    '${pullIdentityId}': {}
  }
}

// ---------------------------------------------------------------- ml service
resource ml 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${appPrefix}-ml'
  location: location
  identity: identityBlock
  dependsOn: [ acrPull, env ]   // both exist only in the live stage; test relies on live having been deployed
  properties: {
    managedEnvironmentId: envId
    configuration: {
      registries: registries
      secrets: mlSecrets
      ingress: {
        external: false
        targetPort: isPlaceholderMl ? placeholderPort : mlPort
        transport: 'auto'
      }
    }
    template: {
      containers: [
        {
          name: 'ml'
          image: mlImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat([
            { name: 'PORT', value: string(mlPort) }
          ], mlSecretEnv)
        }
      ]
      // Scales to zero when idle; the first call after idle pays a cold start.
      scale: { minReplicas: 0, maxReplicas: 1 }
    }
  }
}

// ---------------------------------------------------------------- api (backend-ts)
// Each stage allows its own web app. The custom domain and margixindia.com are live only.
var stageDomain = isLive ? customDomain : ''
var webOrigin = empty(stageDomain) ? 'https://${web.properties.defaultHostname}' : 'https://${stageDomain}'
var allowedOrigins = join(filter([
  'https://${web.properties.defaultHostname}'
  empty(stageDomain) ? '' : 'https://${stageDomain}'
  isLive ? 'https://margixindia.com' : ''
  isLive ? 'https://www.margixindia.com' : ''
  extraAllowedOrigins
], o => !empty(o)), ',')
var corsPatterns = join(filter([
  isLive ? '^https://(www\\.)?margixindia\\.com$' : ''
  extraCorsPatterns
], p => !empty(p)), ',')

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${appPrefix}-api'
  location: location
  identity: identityBlock
  dependsOn: [ acrPull, env ]
  properties: {
    managedEnvironmentId: envId
    configuration: {
      registries: registries
      secrets: apiSecrets
      ingress: {
        external: true
        targetPort: isPlaceholderApi ? placeholderPort : apiPort
        transport: 'auto' // HTTP/1.1 upgrade (WebSockets) passes through the ingress by default.
        allowInsecure: false
      }
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat([
            { name: 'PORT', value: string(apiPort) }
            { name: 'NODE_ENV', value: 'production' }
            { name: 'APP_ENV', value: 'production' }
            { name: 'ML_SERVICE_URL', value: 'https://${ml.properties.configuration.ingress.fqdn}' }
            { name: 'WEB_APP_URL', value: webOrigin }
            { name: 'ALLOWED_ORIGINS', value: allowedOrigins }
            { name: 'CORS_ORIGIN_PATTERNS', value: corsPatterns }
            { name: 'TRAFFIC_REFRESH_MINUTES', value: '10' }
            { name: 'TRAFFIC_MIN_DELAY_MINUTES', value: '5' }
            { name: 'ODOMETER_SYNC_INTERVAL_MINUTES', value: '30' }
          ], apiSecretEnv)
          probes: isPlaceholderApi ? [] : [
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: apiPort }
              initialDelaySeconds: 10
              periodSeconds: 20
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health', port: apiPort }
              initialDelaySeconds: 5
              periodSeconds: 10
              failureThreshold: 3
            }
          ]
        }
      ]
      // HARD REQUIREMENT: exactly one replica. The scheduler (odometer sync, traffic checks),
      // the rate limiters and the customer OTP store all live in this process's memory.
      // A second replica would run every job twice, split rate-limit counters (silently
      // doubling the limits) and reject OTPs that were issued by the other replica.
      // Do not raise maxReplicas or add scale rules until that state moves to a shared store (Upstash Redis or Supabase).
      // Live: min 1. Test defaults to min 0 (sleeps when idle; max stays 1 for the same reason).
      scale: { minReplicas: apiMinReplicas, maxReplicas: 1 }
    }
  }
}

output resourceGroupName string = resourceGroup().name
output stage string = stage
output acrName string = acrName
output acrLoginServer string = acrLoginServer
output apiName string = api.name
output apiFqdn string = api.properties.configuration.ingress.fqdn
output mlName string = ml.name
output mlFqdn string = ml.properties.configuration.ingress.fqdn
output webName string = web.name
output webHostname string = web.properties.defaultHostname
