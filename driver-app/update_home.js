const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'screens', 'HomeScreen.tsx');
let content = fs.readFileSync(file, 'utf8');

const replacements = [
  { from: /'🚨 Next Stop Added!'/g, to: "t('alert_next_stop_title')" },
  { from: /'A new stop was inserted into your route.'/g, to: "t('alert_next_stop_desc')" },
  { from: /'View Map'/g, to: "t('view_map')" },
  { from: /'GPS Required'/g, to: "t('alert_gps_req_title')" },
  { from: /'Waiting for GPS location\.\.\.'/g, to: "t('alert_gps_req_desc')" },
  { from: /'Geofence Warning'/g, to: "t('alert_geofence_title')" },
  { from: /`You are not near the location \(\$\{Math\.round\(dist\)\}m away\)\. Do you want to do testing\?`/g, to: "`${t('alert_geofence_desc')} (${Math.round(dist)}m)`" },
  { from: /'Cancel'/g, to: "t('cancel')" },
  { from: /'Yes'/g, to: "t('yes')" },
  { from: /'📍 Arrived at Stop'/g, to: "t('alert_arrived_title')" },
  { from: /'Not Yet'/g, to: "t('not_yet')" },
  { from: /'Mark Delivered'/g, to: "t('mark_delivered')" },
  { from: /'Take Break'/g, to: "t('alert_take_break_title')" },
  { from: /'Pause GPS tracking and mark status as idle\?'/g, to: "t('alert_take_break_desc')" },
  { from: /'Break Started'/g, to: "t('alert_break_started_title')" },
  { from: /'Your route is paused\.'/g, to: "t('alert_break_started_desc')" },
  { from: /'Error'/g, to: "t('error')" },
  { from: /'Failed to update break status'/g, to: "t('error')" }, // fallback
  { from: /'Report Issue'/g, to: "t('alert_report_issue_title')" },
  { from: /'Mark this delivery as failed\/exception\?'/g, to: "t('alert_report_issue_desc')" },
  { from: /'Mark Failed'/g, to: "t('mark_failed')" },
  { from: /'Reported'/g, to: "t('alert_reported_title')" },
  { from: /'Stop marked as failed\.'/g, to: "t('alert_reported_desc')" },
  { from: /'Required'/g, to: "t('required')" },
  { from: /'Please capture a valid signature'/g, to: "t('alert_valid_sig')" },
  { from: /'🎉 Route Completed'/g, to: "t('alert_route_completed_title')" },
  { from: /'Would you like to look for return trips\?'/g, to: "t('alert_route_completed_desc')" },
  { from: /'No'/g, to: "t('no')" },
  { from: /'Yes, Find Cargo'/g, to: "t('yes_find_cargo')" },
  { from: />Proof of Delivery</g, to: ">{t('pod_title')}<" },
  { from: />Please ask the recipient to sign below</g, to: ">{t('pod_desc')}<" },
  { from: /placeholder="Type name as signature\.\.\."/g, to: "placeholder={t('pod_placeholder')}" },
  { from: />Cancel</g, to: ">{t('cancel')}<" },
  { from: />Complete Stop</g, to: ">{t('complete_stop')}<" },
  { from: />EMERGENCY ALERT</g, to: ">{t('sos_title')}<" },
  { from: />Report an issue to the Fleet Manager instantly</g, to: ">{t('sos_desc')}<" },
  { from: /placeholder="Describe the issue \(e\.g\. breakdown, accident\)\.\.\."/g, to: "placeholder={t('sos_placeholder')}" },
  { from: />Send SOS</g, to: ">{t('send_sos')}<" }
];

replacements.forEach(r => {
  content = content.replace(r.from, r.to);
});

fs.writeFileSync(file, content);
console.log('HomeScreen updated successfully');
