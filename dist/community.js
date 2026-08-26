import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Hono } from 'hono';
const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'tw_community_session';
const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
const DEFAULT_MAX_SB3_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_UPLOAD_FORM_OVERHEAD_BYTES = 64 * 1024;
const PASSWORD_HASH_PREFIX = 'scrypt';
const SB3_MIME_TYPES = new Set([
    'application/octet-stream',
    'application/x.scratch.sb3',
    'application/zip',
    'application/x-zip-compressed'
]);
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export function createCommunityApp(options = {}) {
    const storage = options.storage ?? new InMemoryCommunityStorage();
    const maxSb3Bytes = options.maxSb3Bytes ?? DEFAULT_MAX_SB3_BYTES;
    const maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    const oauthProviders = options.oauthProviders ?? readOAuthProvidersFromEnv(process.env);
    const app = new Hono();
    app.get('/', async (c) => {
        const session = await ensureSession(c, storage);
        const user = await readCurrentUser(storage, session);
        const projects = await storage.listProjects();
        return html(c, renderLayout('Community Projects', renderProjectList(projects, user, session.csrfToken)));
    });
    app.get('/signup', async (c) => {
        const session = await ensureSession(c, storage);
        return html(c, renderLayout('Sign up', renderSignupForm(session.csrfToken)));
    });
    app.post('/signup', async (c) => {
        const session = await ensureSession(c, storage);
        const form = await c.req.parseBody();
        if (!verifyCsrf(form, session))
            return forbidden(c, 'CSRF token mismatch.');
        const username = readTextField(form, 'username').trim();
        const password = readTextField(form, 'password');
        if (!isValidUsername(username) || password.length < 8) {
            return html(c, renderLayout('Sign up', renderSignupForm(session.csrfToken, 'Use a username and an 8+ character password.')), 400);
        }
        if (await storage.findUserByUsername(username)) {
            return html(c, renderLayout('Sign up', renderSignupForm(session.csrfToken, 'That username is already taken.')), 409);
        }
        const user = await storage.createUser({
            username,
            passwordHash: await hashPassword(password)
        });
        await setSessionUser(storage, session, user.id);
        return redirect(c, '/');
    });
    app.get('/login', async (c) => {
        const session = await ensureSession(c, storage);
        return html(c, renderLayout('Log in', renderLoginForm(session.csrfToken)));
    });
    app.post('/login', async (c) => {
        const session = await ensureSession(c, storage);
        const form = await c.req.parseBody();
        if (!verifyCsrf(form, session))
            return forbidden(c, 'CSRF token mismatch.');
        const username = readTextField(form, 'username').trim();
        const password = readTextField(form, 'password');
        const user = await storage.findUserByUsername(username);
        if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
            return html(c, renderLayout('Log in', renderLoginForm(session.csrfToken, 'Invalid username or password.')), 401);
        }
        await setSessionUser(storage, session, user.id);
        return redirect(c, '/');
    });
    app.post('/logout', async (c) => {
        const session = await ensureSession(c, storage);
        const form = await c.req.parseBody();
        if (!verifyCsrf(form, session))
            return forbidden(c, 'CSRF token mismatch.');
        await storage.deleteSession(session.id);
        clearSessionCookie(c);
        return redirect(c, '/login');
    });
    app.get('/auth/:provider/start', async (c) => {
        const providerName = c.req.param('provider');
        const provider = oauthProviders[providerName];
        if (!provider)
            return c.json({ error: 'oauth_provider_disabled' }, 404);
        const session = await ensureSession(c, storage);
        const state = randomToken();
        session.oauthState = state;
        session.oauthProvider = providerName;
        await storage.saveSession(session);
        const authorizationUrl = new URL(provider.authorizationUrl);
        authorizationUrl.searchParams.set('response_type', 'code');
        authorizationUrl.searchParams.set('client_id', provider.clientId);
        authorizationUrl.searchParams.set('state', state);
        authorizationUrl.searchParams.set('redirect_uri', provider.redirectUri ?? new URL(`/auth/${providerName}/callback`, c.req.url).toString());
        if (provider.scope)
            authorizationUrl.searchParams.set('scope', provider.scope);
        return redirect(c, authorizationUrl.toString());
    });
    app.get('/auth/:provider/callback', async (c) => {
        const providerName = c.req.param('provider');
        const provider = oauthProviders[providerName];
        if (!provider)
            return c.json({ error: 'oauth_provider_disabled' }, 404);
        const session = await ensureSession(c, storage);
        if (session.oauthProvider !== providerName || c.req.query('state') !== session.oauthState) {
            return forbidden(c, 'OAuth state mismatch.');
        }
        const subject = c.req.query('subject') ?? c.req.query('user') ?? c.req.query('code');
        if (!subject)
            return c.json({ error: 'oauth_subject_required' }, 400);
        const existing = await storage.findUserByOAuth(providerName, subject);
        const user = existing ??
            (await storage.createUser({
                username: uniqueOAuthUsername(providerName, subject),
                oauthProvider: providerName,
                oauthSubject: subject
            }));
        session.oauthProvider = undefined;
        session.oauthState = undefined;
        await setSessionUser(storage, session, user.id);
        return redirect(c, '/');
    });
    app.post('/projects', async (c) => {
        const session = await ensureSession(c, storage);
        const user = await requireUser(c, storage, session);
        if (!user)
            return c.json({ error: 'login_required' }, 401);
        const form = await readMultipartFormWithLimit(c.req.raw, maxSb3Bytes + maxImageBytes + DEFAULT_MAX_UPLOAD_FORM_OVERHEAD_BYTES);
        if (!form.ok)
            return c.json({ error: form.error }, form.status);
        if (!verifyCsrf(form.fields, session))
            return forbidden(c, 'CSRF token mismatch.');
        const sb3File = readFileField(form.fields, 'sb3');
        const sb3Validation = await validateSb3File(sb3File, maxSb3Bytes);
        if (!sb3Validation.ok)
            return c.json({ error: sb3Validation.error }, sb3Validation.status);
        const thumbnailFile = readFileField(form.fields, 'thumbnail');
        const thumbnailValidation = await validateOptionalImageFile(thumbnailFile, maxImageBytes);
        if (!thumbnailValidation.ok)
            return c.json({ error: thumbnailValidation.error }, thumbnailValidation.status);
        const project = await storage.createProject({
            ownerId: user.id,
            title: sanitizeTitle(readTextField(form.fields, 'title')),
            description: readTextField(form.fields, 'description').slice(0, 2000),
            sb3Bytes: sb3Validation.bytes,
            sb3FileName: sb3Validation.fileName,
            sb3MimeType: sb3Validation.mimeType,
            ...thumbnailValidation.thumbnail
        });
        return redirect(c, `/projects/${project.id}`, 303);
    });
    app.get('/projects/:downloadId{[A-Za-z0-9_-]+\\.sb3}', async (c) => {
        const projectId = c.req.param('downloadId').slice(0, -'.sb3'.length);
        const project = await storage.findProjectById(projectId);
        if (!project)
            return c.json({ error: 'not_found' }, 404);
        return new Response(toArrayBuffer(project.sb3Bytes), {
            status: 200,
            headers: {
                'Content-Type': project.sb3MimeType,
                'Content-Length': String(project.sb3Bytes.byteLength),
                'Content-Disposition': `attachment; filename="${escapeHeaderFileName(project.sb3FileName)}"`,
                'Cache-Control': 'no-store'
            }
        });
    });
    app.get('/projects/:id', async (c) => {
        const session = await ensureSession(c, storage);
        const user = await readCurrentUser(storage, session);
        const project = await storage.findProjectById(c.req.param('id'));
        if (!project)
            return c.json({ error: 'not_found' }, 404);
        return html(c, renderLayout(project.title, renderProjectDetail(project, user, session.csrfToken)));
    });
    app.post('/projects/:id/remix', async (c) => {
        const session = await ensureSession(c, storage);
        const user = await requireUser(c, storage, session);
        if (!user)
            return c.json({ error: 'login_required' }, 401);
        const form = await c.req.parseBody();
        if (!verifyCsrf(form, session))
            return forbidden(c, 'CSRF token mismatch.');
        const original = await storage.findProjectById(c.req.param('id'));
        if (!original)
            return c.json({ error: 'not_found' }, 404);
        const remixInput = {
            ownerId: user.id,
            title: sanitizeTitle(readTextField(form, 'title') || `${original.title} remix`),
            description: readTextField(form, 'description') || `Remix of ${original.title}`,
            sb3Bytes: original.sb3Bytes.slice(),
            sb3FileName: original.sb3FileName,
            sb3MimeType: original.sb3MimeType,
            remixOfProjectId: original.id
        };
        if (original.thumbnailBytes)
            remixInput.thumbnailBytes = original.thumbnailBytes.slice();
        if (original.thumbnailFileName)
            remixInput.thumbnailFileName = original.thumbnailFileName;
        if (original.thumbnailMimeType)
            remixInput.thumbnailMimeType = original.thumbnailMimeType;
        const project = await storage.createProject(remixInput);
        return redirect(c, `/projects/${project.id}`, 303);
    });
    app.post('/projects/:id/update', async (c) => {
        const session = await ensureSession(c, storage);
        const user = await requireUser(c, storage, session);
        if (!user)
            return c.json({ error: 'login_required' }, 401);
        const form = await c.req.parseBody();
        if (!verifyCsrf(form, session))
            return forbidden(c, 'CSRF token mismatch.');
        const project = await storage.findProjectById(c.req.param('id'));
        if (!project)
            return c.json({ error: 'not_found' }, 404);
        if (project.ownerId !== user.id)
            return forbidden(c, 'Only the project owner can edit this project.');
        project.title = sanitizeTitle(readTextField(form, 'title'));
        project.description = readTextField(form, 'description').slice(0, 2000);
        await storage.saveProject(project);
        return redirect(c, `/projects/${project.id}`, 303);
    });
    app.post('/projects/:id/replace', async (c) => {
        const session = await ensureSession(c, storage);
        const user = await requireUser(c, storage, session);
        if (!user)
            return c.json({ error: 'login_required' }, 401);
        const form = await readMultipartFormWithLimit(c.req.raw, maxSb3Bytes + maxImageBytes + DEFAULT_MAX_UPLOAD_FORM_OVERHEAD_BYTES);
        if (!form.ok)
            return c.json({ error: form.error }, form.status);
        if (!verifyCsrf(form.fields, session))
            return forbidden(c, 'CSRF token mismatch.');
        const project = await storage.findProjectById(c.req.param('id'));
        if (!project)
            return c.json({ error: 'not_found' }, 404);
        if (project.ownerId !== user.id)
            return forbidden(c, 'Only the project owner can replace this project.');
        const sb3File = readFileField(form.fields, 'sb3');
        const sb3Validation = await validateSb3File(sb3File, maxSb3Bytes);
        if (!sb3Validation.ok)
            return c.json({ error: sb3Validation.error }, sb3Validation.status);
        const thumbnailFile = readFileField(form.fields, 'thumbnail');
        const thumbnailValidation = await validateOptionalImageFile(thumbnailFile, maxImageBytes);
        if (!thumbnailValidation.ok)
            return c.json({ error: thumbnailValidation.error }, thumbnailValidation.status);
        project.sb3Bytes = sb3Validation.bytes;
        project.sb3FileName = sb3Validation.fileName;
        project.sb3MimeType = sb3Validation.mimeType;
        const thumbnail = thumbnailValidation.thumbnail;
        if (thumbnail.thumbnailBytes && thumbnail.thumbnailFileName && thumbnail.thumbnailMimeType) {
            project.thumbnailBytes = thumbnail.thumbnailBytes;
            project.thumbnailFileName = thumbnail.thumbnailFileName;
            project.thumbnailMimeType = thumbnail.thumbnailMimeType;
        }
        await storage.saveProject(project);
        return redirect(c, `/projects/${project.id}`, 303);
    });
    app.post('/projects/:id/delete', async (c) => {
        const session = await ensureSession(c, storage);
        const user = await requireUser(c, storage, session);
        if (!user)
            return c.json({ error: 'login_required' }, 401);
        const form = await c.req.parseBody();
        if (!verifyCsrf(form, session))
            return forbidden(c, 'CSRF token mismatch.');
        const project = await storage.findProjectById(c.req.param('id'));
        if (!project)
            return c.json({ error: 'not_found' }, 404);
        if (project.ownerId !== user.id)
            return forbidden(c, 'Only the project owner can delete this project.');
        await storage.deleteProject(project.id);
        return redirect(c, '/', 303);
    });
    return app;
}
export class InMemoryCommunityStorage {
    constructor() {
        this.userSequence = 1;
        this.projectSequence = 1;
        this.users = new Map();
        this.sessions = new Map();
        this.projects = new Map();
    }
    async createUser(input) {
        const user = {
            ...input,
            id: `user-${this.userSequence}`,
            createdAt: new Date().toISOString()
        };
        this.userSequence += 1;
        this.users.set(user.id, user);
        return user;
    }
    async findUserByUsername(username) {
        return Array.from(this.users.values()).find((user) => user.username === username) ?? null;
    }
    async findUserById(id) {
        return this.users.get(id) ?? null;
    }
    async findUserByOAuth(provider, subject) {
        return (Array.from(this.users.values()).find((user) => user.oauthProvider === provider && user.oauthSubject === subject) ?? null);
    }
    async createSession(input) {
        const session = {
            ...input,
            id: randomToken()
        };
        this.sessions.set(session.id, session);
        return session;
    }
    async getSession(id) {
        const session = this.sessions.get(id);
        if (!session)
            return null;
        if (session.expiresAt <= Date.now()) {
            this.sessions.delete(id);
            return null;
        }
        return session;
    }
    async saveSession(session) {
        this.sessions.set(session.id, session);
    }
    async deleteSession(id) {
        this.sessions.delete(id);
    }
    async createProject(input) {
        const now = new Date().toISOString();
        const project = {
            ...input,
            id: `project-${this.projectSequence}`,
            createdAt: now,
            updatedAt: now
        };
        this.projectSequence += 1;
        this.projects.set(project.id, project);
        return project;
    }
    async findProjectById(id) {
        return this.projects.get(id) ?? null;
    }
    async listProjects() {
        return Array.from(this.projects.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    async saveProject(project) {
        this.projects.set(project.id, { ...project, updatedAt: new Date().toISOString() });
    }
    async deleteProject(id) {
        return this.projects.delete(id);
    }
}
export function readOAuthProvidersFromEnv(env) {
    const providers = {};
    for (const [name, value] of Object.entries(env)) {
        const match = /^COMMUNITY_OAUTH_([A-Z0-9_]+)_CLIENT_ID$/.exec(name);
        if (!match || !value)
            continue;
        const providerKey = match[1]?.toLowerCase().replace(/_/g, '-');
        if (!providerKey)
            continue;
        const envPrefix = `COMMUNITY_OAUTH_${match[1]}`;
        const authorizationUrl = env[`${envPrefix}_AUTHORIZATION_URL`];
        if (!authorizationUrl)
            continue;
        const config = {
            clientId: value,
            authorizationUrl
        };
        const redirectUri = env[`${envPrefix}_REDIRECT_URI`];
        const scope = env[`${envPrefix}_SCOPE`];
        if (redirectUri)
            config.redirectUri = redirectUri;
        if (scope)
            config.scope = scope;
        providers[providerKey] = config;
    }
    return providers;
}
async function ensureSession(c, storage) {
    const sessionId = readCookie(c.req.header('Cookie') ?? '', SESSION_COOKIE);
    const existing = sessionId ? await storage.getSession(sessionId) : null;
    if (existing)
        return existing;
    const session = await storage.createSession({
        csrfToken: randomToken(),
        expiresAt: Date.now() + DEFAULT_SESSION_MAX_AGE_SECONDS * 1000
    });
    setSessionCookie(c, session.id);
    return session;
}
async function setSessionUser(storage, session, userId) {
    session.userId = userId;
    session.csrfToken = randomToken();
    session.expiresAt = Date.now() + DEFAULT_SESSION_MAX_AGE_SECONDS * 1000;
    await storage.saveSession(session);
}
async function readCurrentUser(storage, session) {
    return session.userId ? storage.findUserById(session.userId) : null;
}
async function requireUser(c, storage, session) {
    const user = await readCurrentUser(storage, session);
    if (!user)
        clearSessionCookie(c);
    return user;
}
async function hashPassword(password) {
    const salt = randomToken();
    const derived = (await scrypt(password, salt, 64));
    return `${PASSWORD_HASH_PREFIX}:${salt}:${derived.toString('base64url')}`;
}
async function verifyPassword(password, storedHash) {
    const [prefix, salt, expected] = storedHash.split(':');
    if (prefix !== PASSWORD_HASH_PREFIX || !salt || !expected)
        return false;
    const actual = (await scrypt(password, salt, 64));
    const expectedBuffer = Buffer.from(expected, 'base64url');
    return actual.byteLength === expectedBuffer.byteLength && timingSafeEqual(actual, expectedBuffer);
}
function verifyCsrf(form, session) {
    return readTextField(form, 'csrf') === session.csrfToken;
}
function readTextField(form, name) {
    const value = form[name];
    return typeof value === 'string' ? value : '';
}
function readFileField(form, name) {
    const value = form[name];
    return typeof value === 'object' && value instanceof File ? value : null;
}
async function readMultipartFormWithLimit(request, maxBytes) {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
        return { ok: false, error: 'multipart_required', status: 415 };
    }
    const contentLength = parseContentLength(request.headers.get('content-length'));
    if (contentLength !== null && contentLength > maxBytes) {
        return { ok: false, error: 'upload_body_too_large', status: 413 };
    }
    const body = await readBodyWithLimit(request, maxBytes);
    if (!body)
        return { ok: false, error: 'upload_body_too_large', status: 413 };
    let formData;
    try {
        formData = await new Response(body, {
            headers: { 'Content-Type': contentType }
        }).formData();
    }
    catch {
        return { ok: false, error: 'multipart_invalid', status: 400 };
    }
    return { ok: true, fields: Object.fromEntries(formData.entries()) };
}
async function readBodyWithLimit(request, maxBytes) {
    if (!request.body)
        return new ArrayBuffer(0);
    const reader = request.body.getReader();
    const chunks = [];
    let byteLength = 0;
    try {
        for (;;) {
            const result = await reader.read();
            if (result.done)
                break;
            byteLength += result.value.byteLength;
            if (byteLength > maxBytes) {
                await reader.cancel();
                return null;
            }
            chunks.push(result.value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const body = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return toArrayBuffer(body);
}
function parseContentLength(value) {
    if (value === null)
        return null;
    const length = Number.parseInt(value, 10);
    return Number.isSafeInteger(length) && length >= 0 ? length : null;
}
async function validateSb3File(file, maxBytes) {
    if (!file)
        return { ok: false, error: 'sb3_required', status: 400 };
    if (file.size > maxBytes)
        return { ok: false, error: 'sb3_too_large', status: 413 };
    if (!file.name.toLowerCase().endsWith('.sb3'))
        return { ok: false, error: 'sb3_extension_required', status: 415 };
    if (!SB3_MIME_TYPES.has(normalizeMimeType(file.type)))
        return { ok: false, error: 'sb3_mime_type_rejected', status: 415 };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!hasZipSignature(bytes))
        return { ok: false, error: 'sb3_zip_signature_required', status: 415 };
    return { ok: true, bytes, fileName: file.name, mimeType: normalizeMimeType(file.type) };
}
async function validateOptionalImageFile(file, maxBytes) {
    if (!file || file.size === 0)
        return { ok: true, thumbnail: {} };
    if (file.size > maxBytes)
        return { ok: false, error: 'thumbnail_too_large', status: 413 };
    const mimeType = normalizeMimeType(file.type);
    if (!IMAGE_MIME_TYPES.has(mimeType))
        return { ok: false, error: 'thumbnail_mime_type_rejected', status: 415 };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!matchesImageSignature(bytes, mimeType))
        return { ok: false, error: 'thumbnail_signature_rejected', status: 415 };
    return {
        ok: true,
        thumbnail: {
            thumbnailBytes: bytes,
            thumbnailFileName: file.name,
            thumbnailMimeType: mimeType
        }
    };
}
function hasZipSignature(bytes) {
    return bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2] ?? -1) && bytes[3] !== undefined;
}
function matchesImageSignature(bytes, mimeType) {
    if (mimeType === 'image/png') {
        return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    }
    if (mimeType === 'image/jpeg')
        return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (mimeType === 'image/gif') {
        return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
    }
    if (mimeType === 'image/webp') {
        return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    }
    return false;
}
function normalizeMimeType(value) {
    return value.split(';', 1)[0]?.trim().toLowerCase() || 'application/octet-stream';
}
function sanitizeTitle(value) {
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, 120) : 'Untitled project';
}
function isValidUsername(value) {
    return /^[A-Za-z0-9_-]{3,32}$/.test(value);
}
function uniqueOAuthUsername(provider, subject) {
    return `${provider}-${subject}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32) || `${provider}-user`;
}
function html(c, body, status = 200) {
    return c.html(body, status);
}
function forbidden(c, message) {
    return c.json({ error: 'forbidden', message }, 403);
}
function redirect(c, location, status = 302) {
    return c.redirect(location, status);
}
function setSessionCookie(c, sessionId) {
    c.header('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEFAULT_SESSION_MAX_AGE_SECONDS}`);
}
function clearSessionCookie(c) {
    c.header('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
function readCookie(cookieHeader, name) {
    for (const part of cookieHeader.split(';')) {
        const [rawName, ...rawValue] = part.trim().split('=');
        if (rawName === name)
            return decodeURIComponent(rawValue.join('='));
    }
    return null;
}
function randomToken() {
    return randomBytes(32).toString('base64url');
}
function toArrayBuffer(bytes) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
function escapeHtml(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeHeaderFileName(value) {
    return value.replace(/\\/g, '_').replace(/"/g, '_').replace(/\r/g, '_').replace(/\n/g, '_');
}
function renderLayout(title, body) {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; line-height: 1.5; margin: 2rem auto; max-width: 880px; padding: 0 1rem; }
    header, article, form { margin-bottom: 1.5rem; }
    label { display: block; margin: 0.75rem 0; }
    input, textarea { box-sizing: border-box; display: block; max-width: 32rem; padding: 0.45rem; width: 100%; }
    button, a.button { display: inline-block; margin-right: 0.5rem; padding: 0.45rem 0.75rem; }
    article { border: 1px solid #ddd; border-radius: 6px; padding: 1rem; }
    .error { color: #9f1239; }
  </style>
</head>
<body>
  <header><h1>${escapeHtml(title)}</h1><nav><a href="/">Projects</a> <a href="/signup">Sign up</a> <a href="/login">Log in</a></nav></header>
  ${body}
</body>
</html>`;
}
function renderProjectList(projects, user, csrfToken) {
    const form = user
        ? `<section>
  <h2>Share a project</h2>
  <form action="/projects" method="post" enctype="multipart/form-data">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <label>Title <input name="title" required></label>
    <label>Description <textarea name="description"></textarea></label>
    <label>SB3 file <input name="sb3" type="file" accept=".sb3,application/x.scratch.sb3,application/zip" required></label>
    <label>Thumbnail <input name="thumbnail" type="file" accept="image/png,image/jpeg,image/gif,image/webp"></label>
    <button type="submit">Publish</button>
  </form>
</section>`
        : '<p><a href="/login">Log in</a> to share a project.</p>';
    const items = projects.length === 0
        ? '<p>No projects yet.</p>'
        : projects
            .map((project) => `<article>
  <h2><a href="/projects/${escapeHtml(project.id)}">${escapeHtml(project.title)}</a></h2>
  <p>${escapeHtml(project.description)}</p>
  ${project.remixOfProjectId ? `<p>Remix of <a href="/projects/${escapeHtml(project.remixOfProjectId)}">${escapeHtml(project.remixOfProjectId)}</a></p>` : ''}
</article>`)
            .join('');
    return `${form}<section>${items}</section>`;
}
function renderSignupForm(csrfToken, error = '') {
    return `<form action="/signup" method="post">
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
  <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
  <label>Username <input name="username" autocomplete="username" required></label>
  <label>Password <input name="password" type="password" autocomplete="new-password" required></label>
  <button type="submit">Create account</button>
</form>`;
}
function renderLoginForm(csrfToken, error = '') {
    return `<form action="/login" method="post">
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
  <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
  <label>Username <input name="username" autocomplete="username" required></label>
  <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">Log in</button>
</form>
<p><a href="/auth/demo/start">Try configured OAuth demo provider</a></p>`;
}
function renderProjectDetail(project, user, csrfToken) {
    const ownerControls = user?.id === project.ownerId
        ? `<form action="/projects/${escapeHtml(project.id)}/update" method="post">
  <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
  <label>Title <input name="title" value="${escapeHtml(project.title)}" required></label>
  <label>Description <textarea name="description">${escapeHtml(project.description)}</textarea></label>
  <button type="submit">Save</button>
</form>
<form action="/projects/${escapeHtml(project.id)}/replace" method="post" enctype="multipart/form-data">
  <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
  <label>SB3 file <input name="sb3" type="file" accept=".sb3,application/x.scratch.sb3,application/zip" required></label>
  <label>Thumbnail <input name="thumbnail" type="file" accept="image/png,image/jpeg,image/gif,image/webp"></label>
  <button type="submit">Replace SB3</button>
</form>
<form action="/projects/${escapeHtml(project.id)}/delete" method="post">
  <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
  <button type="submit">Delete</button>
</form>`
        : '';
    const remixForm = user
        ? `<form action="/projects/${escapeHtml(project.id)}/remix" method="post">
  <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
  <label>Remix title <input name="title" value="${escapeHtml(`${project.title} remix`)}"></label>
  <button type="submit">Create remix</button>
</form>`
        : '<p>Log in to remix this project.</p>';
    return `<article>
  <p>${escapeHtml(project.description)}</p>
  ${project.remixOfProjectId ? `<p>Remix of <a href="/projects/${escapeHtml(project.remixOfProjectId)}">${escapeHtml(project.remixOfProjectId)}</a></p>` : ''}
  <p><a href="/projects/${escapeHtml(project.id)}.sb3">Download SB3</a></p>
</article>
${remixForm}
${ownerControls}`;
}
//# sourceMappingURL=community.js.map