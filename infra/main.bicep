// MargixIndia on Azure. Resource-group scope; deploy.sh creates the group first.
// Nothing here is account-specific: names derive from `prefix`, the ACR suffix from the group id.
targetScope = 'resourceGroup'

@description('Region for everything except the Static Web App.')
param location string = 'centralindia'

@description('Static Web Apps is not offered in every region (not in Central India). Used only for the SWA resource.')
param webLocation string = 'eastasia'

@description('Name prefix: <prefix>-api, <prefix>-ml, <prefix>-redis, <prefix>-web ...')
@minLength(2)
@maxLength(12)
param prefix string = 'margix'

@description('Image for the api app. deploy.sh passes the image currently running so a re-deploy never rolls back.')
param apiImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Image for the ml app. Same rule as apiImage.')
param mlImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Port the placeholder image listens on. Real images listen on the ports below.')
param placeholderPort int = 80

@description('Optional custom web domain (e.g. margixindia.com). Added to CORS and used as WEB_APP_URL.')
param customDomain string = ''

@description('Extra CORS regexes, comma separated (default: the old Vercel preview pattern, for the cutover period).')
param extraCorsPatterns string = '^https://margixindia-[a-z0-9-]+\\.vercel\\.app$'

@description('Extra exact CORS origins, comma separated (e.g. the current Vercel production URL during cutover).')
param extraAllowedOrigins string = ''

@description('Secret values keyed by environment variable name, built from infra/secrets.env by deploy.sh. Blank ones are omitted.')
@secure()
param secretValues object = {}

var apiPort = 8000
var mlPort = 8001
var redisPort = 6379

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
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ---------------------------------------------------------------- registry + identity
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: take('${prefix}acr${uniqueString(resourceGroup().id)}', 50)
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

resource pullIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-pull'
  location: location
}

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
// Needs the deployer to be Owner or User Access Administrator on the resource group.
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, pullIdentity.id, acrPullRoleId)
  scope: acr
  properties: {
    principalId: pullIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

// ---------------------------------------------------------------- web (Static Web App)
resource web 'Microsoft.Web/staticSites@2023-12-01' = {
  name: '${prefix}-web'
  location: webLocation
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {}
}

// ---------------------------------------------------------------- container apps environment
resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

var registries = [
  {
    server: acr.properties.loginServer
    identity: pullIdentity.id
  }
]
var identityBlock = {
  type: 'UserAssigned'
  userAssignedIdentities: {
    '${pullIdentity.id}': {}
  }
}

// ---------------------------------------------------------------- redis (cache only)
// No volume, no persistence: it is a cache, losing it only costs a cold cache.
// NOTE: backend-ts currently talks to Redis through the Upstash REST client (UPSTASH_REDIS_REST_*),
// not through REDIS_URL, so this app is provisioned and wired but not yet used by the code.
resource redis 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-redis'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: false
        transport: 'tcp'
        targetPort: redisPort
        exposedPort: redisPort
      }
    }
    template: {
      containers: [
        {
          name: 'redis'
          image: 'docker.io/library/redis:7-alpine'
          args: [ '--save', '', '--appendonly', 'no' ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

// ---------------------------------------------------------------- ml service
resource ml 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-ml'
  location: location
  identity: identityBlock
  dependsOn: [ acrPull ]
  properties: {
    managedEnvironmentId: env.id
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
var webOrigin = empty(customDomain) ? 'https://${web.properties.defaultHostname}' : 'https://${customDomain}'
var allowedOrigins = join(filter([
  'https://${web.properties.defaultHostname}'
  empty(customDomain) ? '' : 'https://${customDomain}'
  'https://margixindia.com'
  'https://www.margixindia.com'
  extraAllowedOrigins
], o => !empty(o)), ',')
var corsPatterns = join(filter([
  '^https://(www\\.)?margixindia\\.com$'
  extraCorsPatterns
], p => !empty(p)), ',')

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-api'
  location: location
  identity: identityBlock
  dependsOn: [ acrPull ]
  properties: {
    managedEnvironmentId: env.id
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
            { name: 'REDIS_URL', value: 'redis://${redis.name}:${redisPort}/0' }
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
      // Do not raise maxReplicas or add scale rules until that state moves to Redis/Supabase.
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

output resourceGroupName string = resourceGroup().name
output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output apiName string = api.name
output apiFqdn string = api.properties.configuration.ingress.fqdn
output mlName string = ml.name
output mlFqdn string = ml.properties.configuration.ingress.fqdn
output redisName string = redis.name
output webName string = web.name
output webHostname string = web.properties.defaultHostname
