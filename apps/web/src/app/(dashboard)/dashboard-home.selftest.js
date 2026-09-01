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

check(source.includes('maintainAspectRatio: false'), 'charts fill their container height');
check(source.includes('watchChartHost'), 'charts observe host size');
check(source.includes('resizeDelay: 0'), 'charts resize without delay');

const dashCss = fs.readFileSync(
  path.join(__dirname, '..', 'shared', 'dashboard-layout.css'),
  'utf8'
);
check(dashCss.indexOf('minmax(min(100%, 140px)') !== -1, 'KPI tracks cannot overflow the card');
check(dashCss.indexOf('@media (max-width: 767.98px)') !== -1, 'dashboard stacks on phone');
check(dashCss.indexOf('grid-column: span 6') !== -1, 'tablet keeps two-up widgets');
check(dashCss.indexOf('.dash-chart-wrap canvas') !== -1, 'chart canvas follows the wrap');

console.log('\nAll dashboard-home selftest checks passed.');
