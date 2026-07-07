// Play Console internal track uploader
// Usage: node upload_aab.mjs <path-to-aab>
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const SERVICE_ACCOUNT_KEY = path.join(import.meta.dirname, 'polaris-app-yukid-458b1ff906c2.json');
const PACKAGE_NAME = 'com.yukid.polaris';
const TRACK = 'internal';

const aabPath = process.argv[2];
if (!aabPath) { console.error('Usage: node upload_aab.mjs <path-to-aab>'); process.exit(1); }

const auth = new google.auth.GoogleAuth({
  keyFile: SERVICE_ACCOUNT_KEY,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});

const publisher = google.androidpublisher({ version: 'v3', auth });

async function upload() {
  // 1. Create edit
  console.log('Creating edit...');
  const editRes = await publisher.edits.insert({ packageName: PACKAGE_NAME });
  const editId = editRes.data.id;
  console.log('Edit ID:', editId);

  // 2. Upload AAB
  console.log('Uploading AAB...');
  const bundleRes = await publisher.edits.bundles.upload({
    packageName: PACKAGE_NAME,
    editId,
    media: {
      mimeType: 'application/octet-stream',
      body: fs.createReadStream(path.resolve(aabPath)),
    },
  });
  const versionCode = bundleRes.data.versionCode;
  console.log('Uploaded version code:', versionCode);

  // 3. Update track
  console.log('Updating track...');
  await publisher.edits.tracks.update({
    packageName: PACKAGE_NAME,
    editId,
    track: TRACK,
    requestBody: {
      track: TRACK,
      releases: [{ versionCodes: [String(versionCode)], status: 'completed' }],
    },
  });

  // 4. Commit
  console.log('Committing edit...');
  await publisher.edits.commit({ packageName: PACKAGE_NAME, editId });
  console.log('Done! AAB uploaded to internal testing track.');
}

upload().catch(e => { console.error(e?.response?.data ?? e?.message ?? e); process.exit(1); });
