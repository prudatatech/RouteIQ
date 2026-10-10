const fs = require('fs');
let content = fs.readFileSync('frontend/src/pages/TplOnboardingPage.tsx', 'utf8');

// Add multipleTruckTypes state
content = content.replace(
  "const [truckType, setTruckType] = useState('')",
  "const [truckType, setTruckType] = useState('')\n  const [multipleTruckTypes, setMultipleTruckTypes] = useState<string[]>([])"
);

// Update validation
content = content.replace(
  "if (step === 1 && fleetSize === 'single' && !truckType) {",
  "if (step === 1 && fleetSize === 'single' && !truckType) {\n      toast.error('Please select a truck type.')\n      return\n    }\n    if (step === 1 && fleetSize === 'multiple' && multipleTruckTypes.length === 0) {"
);

// Update payload
content = content.replace(
  "truckType: fleetSize === 'single' ? truckType : null,",
  "truckType: fleetSize === 'single' ? truckType : multipleTruckTypes.join(','),"
);

// Update UI
content = content.replace(
  "{fleetSize === 'single' && (",
  {fleetSize === 'multiple' && (
                  <div className="space-y-4 pt-4 border-t border-border">
                    <p className="text-sm font-medium text-text">Select all vehicle types in your fleet:</p>
                    <div className="flex flex-wrap gap-2">
                      {vehicles?.map(v => (
                        <button
                          key={v.key}
                          onClick={() => setMultipleTruckTypes(prev => prev.includes(v.key) ? prev.filter(k => k !== v.key) : [...prev, v.key])}
                          className={clsx(
                            'px-4 py-2 rounded-full border text-sm font-medium transition-colors',
                            multipleTruckTypes.includes(v.key) ? 'border-brand bg-brand-fill text-brand' : 'border-border text-muted hover:border-text hover:text-text'
                          )}
                        >
                          {v.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {fleetSize === 'single' && (
);

fs.writeFileSync('frontend/src/pages/TplOnboardingPage.tsx', content);
