import { useState, useEffect, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Activity, AlertTriangle, CheckCircle2, Copy, Check, ExternalLink,
  Flame, ShieldAlert, Sparkles, XCircle, Zap,
  Clock, HelpCircle, ChevronDown, ChevronUp
} from 'lucide-react'
import {
  Button, Card, CardBody, CardHeader, Checkbox, ErrorState,
  Input, Page, PageHeader, Skeleton, Textarea
} from '@/components/ui'
import { wheelseyeAPI, type WheelseyeConfig, type WheelseyeTestResult } from '@/services/api'
import { errorMessage, formatRupees } from '@/utils/display'

export default function RateApiPage() {
  const queryClient = useQueryClient()
  const configQuery = useQuery({
    queryKey: ['wheelseye-config'],
    queryFn: () => wheelseyeAPI.getConfig(),
    staleTime: 10_000,
  })

  // Form state
  const [enabled, setEnabled] = useState(true)
  const [token, setToken] = useState('')
  const [userCode, setUserCode] = useState('WE9228053')
  const [sessionId, setSessionId] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [pricingUrl, setPricingUrl] = useState('https://consigner.wheelseye.com/consigner/v5/demand/vehicle-list')
  const [userAgent, setUserAgent] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  // Smart paste raw input
  const [rawHeaders, setRawHeaders] = useState('')
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<WheelseyeTestResult | null>(null)

  // Initialize form when query loads
  useEffect(() => {
    if (configQuery.data) {
      const d = configQuery.data
      setEnabled(d.enabled ?? true)
      setToken(d.token ?? '')
      setUserCode(d.user_code ?? 'WE9228053')
      setSessionId(d.session_id ?? '')
      setDeviceId(d.device_id ?? '')
      setPricingUrl(d.pricing_url || 'https://consigner.wheelseye.com/consigner/v5/demand/vehicle-list')
      setUserAgent(d.user_agent || '')
      if (d.last_test_result && d.last_test_status) {
        setTestResult({
          success: d.last_test_status === 'ok',
          status: d.last_test_status === 'ok' ? 200 : d.last_test_status === 'rate_limited' ? 429 : 401,
          latencyMs: d.last_test_latency_ms || 0,
          message: d.last_test_message || '',
          vehiclesCount: d.last_test_result.vehicles_count,
          sampleRates: d.last_test_result.sample_rates,
        })
      }
    }
  }, [configQuery.data])

  // Save Mutation
  const saveMutation = useMutation({
    mutationFn: (updates: Partial<WheelseyeConfig>) => wheelseyeAPI.saveConfig(updates),
    onSuccess: (saved) => {
      toast.success('Rate API configuration saved and active immediately')
      queryClient.setQueryData(['wheelseye-config'], saved)
    },
    onError: (err) => {
      toast.error(errorMessage(err, 'Could not save Rate API configuration'))
    },
  })

  // Test Mutation
  const testMutation = useMutation({
    mutationFn: (overrides?: Partial<WheelseyeConfig>) => wheelseyeAPI.testConnection(overrides),
    onSuccess: (res) => {
      setTestResult(res)
      if (res.success) {
        toast.success(`Connected! ${res.vehiclesCount || 0} truck categories verified live`)
      } else if (res.status === 429) {
        toast.error('WheelsEye rate limit (429) hit. Paste a fresh token.')
      } else if (res.status === 401 || res.status === 403) {
        toast.error('WheelsEye token expired (401). Paste new session credentials.')
      } else {
        toast.error(`Connection failed (${res.status}): ${res.message}`)
      }
      queryClient.invalidateQueries({ queryKey: ['wheelseye-config'] })
    },
    onError: (err) => {
      toast.error(errorMessage(err, 'Live connection test failed'))
    },
  })

  // Local parser for rapid Smart Paste extraction
  const handleParseRaw = () => {
    if (!rawHeaders.trim()) {
      toast.error('Paste raw DevTools request headers or cURL command first')
      return
    }

    const lines = rawHeaders.split(/\r?\n/)
    let extractedCount = 0
    let parsedToken = ''
    let parsedUserCode = ''
    let parsedSession = ''
    let parsedDevice = ''
    let parsedUa = ''
    let parsedUrl = ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      const urlMatch = trimmed.match(/curl\s+['"]?(https:\/\/[^\s'"]+)/i)
      if (urlMatch && urlMatch[1].includes('wheelseye')) {
        parsedUrl = urlMatch[1]
      }

      const cleanLine = trimmed
        .replace(/^-(?:H|-header)\s+['"]?/, '')
        .replace(/['"]?\s*\\?$/, '')

      const colonIdx = cleanLine.indexOf(':')
      const eqIdx = cleanLine.indexOf('=')
      let key = ''
      let val = ''

      if (colonIdx > 0 && (eqIdx === -1 || colonIdx < eqIdx)) {
        key = cleanLine.slice(0, colonIdx).trim().toLowerCase()
        val = cleanLine.slice(colonIdx + 1).trim()
      } else if (eqIdx > 0) {
        key = cleanLine.slice(0, eqIdx).trim().toLowerCase()
        val = cleanLine.slice(eqIdx + 1).trim()
      }

      key = key.replace(/^:+/, '').replace(/^['"]+|['"]+$/g, '')
      val = val.replace(/^['"]+|['"]+$/g, '')

      if (key === 'token') {
        parsedToken = val
        extractedCount++
      } else if (key === 'user_code' || key === 'usercode') {
        parsedUserCode = val
        extractedCount++
      } else if (key === 'session-id' || key === 'session_id' || key === 'sessionid') {
        parsedSession = val
        extractedCount++
      } else if (key === 'device-id' || key === 'device_id' || key === 'deviceid' || key === 'x-device-id') {
        parsedDevice = val
        extractedCount++
      } else if (key === 'user-agent' || key === 'useragent') {
        parsedUa = val
        extractedCount++
      }
    }

    // Fallback regex search for UUIDs
    if (!parsedToken) {
      const tokenMatch = rawHeaders.match(/token['":=\s]+([a-f0-9-]{36})/i)
      if (tokenMatch) {
        parsedToken = tokenMatch[1]
        extractedCount++
      }
    }
    if (!parsedUserCode) {
      const ucMatch = rawHeaders.match(/user_code['":=\s]+(WE\d+)/i)
      if (ucMatch) {
        parsedUserCode = ucMatch[1]
        extractedCount++
      }
    }
    if (!parsedSession) {
      const sMatch = rawHeaders.match(/session-?id['":=\s]+([a-f0-9-]{36})/i)
      if (sMatch) {
        parsedSession = sMatch[1]
        extractedCount++
      }
    }
    if (!parsedDevice) {
      const dMatch = rawHeaders.match(/device-?id['":=\s]+([a-f0-9-]{36})/i)
      if (dMatch) {
        parsedDevice = dMatch[1]
        extractedCount++
      }
    }

    if (parsedToken) setToken(parsedToken)
    if (parsedUserCode) setUserCode(parsedUserCode)
    if (parsedSession) setSessionId(parsedSession)
    if (parsedDevice) setDeviceId(parsedDevice)
    if (parsedUa) setUserAgent(parsedUa)
    if (parsedUrl) setPricingUrl(parsedUrl)

    if (extractedCount > 0) {
      toast.success(`Successfully extracted ${extractedCount} credentials! Form updated below.`)
    } else {
      toast.error('Could not detect WheelsEye headers in the pasted text. Check the guide below.')
    }
  }

  // Handle Save
  const handleSave = (e?: FormEvent) => {
    if (e) e.preventDefault()
    if (!token.trim()) {
      toast.error('WheelsEye token cannot be empty')
      return
    }

    saveMutation.mutate({
      enabled,
      token: token.trim(),
      user_code: userCode.trim() || 'WE9228053',
      session_id: sessionId.trim(),
      device_id: deviceId.trim(),
      pricing_url: pricingUrl.trim() || 'https://consigner.wheelseye.com/consigner/v5/demand/vehicle-list',
      user_agent: userAgent.trim(),
    })
  }

  // Handle Test with currently typed form fields
  const handleTestNow = () => {
    testMutation.mutate({
      enabled,
      token: token.trim(),
      user_code: userCode.trim() || 'WE9228053',
      session_id: sessionId.trim(),
      device_id: deviceId.trim(),
      pricing_url: pricingUrl.trim(),
      user_agent: userAgent.trim(),
    })
  }

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    toast.success(`Copied ${field} to clipboard`)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const currentStatus = configQuery.data?.last_test_status || (testResult ? (testResult.success ? 'ok' : testResult.status === 429 ? 'rate_limited' : 'unauthorized') : 'unknown')

  return (
    <Page>
      <PageHeader
        title="Rate API"
        description="Monitor live Freight Rate API tokens (WheelsEye Demand Engine). Update expiring session tokens or quota-limited credentials instantly without server redeployment."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              icon={<Zap size={16} className={testMutation.isPending ? 'animate-spin' : 'text-brand'} />}
              loading={testMutation.isPending}
              onClick={handleTestNow}
            >
              Test Connection
            </Button>
            <Button
              variant="primary"
              loading={saveMutation.isPending}
              onClick={handleSave}
            >
              Save Configuration
            </Button>
          </div>
        }
      />

      {/* ── Real-Time Status Diagnostic Banner ── */}
      <div className="grid gap-4 sm:grid-cols-3">
        {/* Status Card */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase text-muted">API Health Status</span>
            {currentStatus === 'ok' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                Operational (200 OK)
              </span>
            )}
            {currentStatus === 'rate_limited' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
                <AlertTriangle size={12} />
                Rate Limited (429)
              </span>
            )}
            {(currentStatus === 'unauthorized' || currentStatus === 'error') && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/15 px-2.5 py-0.5 text-xs font-semibold text-danger">
                <XCircle size={12} />
                Token Expired ({currentStatus === 'unauthorized' ? '401' : 'Error'})
              </span>
            )}
            {currentStatus === 'unknown' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-subtle px-2.5 py-0.5 text-xs font-semibold text-muted">
                Untested
              </span>
            )}
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-text">
              {currentStatus === 'ok' ? 'Connected & Live' : currentStatus === 'rate_limited' ? 'Quota Exceeded' : currentStatus === 'unauthorized' ? 'Needs Refresh' : 'Ready'}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {configQuery.data?.last_test_message || 'Tests verify real WheelsEye market rates'}
          </p>
        </Card>

        {/* Latency Card */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase text-muted">API Response Latency</span>
            <Activity size={16} className="text-muted" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-text">
              {configQuery.data?.last_test_latency_ms ? `${configQuery.data.last_test_latency_ms} ms` : '—'}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {configQuery.data?.last_tested_at ? `Last checked ${new Date(configQuery.data.last_tested_at).toLocaleTimeString()}` : 'Click Test Connection to measure'}
          </p>
        </Card>

        {/* Engine Integration Card */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase text-muted">Live Demand Engine</span>
            <Flame size={16} className="text-brand" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-text">
              {enabled ? 'Active on Loads' : 'Disabled'}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            Provides benchmark truck options on Load Post & Ship Page
          </p>
        </Card>
      </div>

      {/* ── Status Warning Notice (if Rate limited or Expired) ── */}
      {currentStatus === 'rate_limited' && (
        <div className="rounded-card border border-warning/40 bg-warning/10 p-4 sm:p-5 text-text">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-warning" size={20} />
            <div className="space-y-1">
              <h3 className="font-semibold text-warning">WheelsEye Rate Limit Reached (HTTP 429)</h3>
              <p className="text-sm text-text">
                The current WheelsEye token has exhausted its request quota. To resume live rate benchmarks immediately,
                copy fresh headers from browser DevTools on <code className="rounded bg-surface px-1.5 py-0.5 text-xs font-mono">wheelseye.com</code>, paste them into the Smart Paste box below, and click <strong>Save Configuration</strong>. No server restart is required.
              </p>
            </div>
          </div>
        </div>
      )}

      {currentStatus === 'unauthorized' && (
        <div className="rounded-card border border-danger/40 bg-danger/10 p-4 sm:p-5 text-text">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 shrink-0 text-danger" size={20} />
            <div className="space-y-1">
              <h3 className="font-semibold text-danger">WheelsEye Session Token Expired (HTTP 401)</h3>
              <p className="text-sm text-text">
                The current session token is no longer authorized. Please log in to WheelsEye, copy the latest <code className="rounded bg-surface px-1.5 py-0.5 text-xs font-mono">token</code>, and paste it below to restore live recommendations.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Smart Paste & Fast Token Parser (WOW Feature) ── */}
      <Card>
        <CardHeader
          title={
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-brand" />
              <span>Smart Header / cURL Parser</span>
            </div>
          }
          description="Copy the raw Request Headers or cURL from Chrome DevTools (Network tab → vehicle-list or autocomplete), paste below, and click Extract."
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<HelpCircle size={14} />}
              onClick={() => setShowGuide(!showGuide)}
            >
              {showGuide ? 'Hide 30s Guide' : '30-Second Guide'}
            </Button>
          }
        />
        <CardBody className="space-y-4">
          {showGuide && (
            <div className="rounded-card border border-border bg-surface-subtle p-4 text-sm text-text space-y-2">
              <p className="font-semibold text-text flex items-center gap-1.5">
                <Clock size={16} className="text-brand" /> Quick Instructions to Refresh Token:
              </p>
              <ol className="list-decimal list-inside space-y-1 text-muted ml-1">
                <li>Open <a href="https://wheelseye.com" target="_blank" rel="noreferrer" className="text-brand hover:underline inline-flex items-center gap-0.5">wheelseye.com <ExternalLink size={12} /></a> in your browser.</li>
                <li>Press <kbd className="rounded border border-border px-1 py-0.5 text-xs font-mono bg-surface">F12</kbd> (or Ctrl+Shift+I) and select the <strong>Network</strong> tab.</li>
                <li>Search any truck lane or reload the consigner page.</li>
                <li>In Network search, filter by <code className="text-xs bg-surface px-1 py-0.5 rounded border border-border">vehicle-list</code> or <code className="text-xs bg-surface px-1 py-0.5 rounded border border-border">autocomplete</code>.</li>
                <li>Right-click the request → <strong>Copy</strong> → <strong>Copy Request Headers</strong>.</li>
                <li>Paste into the box below and click <strong>Extract & Populate Form</strong>!</li>
              </ol>
            </div>
          )}

          <div className="space-y-2">
            <Textarea
              label="Paste Raw DevTools Headers or cURL"
              rows={4}
              placeholder="Paste raw headers here... (e.g. token: ae4f3562-... or curl 'https://...')"
              value={rawHeaders}
              onChange={(e) => setRawHeaders(e.target.value)}
              className="font-mono text-xs"
            />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                variant="secondary"
                size="sm"
                icon={<Sparkles size={14} className="text-brand" />}
                onClick={handleParseRaw}
              >
                Extract & Populate Form
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!rawHeaders}
                onClick={() => setRawHeaders('')}
              >
                Clear Paste Box
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── Active Credentials Form ── */}
      <Card>
        <CardHeader
          title="WheelsEye API Credentials"
          description="Credentials are saved to the platform system_settings and loaded with zero-downtime cache invalidation."
        />
        <CardBody>
          {configQuery.isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : configQuery.isError ? (
            <ErrorState
              title="Failed to load Rate API configuration"
              description="Check network connectivity or backend server logs."
              onRetry={() => configQuery.refetch()}
            />
          ) : (
            <form onSubmit={handleSave} className="space-y-5">
              <div className="rounded-card border border-border bg-surface-subtle p-3.5">
                <Checkbox
                  label="Enable WheelsEye Market Benchmark"
                  description="When enabled, live WheelsEye market rates and recommended truck models appear on Load Post and Ship pages."
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Input
                    label="Active Session Token"
                    placeholder="e.g. ae4f3562-8c95-4057-9839-57176177e49b"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                    trailing={
                      token && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(token, 'Token')}
                          className="text-muted hover:text-text"
                          title="Copy Token"
                        >
                          {copiedField === 'Token' ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                        </button>
                      )
                    }
                    hint="The core session token passed in the 'token' header."
                  />
                </div>

                <div>
                  <Input
                    label="User Code"
                    placeholder="e.g. WE9228053"
                    value={userCode}
                    onChange={(e) => setUserCode(e.target.value)}
                    hint="Consigner account user code (user_code header)."
                  />
                </div>

                <div>
                  <Input
                    label="Session ID"
                    placeholder="e.g. cb3c5bae-f4bb-4b15-80b4-f5fc5f95aa81"
                    value={sessionId}
                    onChange={(e) => setSessionId(e.target.value)}
                    hint="Browser session ID (session-id header)."
                  />
                </div>

                <div className="sm:col-span-2">
                  <Input
                    label="Device ID"
                    placeholder="e.g. 33fa2d55-6154-48f3-83a0-24e122254332"
                    value={deviceId}
                    onChange={(e) => setDeviceId(e.target.value)}
                    hint="Virtual device identifier (device-id and x-device-id headers)."
                  />
                </div>
              </div>

              {/* Advanced Settings Toggle */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                >
                  {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {showAdvanced ? 'Hide Advanced API Settings' : 'Show Advanced API Settings (Endpoint URL & User-Agent)'}
                </button>

                {showAdvanced && (
                  <div className="mt-3 space-y-4 rounded-card border border-border bg-surface-subtle p-4">
                    <Input
                      label="Pricing Endpoint URL"
                      placeholder="https://consigner.wheelseye.com/consigner/v5/demand/vehicle-list"
                      value={pricingUrl}
                      onChange={(e) => setPricingUrl(e.target.value)}
                      hint="WheelsEye vehicle-list pricing API endpoint."
                    />

                    <Input
                      label="User Agent Header"
                      placeholder="Mozilla/5.0 (Linux; Android 16; Pixel 10)..."
                      value={userAgent}
                      onChange={(e) => setUserAgent(e.target.value)}
                      hint="User-Agent string sent with requests. Android/Chrome UA ensures maximum compatibility."
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <div className="text-xs text-muted">
                  {configQuery.data?.updated_at && (
                    <span>Last updated: {new Date(configQuery.data.updated_at).toLocaleString()}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    loading={testMutation.isPending}
                    icon={<Zap size={16} className="text-brand" />}
                    onClick={handleTestNow}
                  >
                    Test Live Connection
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={saveMutation.isPending}
                  >
                    Save Changes
                  </Button>
                </div>
              </div>
            </form>
          )}
        </CardBody>
      </Card>

      {/* ── Live Test Response & Sample Market Rates Preview ── */}
      {testResult && (
        <Card>
          <CardHeader
            title={
              <div className="flex items-center gap-2">
                {testResult.success ? (
                  <CheckCircle2 size={18} className="text-success" />
                ) : (
                  <AlertTriangle size={18} className="text-warning" />
                )}
                <span>Live Test Diagnostic Result</span>
              </div>
            }
            description={`HTTP Status ${testResult.status} in ${testResult.latencyMs}ms • ${testResult.message}`}
          />
          <CardBody>
            {testResult.success && testResult.sampleRates && testResult.sampleRates.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase text-muted">
                  Sample Live Market Rates Verified (Pune ↔ Nashik Lane):
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {testResult.sampleRates.map((truck, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-control border border-border bg-surface-subtle p-3"
                    >
                      <div>
                        <div className="font-medium text-text text-sm">{truck.name}</div>
                        <div className="text-xs text-muted">{truck.bodyType}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-text text-sm">{formatRupees(truck.price)}</div>
                        <div className="text-xs text-success font-medium">WheelsEye Verified</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">
                {testResult.message}
              </p>
            )}
          </CardBody>
        </Card>
      )}
    </Page>
  )
}
