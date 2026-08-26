import {describe, expect, it} from 'vitest';
import {createCommunityApp, InMemoryCommunityStorage} from '../src/community.js';
import {createApp} from '../src/server.js';

const sb3Bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]);

describe('Scratch-like community app', () => {
  it('keeps community routes disabled unless explicitly configured', async () => {
    const response = await createApp().request('/');

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({error: 'not_connected'});
  });

  it('creates password users without storing plaintext passwords and logs in with a session cookie', async () => {
    const storage = new InMemoryCommunityStorage();
    const app = createCommunityApp({storage});
    const signupPage = await app.request('/signup');
    const signupCookie = readSetCookie(signupPage);
    const signupCsrf = await readCsrf(signupPage);

    const signup = await app.request('/signup', {
      method: 'POST',
      headers: {Cookie: signupCookie},
      body: formData({
        csrf: signupCsrf,
        username: 'alice',
        password: 'password123'
      })
    });

    const user = await storage.findUserByUsername('alice');
    expect(signup.status).toBe(302);
    expect(user?.passwordHash).toMatch(/^scrypt:/);
    expect(user?.passwordHash).not.toContain('password123');

    const loginPage = await app.request('/login');
    const loginCookie = readSetCookie(loginPage);
    const loginCsrf = await readCsrf(loginPage);
    const login = await app.request('/login', {
      method: 'POST',
      headers: {Cookie: loginCookie},
      body: formData({
        csrf: loginCsrf,
        username: 'alice',
        password: 'password123'
      })
    });

    expect(login.status).toBe(302);
    expect(login.headers.get('location')).toBe('/');
  });

  it('rejects POST forms with missing CSRF tokens', async () => {
    const storage = new InMemoryCommunityStorage();
    const app = createCommunityApp({storage});
    const signupPage = await app.request('/signup');
    const cookie = readSetCookie(signupPage);

    const response = await app.request('/signup', {
      method: 'POST',
      headers: {Cookie: cookie},
      body: formData({
        username: 'alice',
        password: 'password123'
      })
    });

    expect(response.status).toBe(403);
  });

  it('keeps OAuth routes disabled until a provider is configured', async () => {
    const app = createCommunityApp({oauthProviders: {}});

    const response = await app.request('/auth/demo/start');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({error: 'oauth_provider_disabled'});
  });

  it('starts and completes the configured OAuth demo flow', async () => {
    const storage = new InMemoryCommunityStorage();
    const app = createCommunityApp({
      storage,
      oauthProviders: {
        demo: {
          clientId: 'demo-client',
          authorizationUrl: 'https://example.test/oauth/authorize',
          redirectUri: 'http://localhost/auth/demo/callback',
          scope: 'profile'
        }
      }
    });

    const start = await app.request('/auth/demo/start');
    const cookie = readSetCookie(start);
    const redirectUrl = new URL(start.headers.get('location') ?? '');
    const state = redirectUrl.searchParams.get('state') ?? '';

    expect(start.status).toBe(302);
    expect(redirectUrl.origin).toBe('https://example.test');
    expect(redirectUrl.searchParams.get('client_id')).toBe('demo-client');

    const callback = await app.request(`/auth/demo/callback?state=${encodeURIComponent(state)}&subject=oauth-user`, {
      headers: {Cookie: cookie}
    });
    const user = await storage.findUserByOAuth('demo', 'oauth-user');

    expect(callback.status).toBe(302);
    expect(user?.username).toBe('demo-oauth-user');
  });

  it('stores only valid SB3 uploads and optional image thumbnails', async () => {
    const storage = new InMemoryCommunityStorage();
    const app = createCommunityApp({storage});
    const cookie = await signup(app, 'owner');
    const projectsPage = await app.request('/', {headers: {Cookie: cookie}});
    const csrf = await readCsrf(projectsPage);

    const response = await app.request('/projects', {
      method: 'POST',
      headers: {Cookie: cookie},
      body: formData({
        csrf,
        title: 'Maze',
        description: 'A small game',
        sb3: new File([sb3Bytes], 'maze.sb3', {type: 'application/x.scratch.sb3'}),
        thumbnail: new File([pngBytes], 'thumb.png', {type: 'image/png'})
      })
    });
    const projects = await storage.listProjects();

    expect(response.status).toBe(303);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.title).toBe('Maze');
    expect(projects[0]?.thumbnailMimeType).toBe('image/png');
  });

  it('rejects SB3 uploads over size limits or with mismatched MIME data', async () => {
    const app = createCommunityApp({maxSb3Bytes: 4});
    const cookie = await signup(app, 'owner');
    const projectsPage = await app.request('/', {headers: {Cookie: cookie}});
    const csrf = await readCsrf(projectsPage);

    const tooLarge = await app.request('/projects', {
      method: 'POST',
      headers: {Cookie: cookie},
      body: formData({
        csrf,
        title: 'Large',
        sb3: new File([sb3Bytes], 'large.sb3', {type: 'application/x.scratch.sb3'})
      })
    });
    const mimeApp = createCommunityApp();
    const mimeCookie = await signup(mimeApp, 'mimeowner');
    const mimeCsrf = await readCsrf(await mimeApp.request('/', {headers: {Cookie: mimeCookie}}));
    const badMime = await mimeApp.request('/projects', {
      method: 'POST',
      headers: {Cookie: mimeCookie},
      body: formData({
        csrf: mimeCsrf,
        title: 'Bad',
        sb3: new File([sb3Bytes], 'bad.sb3', {type: 'text/plain'})
      })
    });

    expect(tooLarge.status).toBe(413);
    expect(badMime.status).toBe(415);
  });

  it('rejects oversized multipart uploads before parsing files', async () => {
    const app = createCommunityApp({maxSb3Bytes: 4, maxImageBytes: 4});
    const cookie = await signup(app, 'owner');

    const response = await app.request('/projects', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'multipart/form-data; boundary=test',
        'Content-Length': '999999'
      },
      body: '--test--\r\n'
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({error: 'upload_body_too_large'});
  });

  it('allows only the owner to delete and records remix relationships', async () => {
    const storage = new InMemoryCommunityStorage();
    const app = createCommunityApp({storage});
    const ownerCookie = await signup(app, 'owner');
    const otherCookie = await signup(app, 'other');
    const ownerCsrf = await readCsrf(await app.request('/', {headers: {Cookie: ownerCookie}}));
    await app.request('/projects', {
      method: 'POST',
      headers: {Cookie: ownerCookie},
      body: formData({
        csrf: ownerCsrf,
        title: 'Original',
        sb3: new File([sb3Bytes], 'original.sb3', {type: 'application/x.scratch.sb3'})
      })
    });
    const original = (await storage.listProjects())[0];
    expect(original).toBeDefined();

    const otherCsrf = await readCsrf(await app.request(`/projects/${original?.id}`, {headers: {Cookie: otherCookie}}));
    const rejectedDelete = await app.request(`/projects/${original?.id}/delete`, {
      method: 'POST',
      headers: {Cookie: otherCookie},
      body: formData({csrf: otherCsrf})
    });
    const remix = await app.request(`/projects/${original?.id}/remix`, {
      method: 'POST',
      headers: {Cookie: otherCookie},
      body: formData({csrf: otherCsrf, title: 'Other remix'})
    });
    const projects = await storage.listProjects();
    const remixProject = projects.find((project) => project.remixOfProjectId === original?.id);

    expect(rejectedDelete.status).toBe(403);
    expect(remix.status).toBe(303);
    expect(remixProject?.title).toBe('Other remix');
  });

  it('allows only the owner to edit metadata and replace SB3 bytes', async () => {
    const storage = new InMemoryCommunityStorage();
    const app = createCommunityApp({storage});
    const ownerCookie = await signup(app, 'owner');
    const otherCookie = await signup(app, 'other');
    const ownerCsrf = await readCsrf(await app.request('/', {headers: {Cookie: ownerCookie}}));
    await app.request('/projects', {
      method: 'POST',
      headers: {Cookie: ownerCookie},
      body: formData({
        csrf: ownerCsrf,
        title: 'Original',
        description: 'First version',
        sb3: new File([sb3Bytes], 'original.sb3', {type: 'application/x.scratch.sb3'})
      })
    });
    const project = (await storage.listProjects())[0];
    expect(project).toBeDefined();

    const otherCsrf = await readCsrf(await app.request(`/projects/${project?.id}`, {headers: {Cookie: otherCookie}}));
    const rejectedUpdate = await app.request(`/projects/${project?.id}/update`, {
      method: 'POST',
      headers: {Cookie: otherCookie},
      body: formData({csrf: otherCsrf, title: 'Hijack'})
    });
    const rejectedReplace = await app.request(`/projects/${project?.id}/replace`, {
      method: 'POST',
      headers: {Cookie: otherCookie},
      body: formData({
        csrf: otherCsrf,
        sb3: new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff])], 'other.sb3', {
          type: 'application/x.scratch.sb3'
        })
      })
    });
    const freshOwnerCsrf = await readCsrf(await app.request(`/projects/${project?.id}`, {headers: {Cookie: ownerCookie}}));
    const update = await app.request(`/projects/${project?.id}/update`, {
      method: 'POST',
      headers: {Cookie: ownerCookie},
      body: formData({csrf: freshOwnerCsrf, title: 'Updated', description: 'Second version'})
    });
    const replace = await app.request(`/projects/${project?.id}/replace`, {
      method: 'POST',
      headers: {Cookie: ownerCookie},
      body: formData({
        csrf: freshOwnerCsrf,
        sb3: new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff])], 'updated.sb3', {
          type: 'application/x.scratch.sb3'
        })
      })
    });
    const updated = await storage.findProjectById(project?.id ?? '');

    expect(rejectedUpdate.status).toBe(403);
    expect(rejectedReplace.status).toBe(403);
    expect(update.status).toBe(303);
    expect(replace.status).toBe(303);
    expect(updated?.title).toBe('Updated');
    expect(updated?.description).toBe('Second version');
    expect(updated?.sb3FileName).toBe('updated.sb3');
    expect(updated?.sb3Bytes).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff]));
  });

  it('downloads SB3 project bytes with an attachment response', async () => {
    const app = createCommunityApp();
    const cookie = await signup(app, 'owner');
    const csrf = await readCsrf(await app.request('/', {headers: {Cookie: cookie}}));
    await app.request('/projects', {
      method: 'POST',
      headers: {Cookie: cookie},
      body: formData({
        csrf,
        title: 'Downloadable',
        sb3: new File([sb3Bytes], 'download.sb3', {type: 'application/x.scratch.sb3'})
      })
    });

    const download = await app.request('/projects/project-1.sb3');

    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="download.sb3"');
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(sb3Bytes);
  });
});

async function signup(app: ReturnType<typeof createCommunityApp>, username: string): Promise<string> {
  const page = await app.request('/signup');
  const cookie = readSetCookie(page);
  const csrf = await readCsrf(page);
  await app.request('/signup', {
    method: 'POST',
    headers: {Cookie: cookie},
    body: formData({
      csrf,
      username,
      password: 'password123'
    })
  });
  return cookie;
}

function formData(fields: Record<string, string | File>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.set(name, value);
  }
  return form;
}

async function readCsrf(response: Response): Promise<string> {
  const html = await response.text();
  return /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';
}

function readSetCookie(response: Response): string {
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}
