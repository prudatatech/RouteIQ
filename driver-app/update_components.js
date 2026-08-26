const fs = require('fs');
const path = require('path');

function replaceInFile(filePath, replacements) {
  const fullPath = path.join(__dirname, filePath);
  let content = fs.readFileSync(fullPath, 'utf8');
  let original = content;

  // Need to inject useTranslation if it's not there, but these components are simple.
  // Wait, these components might not have useTranslation imported.
  // SwipeButton and HoldButton are pure components.
  // Better to pass translated strings as props, OR hook them.
  // Since we don't want to change prop signatures everywhere, adding the hook is easier if it's within a React context.
  
  // Actually, wait. I will check if useTranslation is in the file.
  if (!content.includes('useTranslation')) {
    content = "import { useTranslation } from '../hooks/useTranslation';\n" + content;
  }
  
  // Inject the hook inside the component body if not there.
  // This requires a regex to find the component definition.
  replacements.forEach(r => {
    content = content.replace(r.from, r.to);
  });
  
  fs.writeFileSync(fullPath, content);
  console.log(`Updated ${filePath}`);
}

replaceInFile('src/components/SwipeButton.tsx', [
  { from: /'✓ Completed'/g, to: "t('btn_completed')" },
  { from: /export default function SwipeButton\([^)]+\) {/, to: "$&\n  const { t } = useTranslation();" }
]);

replaceInFile('src/components/HoldButton.tsx', [
  { from: /'HOLDING\.\.\.'/g, to: "t('btn_holding')" },
  { from: /export default function HoldButton\([^)]+\) {/, to: "$&\n  const { t } = useTranslation();" }
]);

replaceInFile('src/components/BackhaulPopup.tsx', [
  { from: /'Letting nearby transporters know you have space\.\.\.'/g, to: "t('backhaul_opening')" },
  { from: /'Finding your best offer\.\.\.'/g, to: "t('backhaul_bidding')" },
  { from: /' transporters interested'/g, to: "t('backhaul_bidders')" },
  { from: /'Best offer accepted: '/g, to: "t('backhaul_matched_offer') + ' '" },
  { from: /'New stop: '/g, to: "t('backhaul_matched_route') + ' '" },
  { from: /'No offers met your route right now\.'/g, to: "t('backhaul_no_match')" },
  { from: /'We\\'ll keep watching\.'/g, to: "t('backhaul_no_match_desc')" },
  { from: /export default function BackhaulPopup\([^)]+\) {/, to: "$&\n  const { t } = useTranslation();" }
]);

replaceInFile('src/screens/ReturnTripScreen.tsx', [
  { from: /'Return Trip Matching'/g, to: "t('return_title')" },
  { from: /'Available Capacity'/g, to: "t('return_avail_cap')" },
  { from: /'Derived automatically from loaded manifest'/g, to: "t('return_cap_desc')" },
  { from: /'Auto-Match Return Load'/g, to: "t('return_auto_match')" },
  { from: /'Turn on to automatically find and assign return trip cargo that fits your available capacity\.'/g, to: "t('return_auto_match_desc')" },
  { from: /'Matching Enabled'/g, to: "t('return_matching_enabled')" },
  { from: /'Searching for return loads\.\.\.'/g, to: "t('return_searching_alert')" },
  { from: /'Matching Disabled'/g, to: "t('return_matching_disabled')" },
  { from: /'Stopped searching\.'/g, to: "t('return_stopped_alert')" },
  { from: /'Actively scanning for return loads\.\.\.'/g, to: "t('return_searching')" },
  { from: /'Done'/g, to: "t('done')" },
  { from: />Return Trip Matching</g, to: ">{t('return_title')}<" },
  { from: />Available Capacity</g, to: ">{t('return_avail_cap')}<" },
  { from: />Derived automatically from loaded manifest</g, to: ">{t('return_cap_desc')}<" },
  { from: />Auto-Match Return Load</g, to: ">{t('return_auto_match')}<" },
  { from: />Turn on to automatically find and assign return trip cargo that fits your available capacity\.</g, to: ">{t('return_auto_match_desc')}<" },
  { from: />Actively scanning for return loads\.\.\.</g, to: ">{t('return_searching')}<" },
  { from: />Done</g, to: ">{t('done')}<" },
  { from: /export default function ReturnTripScreen\([^)]+\) {/, to: "$&\n  const { t } = useTranslation();" },
  { from: /import \{ api \} from '\.\.\/services\/api';/, to: "import { api } from '../services/api';\nimport { useTranslation } from '../hooks/useTranslation';" }
]);

