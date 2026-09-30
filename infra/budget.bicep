// Subscription-scope budget. Notification thresholds are percentages of `amount`:
// with the default 200 they fire at 50 / 100 / 150 (in the billing currency).
targetScope = 'subscription'

param prefix string = 'margix'
param contactEmail string
param amount int = 200
@description('First day of a month. Defaults to the current month.')
param startDate string = utcNow('yyyy-MM-01')

resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: '${prefix}-budget'
  properties: {
    category: 'Cost'
    amount: amount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
      endDate: dateTimeAdd(startDate, 'P5Y')
    }
    notifications: {
      actual25: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 25
        thresholdType: 'Actual'
        contactEmails: [ contactEmail ]
      }
      actual50: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 50
        thresholdType: 'Actual'
        contactEmails: [ contactEmail ]
      }
      actual75: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 75
        thresholdType: 'Actual'
        contactEmails: [ contactEmail ]
      }
    }
  }
}
