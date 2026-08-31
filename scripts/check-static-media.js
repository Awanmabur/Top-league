const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const viewRoot = path.join(root, 'views');
const publicRoot = path.join(root, 'public');
const failures = [];
let localImageRefs = 0;
let marketingRemoteImages = 0;

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
  return path.resolve(path.dirname(owner), src);
}

for (const file of walk(viewRoot, (p) => p.endsWith('.ejs'))) {
  const text = fs.readFileSync(file, 'utf8');
  const isMarketing = file.includes(`${path.sep}views${path.sep}platform${path.sep}public${path.sep}`);

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
        failures.push(`${path.relative(root, file)} uses remote marketing image: ${src}`);
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
    if (!src || src.startsWith('data:') || src.startsWith('#') || src.startsWith('%23') || /^(?:https?:)?\/\//i.test(src)) continue;
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
