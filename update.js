const fs = require('fs');
let content = fs.readFileSync('frontend/src/pages/TplOnboardingPage.tsx', 'utf8');

// 1. Update imports for react-router-dom
content = content.replace(
  "import { useQuery } from '@tanstack/react-query'",
  "import { useQuery } from '@tanstack/react-query'\nimport { useSearchParams, useNavigate } from 'react-router-dom'"
);

// 2. Remove extra steps
content = content.replace(
  "const STEPS = [\n  'Contact Details',\n  'Fleet Details',\n  'Operations',\n  'Documents',\n  'Review',\n]",
  "const STEPS = [\n  'Contact Details',\n  'Fleet Details',\n  'Review',\n]"
);

// 3. Update step state to use searchParams
content = content.replace(
  "const [step, setStep] = useState(0)",
  "const [searchParams, setSearchParams] = useSearchParams()\n  const navigate = useNavigate()\n  const step = parseInt(searchParams.get('step') || '0', 10)\n  const setStep = (newStep: number) => setSearchParams({ step: newStep.toString() })"
);

// 4. Update direction
content = content.replace(
  "const [direction, setDirection] = useState<'forward' | 'backward'>('forward')",
  "const [direction, setDirection] = useState<'forward' | 'backward'>('forward')\n  const [submitted, setSubmitted] = useState(false)"
);

// 5. Update submit success handling
content = content.replace(
  "toast.success('Successfully onboarded! Redirecting to Dashboard...')\n        setTimeout(() => window.location.href = '/3pl/dashboard', 2000)",
  "toast.success('Successfully onboarded!')\n        setSubmitted(true)"
);

// 6. Return Check Email UI if submitted
content = content.replace(
  "return (\n    <Page width=\"form\" className=\"!space-y-4 py-8 overflow-hidden\">",
  "if (submitted) {\n    return (\n      <Page width=\"form\" className=\"!space-y-4 py-8 flex items-center justify-center min-h-[60vh]\">\n        <Card padded className=\"text-center space-y-6 max-w-md w-full\">\n          <div className=\"mx-auto w-16 h-16 bg-success/10 text-success flex items-center justify-center rounded-full mb-4\">\n            <CheckCircle2 size={32} />\n          </div>\n          <h2 className=\"text-2xl font-bold text-text\">Application Submitted!</h2>\n          <p className=\"text-muted\">\n            Your truck details have been successfully registered.\n          </p>\n          <div className=\"p-4 bg-surface-subtle border border-border rounded-control\">\n            <p className=\"font-medium text-text\">\n              Please check your email for your login credentials to access the 3PL Portal.\n            </p>\n          </div>\n          <button onClick={() => navigate('/3pl/dashboard')} className=\"w-full py-3 bg-brand text-brand-fill font-bold rounded-control transition-opacity hover:opacity-90\">\n            Go to Dashboard\n          </button>\n        </Card>\n      </Page>\n    )\n  }\n\n  return (\n    <Page width=\"form\" className=\"!space-y-4 py-8 overflow-hidden\">"
);

fs.writeFileSync('frontend/src/pages/TplOnboardingPage.tsx', content);
