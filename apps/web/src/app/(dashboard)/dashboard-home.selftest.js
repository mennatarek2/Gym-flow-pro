const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'dashboard-home.js'), 'utf8');
const layoutStart = source.indexOf('function buildLayout');
const layoutEnd = source.indexOf('function wireRetries', layoutStart);
const layout = source.slice(layoutStart, layoutEnd);

function check(condition, message) {
  if (!condition) throw new Error(`dashboard-home selftest failed: ${message}`);
  console.log(`ok — ${message}`);
}

check(source.includes('/dashboard/overview?period='), 'uses the role-filtered dashboard contract');
check(source.includes("can('classes.view')"), 'supports Trainer class permission');
check(source.includes("can('attendance.view')"), 'supports Trainer attendance permission');
check(source.includes('financial.dashboard'), 'renders canonical financial fields');
check(!source.includes('demoToggle') && !source.includes('role-switch'), 'ships no preview controls');
check(!source.includes('18,450') && !source.includes('286,400'), 'contains no preview KPI values');

const order = ['id: \'finance\'', 'id: \'kpis\'', 'id: \'quick-actions\'',
  'id: \'business\'', 'id: \'occupancy\'', 'id: \'classes\'', 'id: \'attention\''];
let previous = -1;
for (const marker of order) {
  const current = layout.indexOf(marker);
  check(current > previous, `${marker} keeps the accepted section order`);
  previous = current;
}

console.log('\nAll dashboard-home selftest checks passed.');
