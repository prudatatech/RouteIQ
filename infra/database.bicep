// One PostgreSQL server per stage (margix-test-pg, margix-pg), on Azure Database for PostgreSQL
// Flexible Server. Deployed by infra/platform.sh. The app's sign-in, API, realtime and storage services
// (infra/platform.bicep) connect to it.
@description('Region')
param location string = 'centralindia'

@description('Server name, e.g. margix-test-pg')
param serverName string

@description('Administrator login')
param adminLogin string = 'margixadmin'

@secure()
@description('Administrator password (from infra/platform.<stage>.env)')
param adminPassword string

@description('Compute size: Standard_B1ms (1 vCPU, 2 GiB) is enough to start; raise it later without data loss')
param skuName string = 'Standard_B1ms'

@description('Storage in GiB (can grow later, never shrink)')
param storageGb int = 32

@description('Days of automatic backups, restorable to any point in time')
param backupDays int = 7

@description('Extra client IP allowed through the firewall (the machine running setup); empty for none')
param setupClientIp string = ''

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: serverName
  location: location
  sku: { name: skuName, tier: 'Burstable' }
  properties: {
    version: '17'
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    storage: { storageSizeGB: storageGb, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: backupDays, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
    authConfig: { activeDirectoryAuth: 'Disabled', passwordAuth: 'Enabled' }
  }
}

// Logical replication for the realtime service, and the extensions the schema uses
resource walLevel 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'wal_level'
  properties: { value: 'logical', source: 'user-override' }
}

resource extensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'azure.extensions'
  properties: { value: 'uuid-ossp,pgcrypto,pg_stat_statements', source: 'user-override' }
  dependsOn: [walLevel]
}

// Container Apps reach the server over Azure's network (no fixed outbound IPs without a VNet).
// Connections still need the password and TLS.
resource allowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: server
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource allowSetup 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = if (!empty(setupClientIp)) {
  parent: server
  name: 'SetupClient'
  properties: { startIpAddress: setupClientIp, endIpAddress: setupClientIp }
}

output host string = server.properties.fullyQualifiedDomainName
