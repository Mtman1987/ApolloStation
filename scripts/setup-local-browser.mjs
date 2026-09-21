import {existsSync, mkdirSync, chmodSync, createReadStream, createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {createBrotliDecompress} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {chromium} from 'playwright';

export async function localBrowserPath() {
  if (process.env.HMO_TEST_BROWSER_PATH) {
    if (!existsSync(process.env.HMO_TEST_BROWSER_PATH)) throw Error('HMO_TEST_BROWSER_PATH does not exist');
    return process.env.HMO_TEST_BROWSER_PATH;
  }
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  if (process.platform !== 'linux' || process.arch !== 'x64') throw Error('Install your native browser with npx playwright install chromium, or set HMO_TEST_BROWSER_PATH');
  const root=fileURLToPath(new URL('./local-browser/',import.meta.url));
  const runtime=join(root,'runtime');
  const binary=join(runtime,'chromium');
  if (existsSync(join(runtime,'ready')) && existsSync(binary)) return binary;
  const install=spawnSync('npm',['ci','--ignore-scripts','--prefix',root],{stdio:'inherit'});
  if(install.status!==0)throw Error('Local browser package installation failed');
  const bin=join(root,'node_modules/@sparticuz/chromium/bin');
  mkdirSync(runtime,{recursive:true});
  await pipeline(createReadStream(join(bin,'chromium.br')),createBrotliDecompress(),createWriteStream(binary));
  chmodSync(binary,0o755);
  for(const name of ['fonts','swiftshader']) {
    const archive=join(runtime,`${name}.tar`);
    await pipeline(createReadStream(join(bin,`${name}.tar.br`)),createBrotliDecompress(),createWriteStream(archive));
    const target=name==='fonts'?join(runtime,'fonts'):runtime;
    mkdirSync(target,{recursive:true});
    const extracted=spawnSync('tar',['--no-same-owner','-xf',archive,'-C',target],{stdio:'inherit'});
    if(extracted.status!==0)throw Error(`Local browser ${name} extraction failed`);
  }
  const browser=await chromium.launch({executablePath:binary,headless:true,args:['--no-sandbox']});
  try {const page=await browser.newPage();await page.setContent('<title>Apollo browser ready</title>');if(await page.title()!=='Apollo browser ready')throw Error('Browser smoke check failed');}
  finally {await browser.close();}
  const {writeFile}=await import('node:fs/promises');
  await writeFile(join(runtime,'ready'),'chromium-153.0.0\n');
  return binary;
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(await localBrowserPath());
