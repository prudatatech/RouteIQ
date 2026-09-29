import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import design from './eslint-rules/design-guardrails.js';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Legacy debt: the codebase makes pervasive use of `any` (external APIs, map/geo
      // libraries, event payloads). Downgraded to `warn` rather than fixed wholesale to
      // avoid a large, risky refactor; new code should still avoid introducing it.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow intentionally-unused bindings (params, destructured values, caught errors)
      // when prefixed with `_`, the standard convention for "required but unused".
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Files that are on the shared theme. The design rules are errors here so they
    // can't drift again. Add each page to this list when it moves to the shared
    // components; Phase 7 replaces the list with src/**.
    files: [
      'src/components/ui/**/*.{ts,tsx}',
      'src/components/SOSListener.tsx',
      'src/components/tpl/**/*.{ts,tsx}',
      'src/components/vendor/vendorContext.ts',
      'src/components/fleet/VehicleWizardModal.tsx',
      'src/components/vendor/PlaceBidModal.tsx',
      'src/components/vendor/VendorTrackerCard.tsx',
      'src/config/**/*.{ts,tsx}',
      'src/pages/VendorRequestsPage.tsx',
      'src/pages/VendorDocumentsPage.tsx',
      'src/pages/VendorOnboardingPage.tsx',
      'src/pages/VendorPortalPage.tsx',
      'src/pages/VendorCorridorPage.tsx',
      'src/pages/VendorShipmentRequestPage.tsx',
      'src/pages/VendorShipmentsPage.tsx',
      'src/pages/VendorTrackingPage.tsx',
      'src/pages/LoginPage.tsx',
      'src/pages/LandingPage.tsx',
      'src/pages/TplPartnersPage.tsx',
      'src/pages/TplPartnerDetailPage.tsx',
      'src/pages/TplOnboardingPage.tsx',
      'src/pages/TplTrackApplicationPage.tsx',
      'src/pages/TplSetupCredentialsPage.tsx',
      'src/pages/TplDashboardPage.tsx',
      'src/services/account.ts',
      'src/services/tplDocuments.ts',
      'src/utils/safeNext.ts',
      'src/pages/BidsPage.tsx',
      'src/pages/admin/**/*.{ts,tsx}',
      'src/hooks/useRealtimeRefresh.ts',
      'src/utils/display.ts',
      'src/pages/DashboardPage.tsx',
      'src/pages/LiveMapPage.tsx',
      'src/pages/FleetPage.tsx',
      'src/pages/EmergencyPage.tsx',
      'src/pages/ShipmentsPage.tsx',
      'src/pages/ShipmentManifestPage.tsx',
      'src/components/modals/AddShipmentModal.tsx',
      'src/components/shipments/**/*.{ts,tsx}',
      'src/pages/RoutesPage.tsx',
      'src/pages/RouteDetailsPage.tsx',
      'src/pages/OptimizePage.tsx',
      'src/pages/AnalyticsPage.tsx',
      'src/components/analytics/**/*.{ts,tsx}',
      'src/pages/BackhaulPage.tsx',
      'src/components/backhaul/**/*.{ts,tsx}',
      'src/store/cargoStore.ts',
      'src/components/tracking/**/*.{ts,tsx}',
      'src/pages/CustomerTrackingPage.tsx',
      'src/pages/MobileTrackPage.tsx',
      'src/pages/DriverPage.tsx',
    ],
    plugins: { design },
    rules: {
      'design/no-off-theme-classes': 'error',
      'design/no-inline-visual-style': 'error',
    },
  },
);
