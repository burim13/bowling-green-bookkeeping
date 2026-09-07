// GitHub Pages caches static assets for up to 10 minutes per CDN edge, independent of the
// browser's own cache -- a bare filename reference can keep serving a stale file for a while
// after a push. Since this project has no build step, there's no bundler to hash filenames
// automatically, so this script does the next best thing: it stamps every internal reference
// (index.html's <script>/<link> tags, and every `import ... from "./x.js"` between the app's
// own modules) with the same `?v=<timestamp>` query string, forcing a fresh fetch after each
// deploy. CDN-hosted imports (gstatic.com) are already pinned to an exact SDK version and are
// left untouched.
//
// Run this (`npm run bump-version`) right before committing any change to index.html, css/, or
// js/ -- then commit the results together with your actual change.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = Date.now();

const publicDir = path.join(rootDir, "public");
const targets = [
  // Every standalone HTML page (index.html, invite.html, any future one) -- not just index.html.
  ...fs.readdirSync(publicDir).filter((f) => f.endsWith(".html")).map((f) => path.join(publicDir, f)),
  ...fs.readdirSync(path.join(publicDir, "js")).map((f) => path.join(publicDir, "js", f)),
];

// Matches a local (non-http) reference to a .js or .css file, with an optional existing
// `?v=...` query string, inside a quoted attribute or import specifier.
const REFERENCE_RE = /((?:from\s+|src=|href=)["'])(\.?\/?[\w./-]+\.(?:js|css))(\?v=\d+)?(["'])/g;

let changedFiles = 0;

for (const file of targets) {
  const original = fs.readFileSync(file, "utf8");
  const updated = original.replace(REFERENCE_RE, (match, prefix, filePath, _oldVersion, suffix) => {
    return `${prefix}${filePath}?v=${version}${suffix}`;
  });
  if (updated !== original) {
    fs.writeFileSync(file, updated);
    changedFiles++;
    console.log(`Updated ${path.relative(rootDir, file)}`);
  }
}

console.log(`\nStamped ${changedFiles} file(s) with ?v=${version}.`);
