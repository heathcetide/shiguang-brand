import fs from 'node:fs';
import path from 'node:path';

const buildGradlePath = path.resolve(
  process.cwd(),
  process.argv[2] || 'android/app/build.gradle',
);

let source = fs.readFileSync(buildGradlePath, 'utf8');
const signingConfigsMarker = '    signingConfigs {';
const signingConfigsIndex = source.indexOf(signingConfigsMarker);

if (signingConfigsIndex === -1) {
  throw new Error(`Unable to locate signingConfigs in ${buildGradlePath}`);
}

const releaseSigningConfig = `${signingConfigsMarker}\n        release {\n            storeFile file(System.getenv('ANDROID_KEYSTORE_PATH'))\n            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')\n            keyAlias System.getenv('ANDROID_KEY_ALIAS')\n            keyPassword System.getenv('ANDROID_KEY_PASSWORD')\n        }`;

source = source.replace(signingConfigsMarker, releaseSigningConfig);

const buildTypesIndex = source.indexOf('    buildTypes {', signingConfigsIndex);
const releaseBlockIndex = source.indexOf('        release {', buildTypesIndex);

if (buildTypesIndex === -1 || releaseBlockIndex === -1) {
  throw new Error(`Unable to locate the release build type in ${buildGradlePath}`);
}

let depth = 0;
let releaseBlockEnd = -1;

for (let index = source.indexOf('{', releaseBlockIndex); index < source.length; index += 1) {
  if (source[index] === '{') depth += 1;
  if (source[index] === '}') depth -= 1;
  if (depth === 0) {
    releaseBlockEnd = index + 1;
    break;
  }
}

if (releaseBlockEnd === -1) {
  throw new Error(`Unable to parse the release build type in ${buildGradlePath}`);
}

const releaseBlock = source.slice(releaseBlockIndex, releaseBlockEnd);
const signedReleaseBlock = releaseBlock.replace(
  /signingConfig signingConfigs\.[A-Za-z0-9_]+/,
  'signingConfig signingConfigs.release',
);

if (signedReleaseBlock === releaseBlock) {
  throw new Error(`Unable to replace the release signing config in ${buildGradlePath}`);
}

source = `${source.slice(0, releaseBlockIndex)}${signedReleaseBlock}${source.slice(releaseBlockEnd)}`;
fs.writeFileSync(buildGradlePath, source);

console.log(`Configured release signing in ${buildGradlePath}`);
