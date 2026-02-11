// ----------------------------
// Configuration
// ----------------------------
const SITE_NAME = "My Web Site";
const AUTHOR = "Chris Northcott";
const COPYDATE = new Date().getFullYear().toString();

// ----------------------------
// Imports
// ----------------------------
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { marked } = require("marked");
const sanitizeHtml = require("sanitize-html");

// Disable risky markdown features
marked.setOptions({
    headerIds: false,
    mangle: false
});

// ----------------------------
// Port derivation
// ----------------------------
function derivePort(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    }
    return 10000 + (hash % 50000);
}

const PORT = derivePort(SITE_NAME);

// ----------------------------
// Paths
// ----------------------------
const pagesDir = path.join(__dirname, "pages");
const templatePath = path.join(__dirname, "template.html");
const template = fs.readFileSync(templatePath, "utf8");

// ----------------------------
// Cache
// Map: route → { hash, html, etag }
// ----------------------------
const pageCache = new Map();

// ----------------------------
// Helpers
// ----------------------------
function renderTemplate(title, content) {
    return template
        .replaceAll("{{site}}", SITE_NAME)
        .replaceAll("{{author}}", AUTHOR)
        .replaceAll("{{copydate}}", COPYDATE)
        .replaceAll("{{title}}", title)
        .replaceAll("{{nav}}", buildNav())
        .replaceAll("{{content}}", content);
}

function hashContent(content) {
    return crypto.createHash("sha256").update(content).digest("hex");
}

function sanitiseUrl(urlPath) {
    let clean = urlPath.split("?")[0].split("#")[0];

    try {
        clean = decodeURIComponent(clean);
    } catch {
        return null;
    }

    clean = path.posix.normalize(clean);

    if (!clean.startsWith("/")) {
        clean = "/" + clean;
    }

    if (clean.endsWith("/") && clean !== "/") {
        clean = clean.slice(0, -1);
    }

    if (clean === "") {
        clean = "/";
    }

    return clean;
}

function routeToFile(cleanPath) {
    const name = cleanPath === "/" ? "index" : cleanPath.slice(1);
    const candidate = path.resolve(pagesDir, name + ".md");

    const relative = path.relative(pagesDir, candidate);

    // If it escapes the directory, relative will start with ".."
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return null;
    }

    return candidate;
}

function buildPage(route, filePath) {
    const md = fs.readFileSync(filePath, "utf8");
    const contentHash = hashContent(md);

    const cached = pageCache.get(route);
    if (cached && cached.hash === contentHash) {
        return cached;
    }

    // Render markdown
    const rawHtml = marked.parse(md);

    // Sanitize output (removes scripts, event handlers, etc.)
    const htmlBody = sanitizeHtml(rawHtml, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([
            "img", "h1", "h2", "h3", "pre", "code"
        ]),
        allowedAttributes: {
            a: ["href", "name", "target"],
            img: ["src", "alt"]
        }
    });

    const title = route === "/" ? "index" : route.slice(1);
    const fullHtml = renderTemplate(title, htmlBody);

    const etag = `"${hashContent(fullHtml)}"`;

    const result = {
        hash: contentHash,
        html: fullHtml,
        etag: etag
    };

    pageCache.set(route, result);
    return result;
}

function buildNav() {
    const navFile = path.join(__dirname, "nav.md");

    if (!fs.existsSync(navFile)) return "";

    try {
        const md = fs.readFileSync(navFile, "utf8");
        const rawHtml = marked.parse(md);

        return sanitizeHtml(rawHtml, {
            allowedTags: sanitizeHtml.defaults.allowedTags,
            allowedAttributes: {
                a: ["href", "name", "target"]
            }
        });
    } catch {
        return "";
    }
}

// ----------------------------
// Server
// ----------------------------
const server = http.createServer((req, res) => {
    // GET only
    if (req.method !== "GET") {
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method Not Allowed");
    }

    const cleanPath = sanitiseUrl(req.url);
    if (!cleanPath) {
        res.writeHead(400);
        return res.end("Bad Request");
    }

    const filePath = routeToFile(cleanPath);
    if (!filePath) {
        res.writeHead(403);
        return res.end("Forbidden");
    }

    if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        return res.end("Not Found");
    }

    try {
        const page = buildPage(cleanPath, filePath);

        // ETag check
        if (req.headers["if-none-match"] === page.etag) {
            res.writeHead(304);
            return res.end();
        }

        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "ETag": page.etag,
            "Cache-Control": "public, max-age=0, must-revalidate",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer",
	    "Content-Security-Policy": "default-src 'self'; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        });

        res.end(page.html);
    } catch {
        res.writeHead(500);
        res.end("Internal Server Error");
    }
});

// ----------------------------
// Start
// ----------------------------
server.listen(PORT, () => {
    console.log(`${SITE_NAME} running at http://localhost:${PORT}`);
});
