import fsSync from 'fs';
import { promises as fs } from 'fs';
import chalk from 'chalk';
import { DEVELOPER_MODE } from './utils.mjs';
export async function downloadAssetToBuffer(url, robloxCookie, originalAssetId, timeoutMs = 25000, retries = 3, placeId = null) {
  const retryDelayMs = 150;
  for (let attempt = 1; attempt <= (retries + 1); attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const headers = { 
        'Cookie': `.ROBLOSECURITY=${robloxCookie}`,
        'User-Agent': 'RobloxStudio/WinInet'
      };
      if (placeId) headers['Roblox-Place-Id'] = String(placeId);
      const response = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) {
        if (response.status === 403) throw new Error('Forbidden (403)');
        if (response.status === 429) throw new Error('Rate Limited (429)');
        throw new Error(`Status ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      return { success: true, buffer: Buffer.from(buffer) };
    } catch (error) {
      if (attempt > retries) return { success: false, error: error.message };
      const wait = retryDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
      await new Promise(r => setTimeout(r, wait));
    }
  }
}
export async function downloadAnimationAsset(url, robloxCookie, filePath, entryName, originalAssetId, placeId = null, options = {}) {
  const res = await downloadAssetToBuffer(url, robloxCookie, originalAssetId, options.timeoutMs, options.retries);
  if (res.success) {
    try {
      await fs.writeFile(filePath, res.buffer);
      return { success: true, filePath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  return res;
}
export async function publishAnimationRbxm(input, name, cookie, csrfToken, groupId = null, assetTypeName = 'Animation', placeId = null) {
  let fileBuffer;
  if (Buffer.isBuffer(input)) {
    fileBuffer = input;
  } else {
    try {
      fileBuffer = await fs.readFile(input);
    } catch (fileError) {
      return { success: false, error: `File system error: ${fileError.message}` };
    }
  }
  const fileSize = fileBuffer.length;
  const isAudio = assetTypeName === 'Audio';
  if (isAudio) {
    let publishCsrfToken = csrfToken;
    try {
      const resp = await fetch('https://publish.roblox.com/v1/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': `.ROBLOSECURITY=${cookie}` },
        body: JSON.stringify({}),
      });
      const newToken = resp.headers.get('x-csrf-token');
      if (newToken) publishCsrfToken = newToken;
    } catch {}
    const payload = {
      name: name,
      file: fileBuffer.toString('base64'),
      assetPrivacy: 1,
      estimatedFileSize: fileSize,
      estimatedDuration: 0,
      paymentSource: 'User'
    };
    if (groupId) payload.groupId = parseInt(groupId);
    try {
      const resp = await fetch('https://publish.roblox.com/v1/audio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `.ROBLOSECURITY=${cookie}`,
          'x-csrf-token': publishCsrfToken,
          'User-Agent': 'RobloxStudio/WinInet',
        },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) return { success: false, error: `Status ${resp.status}`, status: resp.status };
      const nid = data.Id || data.id || data.assetId;
      if (nid) return { success: true, assetId: nid.toString() };
      throw new Error(`No asset ID returned`);
    } catch (err) {
      return { success: false, error: err.message };
    }
  } else {
    const uploadUrl = new URL('https://www.roblox.com/ide/publish/uploadnewanimation');
    uploadUrl.searchParams.set('assetTypeName', assetTypeName);
    uploadUrl.searchParams.set('name', name);
    uploadUrl.searchParams.set('description', 'Placeholder');
    uploadUrl.searchParams.set('ispublic', 'false');
    uploadUrl.searchParams.set('allowComments', 'true');
    uploadUrl.searchParams.set('isGamesAsset', 'false');
    if (groupId) uploadUrl.searchParams.set('groupId', groupId);
    try {
      const headers = {
        'Content-Type': 'application/octet-stream',
        'Cookie': `.ROBLOSECURITY=${cookie}`,
        'X-CSRF-TOKEN': csrfToken,
        'User-Agent': 'RobloxStudio/WinInet',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      };
      if (placeId) headers['Roblox-Place-Id'] = String(placeId);
      const resp = await fetch(uploadUrl.toString(), {
        method: 'POST',
        headers,
        body: fileBuffer,
      });
      const bodyText = await resp.text();
      if (!resp.ok) return { success: false, error: `Status ${resp.status}`, status: resp.status };
      const nid = bodyText.trim();
      if (nid && /^\d+$/.test(nid)) return { success: true, assetId: nid };
      return { success: false, error: `Invalid Asset ID: ${bodyText.substring(0, 50)}`, status: resp.status };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}
import { getCsrfToken } from './api.mjs';
export async function publishWithAdaptiveRetry(input, name, cookie, csrfToken, groupId, assetTypeName, retries = 5, placeId = null) {
  let currentToken = csrfToken;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await publishAnimationRbxm(input, name, cookie, currentToken, groupId, assetTypeName, placeId);
    if (res.success) return res;
    const is429 = res.status === 429;
    const isTokenFail = res.status === 403; 
    if (attempt < retries) {
      if (isTokenFail) {
        try {
          currentToken = await getCsrfToken(cookie);
        } catch {}
      }
      const waitTime = is429 
        ? (1000 * Math.pow(1.5, attempt - 1)) + Math.random() * 1000 
        : (200 * attempt);
      await new Promise(r => setTimeout(r, waitTime));
    }
  }
  return { success: false, error: 'Maximum attempts reached' };
}

export async function setAssetPermissions(assetId, cookie, csrfToken) {
  try {
    const url = `https://apis.roblox.com/asset-permissions-api/v1/assets/${assetId}/permissions`;
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `.ROBLOSECURITY=${cookie}`,
        'x-csrf-token': csrfToken,
        'User-Agent': 'RobloxStudio/WinInet',
      },
      body: JSON.stringify({
        requests: [{ action: 'USE', subjectType: 'Universe', subjectId: '0' }],
      }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}