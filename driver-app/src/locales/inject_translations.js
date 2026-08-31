const fs = require('fs');

const path = 'd:/margixindia-main/driver-app/src/locales/index.ts';
let code = fs.readFileSync(path, 'utf8');

const newTranslations = {
  en: {
    sos_acc_serious: 'Accident - Serious',
    sos_acc_minor: 'Accident - Non Serious',
    sos_veh_damage: 'Vehicle Damage',
    sos_details: 'Additional details (optional)...',
    sos_sending: 'Sending SOS',
    sos_wait: 'Please wait...',
    sos_sent_title: 'SOS Sent',
    sos_sent_desc: 'Fleet manager has been notified immediately with your exact location.',
    sos_failed: 'SOS Failed'
  },
  hi: {
    sos_acc_serious: 'दुर्घटना - गंभीर (Serious)',
    sos_acc_minor: 'दुर्घटना - मामूली (Minor)',
    sos_veh_damage: 'वाहन खराब (Damage)',
    sos_details: 'अतिरिक्त जानकारी (वैकल्पिक)...',
    sos_sending: 'SOS भेज रहे हैं',
    sos_wait: 'कृपया प्रतीक्षा करें...',
    sos_sent_title: 'SOS भेजा गया',
    sos_sent_desc: 'आपके सटीक स्थान के साथ फ्लीट मैनेजर को तुरंत सूचित कर दिया गया है।',
    sos_failed: 'SOS विफल'
  },
  mr: {
    sos_acc_serious: 'अपघात - गंभीर (Serious)',
    sos_acc_minor: 'अपघात - किरकोळ (Minor)',
    sos_veh_damage: 'वाहन खराब (Damage)',
    sos_details: 'अतिरिक्त माहिती (पर्यायी)...',
    sos_sending: 'SOS पाठवत आहे',
    sos_wait: 'कृपया प्रतीक्षा करा...',
    sos_sent_title: 'SOS पाठवला',
    sos_sent_desc: 'तुमच्या अचूक स्थानासह फ्लीट मॅनेजरला त्वरित सूचित केले आहे.',
    sos_failed: 'SOS अयशस्वी'
  },
  te: {
    sos_acc_serious: 'ప్రమాదం - తీవ్రమైన (Serious)',
    sos_acc_minor: 'ప్రమాదం - చిన్నది (Minor)',
    sos_veh_damage: 'వాహనం దెబ్బతింది (Damage)',
    sos_details: 'అదనపు వివరాలు (ఐచ్ఛికం)...',
    sos_sending: 'SOS పంపుతోంది',
    sos_wait: 'దయచేసి వేచి ఉండండి...',
    sos_sent_title: 'SOS పంపబడింది',
    sos_sent_desc: 'మీ ఖచ్చితమైన స్థానంతో ఫ్లీట్ మేనేజర్‌కు వెంటనే తెలియజేయబడింది.',
    sos_failed: 'SOS విఫలమైంది'
  }
};

for (const lang of Object.keys(newTranslations)) {
  const marker = new RegExp(`(${lang}: \\{\\s*)`);
  let injection = '';
  for (const key of Object.keys(newTranslations[lang])) {
    injection += `\n    ${key}: '${newTranslations[lang][key]}',`;
  }
  code = code.replace(marker, `$1${injection}\n`);
}

fs.writeFileSync(path, code);
console.log('Translations injected successfully!');
