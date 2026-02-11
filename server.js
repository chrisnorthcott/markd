// ----------------------------
// Configuration
// ----------------------------
const SITE_NAME = "My Web Site";
const AUTHOR = "Chris Northcott"
const COPYDATE = new Date().getFullYear().toString()

// ----------------------------
// Imports
// ----------------------------
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { marked } = require("marked");

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
// Map: route → { hash, html }
// ----------------------------
const pageCache = new Map();

// ----------------------------
// Helpers
// ----------------------------
function renderTemplate(title, content) {
    return template
	.replace("{{site}}", SITE_NAME)
	.replace("{{author}}", AUTHOR)
	.replace("{{copydate}}", COPYDATE)
        .replace("{{title}}", title)
        .replace("{{content}}", content);
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
    const file = path.join(pagesDir, name + ".md");

    // enforce directory boundary
    if (!file.startsWith(pagesDir)) {
        return null;
    }

    return file;
}

function buildPage(route, filePath) {
    const md = fs.readFileSync(filePath, "utf8");
    const newHash = hashContent(md);

    const cached = pageCache.get(route);
    if (cached && cached.hash === newHash) {
        return cached.html;
    }

    const htmlBody = marked.parse(md);
    const title = route === "/" ? "index" : route.slice(1);
    const fullHtml = renderTemplate(title, htmlBody);

    pageCache.set(route, {
        hash: newHash,
        html: fullHtml,
    });

    return fullHtml;
}

// ----------------------------
// Server
// ----------------------------
const server = http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "POST") {
        res.writeHead(405);
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
        const html = buildPage(cleanPath, filePath);

        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer",
        });

        res.end(html);
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
