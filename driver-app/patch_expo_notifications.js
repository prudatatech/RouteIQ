const fs = require('fs');
const path = require('path');

const dir = 'd:\\RouteIQ-test\\driver-app\\node_modules\\expo-notifications\\build';
const files = fs.readdirSync(dir);

for (const file of files) {
  if (file.endsWith('.js')) {
    const fullPath = path.join(dir, file);
    let content = fs.readFileSync(fullPath, 'utf8');
    
    // Look for: export default requireNativeModule('ModuleName');
    // or: const nativeModule = requireNativeModule('ModuleName');
    
    if (content.includes('requireNativeModule(') && !content.includes('try { mod = requireNativeModule')) {
      content = content.replace(
        /export default requireNativeModule(?:<[^>]+>)?\(([^)]+)\);/g,
        `let mod = {}; try { mod = requireNativeModule($1); } catch (e) {} export default mod;`
      );
      content = content.replace(
        /const (\w+) = requireNativeModule(?:<[^>]+>)?\(([^)]+)\);/g,
        `let $1 = {}; try { $1 = requireNativeModule($2); } catch (e) {}`
      );
      fs.writeFileSync(fullPath, content);
      console.log('Patched ' + file);
    }
  }
}
