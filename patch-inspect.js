const fs = require('fs');
let code = fs.readFileSync('scripts/inspect-instance.ts', 'utf8');
code = code.replace(
  'const report = {',
  'const report = {\n    schemaVersion: 1,'
);
fs.writeFileSync('scripts/inspect-instance.ts', code);
