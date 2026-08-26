import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
const sb3Bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

const examples = [
  {
    path: 'examples/01-hello-form/server.mjs',
    port: 9101,
    checks: async (base) => {
      await expectStatus(`${base}/`, 200);
      await expectStatus(`${base}/hello`, 200, {
        method: 'POST',
        headers: {'content-type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({name: '太郎'})
      });
    }
  },
  {
    path: 'examples/02-visitor-counter/server.mjs',
    port: 9102,
    checks: async (base) => {
      await expectStatus(`${base}/`, 200);
      await expectStatus(`${base}/api/count`, 200);
    }
  },
  {
    path: 'examples/03-message-board/server.mjs',
    port: 9103,
    checks: async (base) => {
      await expectStatus(`${base}/`, 200);
      await expectStatus(`${base}/messages`, 303, {
        method: 'POST',
        headers: {'content-type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({name: 'Alice', message: 'hello'}),
        redirect: 'manual'
      });
      await expectStatus(`${base}/api/messages`, 200);
    }
  },
  {
    path: 'examples/04-image-upload/server.mjs',
    port: 9104,
    checks: async (base) => {
      await expectStatus(`${base}/`, 200);
      const valid = new FormData();
      valid.set('name', 'sample');
      valid.set('image', new File([pngBytes], 'sample.png', {type: 'image/png'}));
      await expectStatus(`${base}/upload`, 303, {method: 'POST', body: valid, redirect: 'manual'});
      await expectStatus(`${base}/@assets/sample`, 200);

      const invalid = new FormData();
      invalid.set('name', 'bad');
      invalid.set('image', new File([new Uint8Array([0x00, 0x01])], 'bad.png', {type: 'image/png'}));
      await expectStatus(`${base}/upload`, 415, {method: 'POST', body: invalid, redirect: 'manual'});
    }
  },
  {
    path: 'examples/05-live-camera/server.mjs',
    port: 9105,
    checks: async (base) => {
      await expectStatus(`${base}/camera`, 200);
      await expectStatus(`${base}/@assets/live-camera`, 200);
      await expectStatus(`${base}/camera/frame`, 303, {
        method: 'POST',
        headers: {'content-type': 'image/jpeg'},
        body: jpegBytes,
        redirect: 'manual'
      });
      await expectStatus(`${base}/camera/frame`, 415, {
        method: 'POST',
        headers: {'content-type': 'image/jpeg'},
        body: new Uint8Array([0x00, 0x01]),
        redirect: 'manual'
      });
    }
  },
  {
    path: 'examples/06-scratch-like-community/server.mjs',
    port: 9106,
    checks: async (base) => {
      const signupPage = await fetch(`${base}/signup`);
      if (signupPage.status !== 200) throw new Error(`signup page status ${signupPage.status}`);
      const cookie = signupPage.headers.get('set-cookie')?.split(';')[0] ?? '';
      const csrf = /name="csrf" value="([^"]+)"/.exec(await signupPage.text())?.[1] ?? '';
      const signup = await expectStatus(`${base}/signup`, 302, {
        method: 'POST',
        headers: {cookie, 'content-type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({csrf, username: 'alice', password: 'password123'}),
        redirect: 'manual'
      });
      const sessionCookie = signup.headers.get('set-cookie')?.split(';')[0] ?? cookie;

      const projectsPage = await fetch(`${base}/`, {headers: {cookie: sessionCookie}});
      if (projectsPage.status !== 200) throw new Error(`projects page status ${projectsPage.status}`);
      const projectCsrf = /name="csrf" value="([^"]+)"/.exec(await projectsPage.text())?.[1] ?? '';
      const valid = new FormData();
      valid.set('csrf', projectCsrf);
      valid.set('title', 'Maze');
      valid.set('sb3', new File([sb3Bytes], 'maze.sb3', {type: 'application/x.scratch.sb3'}));
      await expectStatus(`${base}/projects`, 303, {method: 'POST', headers: {cookie: sessionCookie}, body: valid, redirect: 'manual'});

      const invalid = new FormData();
      invalid.set('csrf', projectCsrf);
      invalid.set('title', 'Bad');
      invalid.set('sb3', new File([new Uint8Array([0x00, 0x01])], 'bad.sb3', {type: 'application/x.scratch.sb3'}));
      await expectStatus(`${base}/projects`, 415, {method: 'POST', headers: {cookie: sessionCookie}, body: invalid, redirect: 'manual'});
    }
  }
];

for (const example of examples) {
  const child = spawn('pnpm', ['exec', 'tsx', example.path], {
    env: {...process.env, PORT: String(example.port)},
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });

  try {
    await waitForServer(`http://127.0.0.1:${example.port}/`, child);
    await example.checks(`http://127.0.0.1:${example.port}`);
    console.log(`ok ${example.path}`);
  } catch (error) {
    throw new Error(`${example.path}: ${error instanceof Error ? error.message : String(error)}\n${output}`);
  } finally {
    child.kill('SIGTERM');
    await delay(100);
  }
}

async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited early with ${child.exitCode}`);
    try {
      await fetch(url, {redirect: 'manual'});
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`server did not start: ${url}`);
}

async function expectStatus(url, status, init) {
  const response = await fetch(url, init);
  if (response.status !== status) {
    throw new Error(`${url} expected ${status}, got ${response.status}: ${await response.text()}`);
  }
  return response;
}
