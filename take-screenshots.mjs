import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const chrome = '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';
const shots = JSON.parse(readFileSync(resolve(root, 'shots.json'), 'utf8'));
mkdirSync(resolve(root, 'screenshots'), { recursive: true });

function capture(shot, attempt) {
  const out = resolve(root, 'screenshots', shot.name);
  const page = pathToFileURL(resolve(root, 'app/index.html')).href + shot.query;
  const width = shot.w || 1280;
  const height = shot.h || 900;
  return new Promise((resolvePromise, reject) => {
    const args = [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-crashpad',
      '--hide-scrollbars', '--virtual-time-budget=4500',
      `--window-size=${width},${height}`, '--force-device-scale-factor=1', `--screenshot=${out}`, page,
    ];
    const child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`attempt ${attempt}: Chromium timeout`)); }, 30000);
    child.on('error', error => { clearTimeout(timeout); reject(new Error(`attempt ${attempt}: spawn: ${error.message}`)); });
    child.on('close', code => {
      clearTimeout(timeout);
      // A completed image is the success signal; Chromium may report unrelated crashpad/dbus noise.
      import('node:fs').then(({ statSync }) => {
        try {
          const st = statSync(out);
          if (st.size > 0) resolvePromise({ out, size: st.size, code, stderr });
          else reject(new Error(`attempt ${attempt}: no image (exit ${code}): ${stderr}`));
        } catch { reject(new Error(`attempt ${attempt}: no image (exit ${code}): ${stderr}`)); }
      });
    });
  });
}

for (const shot of shots) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await capture(shot, attempt);
      console.log(`${shot.name}: ${result.size} bytes (${result.code === 0 ? 'Chromium exited cleanly' : `exit ${result.code}, image produced`})`);
      last = null;
      break;
    } catch (error) {
      last = error;
      console.error(`${shot.name}: ${error.message}`);
    }
  }
  if (last) throw last;
}
