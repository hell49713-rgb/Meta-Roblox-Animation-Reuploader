import { DEVELOPER_MODE } from './utils.mjs';
export async function getAuthenticatedUser(cookie) {
  try {
    const response = await fetch('https://users.roblox.com/v1/users/authenticated', {
      headers: {
        'Cookie': `.ROBLOSECURITY=${cookie}`,
        'User-Agent': 'RobloxStudio/WinInet'
      }
    });
    if (!response.ok) {
      throw new Error(`Login failed (Status: ${response.status})`);
    }
    const data = await response.json();
    return {
      id: data.id,
      name: data.name,
      displayName: data.displayName
    };
  } catch (error) {
    throw new Error(`Wrong cookie or no internet: ${error.message}`);
  }
}
export async function getCsrfToken(cookie) {
  const retryLimit = 3;
  for (let i = 0; i < retryLimit; i++) {
    try {
      const resp = await fetch('https://auth.roblox.com/v2/logout', { 
        method: 'POST', 
        headers: { 'Cookie': `.ROBLOSECURITY=${cookie}`, 'Content-Type': 'application/json' }, 
        body: JSON.stringify({}) 
      });
      const token = resp.headers.get('x-csrf-token');
      if (token) return token;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Failed to retrieve CSRF token after ${retryLimit} attempts.`);
}
export async function getBulkAssetInfo(cookie, assetIds) {
  if (!assetIds || assetIds.length === 0) return { data: [] };
  const idsParam = assetIds.join(',');
  const url = `https://develop.roblox.com/v1/assets?assetIds=${idsParam}`;
  try {
    const response = await fetch(url, {
      headers: {
        'Cookie': `.ROBLOSECURITY=${cookie}`,
        'User-Agent': 'RobloxStudio/WinInet'
      }
    });
    if (!response.ok) {
        return { data: [] };
    }
    return await response.json();
  } catch (err) {
    return { data: [] };
  }
}
export async function getPlaceIdFromCreator(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  const validLimits = [10, 25, 50, 100];
  let limit = 10;
  if (maxPlaceIds >= 100) limit = 100;
  else if (maxPlaceIds >= 50) limit = 50;
  else if (maxPlaceIds >= 25) limit = 25;
  async function getGamesPage(url) {
    try {
      const resp = await fetch(url, { headers: { Cookie: `.ROBLOSECURITY=${cookie}` } });
      if (!resp.ok) return { data: [] };
      return await resp.json();
    } catch {
      return { data: [] };
    }
  }
  let allGames = [];
  const publicUrl = creatorType === 'group' 
    ? `https://games.roblox.com/v2/groups/${creatorId}/gamesV2?limit=${Math.min(limit, 100)}`
    : `https://games.roblox.com/v2/users/${creatorId}/games?sortOrder=Asc&limit=${Math.min(limit, 50)}`;
  const publicData = await getGamesPage(publicUrl);
  if (publicData.data) allGames = allGames.concat(publicData.data);
  if (creatorType === 'group' && publicData.nextPageCursor && allGames.length < maxPlaceIds) {
    try {
      const nextUrl = `https://games.roblox.com/v2/groups/${creatorId}/gamesV2?limit=${Math.min(limit, 100)}&cursor=${publicData.nextPageCursor}`;
      const nextData = await getGamesPage(nextUrl);
      if (nextData.data) allGames = allGames.concat(nextData.data);
    } catch {}
  }
  if (creatorType === 'group' && allGames.length === 0) {
    try {
      const devUrl = `https://develop.roblox.com/v1/groups/${creatorId}/universes?limit=${Math.min(limit, 50)}`;
      const devResp = await fetch(devUrl, { headers: { Cookie: `.ROBLOSECURITY=${cookie}` } });
      if (devResp.ok) {
        const devData = await devResp.json();
        if (devData.data) {
          for (const universe of devData.data) {
             if (universe.rootPlaceId) {
               allGames.push({ rootPlace: { id: universe.rootPlaceId } });
             }
          }
        }
      }
    } catch (err) {}
  }
  const rootPlaces = allGames
    .slice(0, maxPlaceIds)
    .map(game => {
      if (game.rootPlace && (game.rootPlace.id || game.rootPlace.Id)) return game.rootPlace.id || game.rootPlace.Id;
      else if (game.id) return game.id;
      return null;
    })
    .filter(id => id !== null);
  if (rootPlaces.length === 0) {
    throw new Error('No root places found in games');
  }
  return rootPlaces; 
}
export async function validateGroupPermissions(cookie, groupId) {
  try {
    const response = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/membership`, {
      headers: {
        'Cookie': `.ROBLOSECURITY=${cookie}`,
      }
    });
    if (!response.ok) {
      if (response.status === 400) {
        throw new Error(`Can't find group ${groupId}.`);
      }
      throw new Error(`Check failed (Status: ${response.status})`);
    }
    const membership = await response.json();
    if (!membership.userRole || membership.userRole.role.name === 'Guest') {
      throw new Error(`You aren't in this group.`);
    }
    return {
      valid: true,
      roleName: membership.userRole.role.name,
      groupId: membership.groupId
    };
  } catch (error) {
    if (error.message && (error.message.includes('not a member') || error.message.includes('does not have') || error.message.includes('invalid or does not exist'))) {
      throw error;
    }
    throw new Error(`Group permission check failed: ${error.message}`);
  }
}
export async function getGroupInfo(groupId) {
  try {
    const response = await fetch(`https://groups.roblox.com/v1/groups/${groupId}`);
    if (!response.ok) return null;
    const data = await response.json();
    return { id: data.id, name: data.name };
  } catch {
    return null;
  }
}