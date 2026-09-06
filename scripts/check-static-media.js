const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const viewRoot = path.join(root, 'views');
const publicRoot = path.join(root, 'public');
const failures = [];
let localImageRefs = 0;
let marketingRemoteImages = 0;
const approvedRemoteMarketingImages = new Set([
  'https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg',
  'https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg',
]);
const approvedVisualRemotePatterns = [
  /^https:\/\/picsum\.photos\/seed\/(?:academics|admissions|attendance-ca|classicacademy|communication|communication-ca|core-ca|exams|exams-ca|fees|finance|finance-ca|onlinepresence|portal-ca|reports-ca|security-ca|support)\/(?:400\/300|1200\/700)$/,
  /^https:\/\/img\.icons8\.com\/(?:fluency\/48\/group-background-selected\.png|ios-filled\/50\/4a90e2\/[a-z0-9-]+\.png)$/,
];

function isApprovedVisualRemote(src) {
  return approvedRemoteMarketingImages.has(src) || approvedVisualRemotePatterns.some((re) => re.test(src));
}

function walk(dir, predicate) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, predicate));
    else if (!predicate || predicate(full)) out.push(full);
  }
  return out;
}

function localPublicTarget(src, owner) {
  if (src.startsWith('/')) return path.join(publicRoot, src.slice(1));
  // Public marketing templates are rendered at site routes (for example /about),
  // so the user-approved ./img/... and img/... references resolve from /public
  // in the browser rather than from the server-side views directory.
  const isPlatformPublicView = owner.includes(`${path.sep}views${path.sep}platform${path.sep}public${path.sep}`);
  if (isPlatformPublicView && /^(?:\.\/)?img\//i.test(src)) {
    return path.join(publicRoot, src.replace(/^\.\//, ''));
  }
  return path.resolve(path.dirname(owner), src);
}

for (const file of walk(viewRoot, (p) => p.endsWith('.ejs'))) {
  const text = fs.readFileSync(file, 'utf8');
  const isMarketing = file.includes(`${path.sep}views${path.sep}platform${path.sep}public${path.sep}`)
    || file.endsWith(`${path.sep}views${path.sep}platform${path.sep}partials${path.sep}footer.ejs`);

  // Fail an actually unterminated image tag. EJS expressions contain `<%`
  // inside valid attributes, so only another literal `<img` before the closing
  // bracket is evidence that the previous image tag was malformed. Dynamic
  // lightbox/cropper images may intentionally receive `src` from trusted JS.
  let cursor = 0;
  while ((cursor = text.indexOf('<img', cursor)) !== -1) {
    const close = text.indexOf('>', cursor + 4);
    const nextImage = text.indexOf('<img', cursor + 4);
    if (close === -1 || (nextImage !== -1 && nextImage < close)) {
      failures.push(`${path.relative(root, file)} has malformed <img> tag near offset ${cursor}`);
      cursor += 4;
      continue;
    }
    cursor = close + 1;
  }

  const imgRe = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gis;
  let match;
  while ((match = imgRe.exec(text))) {
    const src = String(match[1] || '').trim();
    if (!src || src.includes('<%') || src.startsWith('data:')) continue;
    if (/^(?:https?:)?\/\//i.test(src)) {
      if (isMarketing) {
        marketingRemoteImages += 1;
        if (!isApprovedVisualRemote(src)) {
          failures.push(`${path.relative(root, file)} uses unapproved remote marketing image: ${src}`);
        }
      }
      continue;
    }
    localImageRefs += 1;
    const target = localPublicTarget(src, file);
    if (!fs.existsSync(target)) failures.push(`${path.relative(root, file)} missing image ${src}`);
  }
}

for (const file of walk(publicRoot, (p) => p.endsWith('.css'))) {
  const text = fs.readFileSync(file, 'utf8');
  const urlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  let match;
  while ((match = urlRe.exec(text))) {
    const src = String(match[1] || '').trim();
    if (!src || src.startsWith('data:') || src.startsWith('#') || src.startsWith('%23')) continue;
    if (/^(?:https?:)?\/\//i.test(src)) {
      if (/^https:\/\/fonts\.googleapis\.com\//i.test(src)) continue;
      // Preserve the exact user-approved visual source. Do not substitute a generic logo or feature image.
      continue;
    }
    const target = src.startsWith('/') ? path.join(publicRoot, src.slice(1)) : path.resolve(path.dirname(file), src);
    if (!fs.existsSync(target)) failures.push(`${path.relative(root, file)} missing CSS asset ${src}`);
  }
}

if (failures.length) {
  console.error('Static media integrity: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Static media integrity: PASS (${localImageRefs} local <img> refs, ${marketingRemoteImages} remote marketing images)`);
