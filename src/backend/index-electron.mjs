import path from 'path';
import { promises as fs } from 'fs';
import express from 'express';
import cors from 'cors';
import { getAuthenticatedUser, getCsrfToken, getPlaceIdFromCreator, validateGroupPermissions, getGroupInfo, getBulkAssetInfo } from './api.mjs';
import { downloadAssetToBuffer, publishWithAdaptiveRetry, setAssetPermissions } from './transfer.mjs';
import { retryAsync } from './utils.mjs';

const ACCOUNTS_PATH = path.join(process.cwd(), 'data', 'accounts.json');
const PLACE_CACHE_TTL = 86400000; // 24 hours

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// UI State Management
let uiLogs = [];
let lastStudioPing = 0;
let authenticatedUser = null;
let savedCookie = '';
let userGroups = [];
let spoofTrigger = false;
let scriptInjected = false;
let currentMode = 'animation';
let spoofStatus = 'ready'; // Track current spoof mode
let currentMakePublic = false;

function addUILog(type, message) {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    uiLogs.push({ type, message, timestamp });
    console.log(`[${timestamp}] ${message}`);
    
    // Always queue for Studio to ensure the user sees ALL activity
    studioLogQueue.push(`[${type.toUpperCase()}] ${message}`);
}

// Queue for Roblox Studio polling
let studioLogQueue = [];

async function loadAccounts() {
    try {
        const raw = await fs.readFile(ACCOUNTS_PATH, 'utf8');
        return JSON.parse(raw);
    } catch {
        return { active: null, accounts: {}, placeCache: {} };
    }
}

async function saveAccounts(data) {
    try { await fs.writeFile(ACCOUNTS_PATH, JSON.stringify(data, null, 2)); } catch {}
}

// Load account and authenticate on startup
async function initializeFromAccount() {
    try {
        let data = await loadAccounts();
        
        // Handle migration from Cookie.txt if it exists and accounts.json is empty
        if (Object.keys(data.accounts).length === 0) {
            const cookiePath = path.join(process.cwd(), 'data', 'Cookie.txt');
            try {
                const cookieContent = await fs.readFile(cookiePath, 'utf8');
                if (cookieContent && cookieContent.trim()) {
                    console.log('Migrating Cookie.txt to accounts.json...');
                    const cookie = cookieContent.trim();
                    const user = await getAuthenticatedUser(cookie);
                    const alias = 'main';
                    data.accounts[alias] = { cookie, displayName: user.displayName, id: user.id };
                    data.active = alias;
                    await saveAccounts(data);
                    // Optionally delete Cookie.txt later
                }
            } catch (err) {}
        }

        if (!data.active || !data.accounts[data.active]) {
            console.log('No active account found in accounts.json');
            return;
        }

        const activeAccount = data.accounts[data.active];
        savedCookie = activeAccount.cookie;
        
        // Authenticate user
        try {
            authenticatedUser = await getAuthenticatedUser(savedCookie);
            console.log(`Authenticated as: ${authenticatedUser.displayName} (@${authenticatedUser.name})`);
            addUILog('success', `✓ Authenticated as ${authenticatedUser.displayName}`);
        } catch (err) {
            console.error('Failed to authenticate with active account:', err.message);
            addUILog('error', 'Account authentication failed');
            return;
        }

        // Get user groups with upload permissions
        await refreshUserGroups();
    } catch (err) {
        console.error('Initialization error:', err);
    }
}

async function refreshUserGroups() {
    if (!authenticatedUser || !savedCookie) return;
    try {
        const groupsResponse = await fetch(`https://groups.roblox.com/v2/users/${authenticatedUser.id}/groups/roles`, {
            headers: { 'Cookie': `.ROBLOSECURITY=${savedCookie}` }
        });

        if (groupsResponse.ok) {
            const groupsData = await groupsResponse.json();
            userGroups = (groupsData.data || [])
                .filter(item => {
                    const rank = item.role?.rank || 0;
                    return rank === 255 || rank >= 200;
                })
                .map(item => ({
                    id: item.group.id,
                    name: item.group.name,
                    rank: item.role?.rank || 0,
                    roleName: item.role?.name || 'Member'
                }));
            
            console.log(`Loaded ${userGroups.length} groups with upload permissions`);
            addUILog('info', `Loaded ${userGroups.length} groups`);
        }
    } catch (err) {
        console.error('Failed to load groups:', err.message);
    }
}

// Save cookie and get user groups
app.post('/save-cookie', async (req, res) => {
    try {
        const { cookie } = req.body;
        if (!cookie || !cookie.trim()) {
            return res.json({ success: false, error: 'Cookie is required' });
        }

        savedCookie = cookie.trim();
        
        // Authenticate user
        try {
            authenticatedUser = await getAuthenticatedUser(savedCookie);
        } catch (err) {
            return res.json({ success: false, error: 'Invalid cookie or authentication failed' });
        }

        // Save cookie to file
        const cookiePath = path.join(process.cwd(), 'data', 'Cookie.txt');
        await fs.writeFile(cookiePath, savedCookie, 'utf8');

        // Get user groups with upload permissions
        const groupsResponse = await fetch(`https://groups.roblox.com/v2/users/${authenticatedUser.id}/groups/roles`, {
            headers: { 'Cookie': `.ROBLOSECURITY=${savedCookie}` }
        });

        if (!groupsResponse.ok) {
            return res.json({ 
                success: true, 
                user: authenticatedUser,
                groups: []
            });
        }

        const groupsData = await groupsResponse.json();
        
        // Filter groups: rank 255 (owner) or rank >= 200 (admin permissions)
        userGroups = (groupsData.data || [])
            .filter(item => {
                const rank = item.role?.rank || 0;
                return rank === 255 || rank >= 200;
            })
            .map(item => ({
                id: item.group.id,
                name: item.group.name,
                rank: item.role?.rank || 0,
                roleName: item.role?.name || 'Member'
            }));

        res.json({ 
            success: true, 
            user: authenticatedUser,
            groups: userGroups
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Reload cookie from file (for account switching)
app.post('/reload-cookie', async (req, res) => {
    try {
        await initializeFromAccount();
        res.json({ 
            success: true,
            user: authenticatedUser,
            groups: userGroups
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Get UI logs
app.get('/logs', (req, res) => {
    res.json({ logs: uiLogs });
});

// Clear logs
app.post('/clear-logs', (req, res) => {
    uiLogs = [];
    res.json({ success: true });
});

// Studio ping endpoint
app.post('/ping', (req, res) => {
    lastStudioPing = Date.now();
    res.json({ success: true });
});

// Check if spoof should be triggered (for polling Lua script)
app.get('/check-trigger', (req, res) => {
    const logs = [...studioLogQueue];
    studioLogQueue = []; // Clear queue after sending
    
    if (spoofTrigger) {
        const response = { 
            shouldSpoof: true, 
            mode: currentMode, 
            makePublic: currentMakePublic,
            logs 
        };
        spoofTrigger = false;
        res.json(response);
    } else {
        res.json({ shouldSpoof: false, logs });
    }
});

// Trigger spoof endpoint (called by Run META button)
// Trigger spoof endpoint (called by Run META button)
app.post('/trigger-spoof', (req, res) => {
    const { mode, makePublic } = req.body;
    
    if (mode) {
        currentMode = mode;
    }
    currentMakePublic = !!makePublic;
    
    spoofTrigger = true;
    const modeNames = { animation: 'Animation', audio: 'Audio', script: 'Script' };
    addUILog('info', `${modeNames[currentMode] || 'Animation'} spoof triggered! (Make Public: ${currentMakePublic})`);
    
    const isConnected = (Date.now() - lastStudioPing) < 10000;
    res.json({ success: true, needsInjection: !isConnected });
});

// Check Studio connection status
app.get('/studio-status', (req, res) => {
    const isConnected = (Date.now() - lastStudioPing) < 10000;
    res.json({ connected: isConnected });
});

// Status endpoint for UI polling
app.get('/status', (req, res) => {
    const isConnected = (Date.now() - lastStudioPing) < 10000;
    
    res.json({
        username: authenticatedUser?.name || 'User',
        displayName: authenticatedUser?.displayName || authenticatedUser?.name || 'User',
        userId: authenticatedUser?.id || null,
        groups: userGroups,
        studioConnected: isConnected,
        logs: uiLogs,
        status: spoofStatus
    });
});

// Set target endpoint
app.post('/set-target', (req, res) => {
    const { target } = req.body;
    addUILog('info', `Target changed: ${target}`);
    res.json({ success: true });
});

// Main spoof endpoint
app.post('/spoof', async (req, res) => {
    try {
        const { isSoundMode, assetType, overridePlaceId, assets, targetGroupId, makePublic } = req.body;
        
        if (!assets?.length) {
            addUILog('error', 'No assets provided');
            return res.status(400).json({ success: false, error: 'No assets provided.' });
        }

        if (!savedCookie) {
            addUILog('error', 'No account configured');
            return res.status(400).json({ success: false, error: 'Account not configured' });
        }

        const assetTypeName = assetType || (isSoundMode ? 'Audio' : 'Animation');
        addUILog('info', `Starting ${assetTypeName} spoof...`);
        addUILog('info', `Processing ${assets.length} assets`);

        // Validate group permissions if uploading to group
        if (targetGroupId) {
            try {
                const groupInfo = await getGroupInfo(targetGroupId);
                const permResult = await validateGroupPermissions(savedCookie, targetGroupId);
                addUILog('success', `✓ Authorized for ${groupInfo.name} (${permResult.roleName})`);
            } catch (e) {
                addUILog('error', `Group validation failed: ${e.message}`);
                return res.status(403).json({ success: false, error: e.message });
            }
        }

        // Filter out already owned assets
        let assetEntries = [...assets];
        if (authenticatedUser?.id) {
            const userId = String(authenticatedUser.id);
            const groupId = targetGroupId ? String(targetGroupId) : null;
            const originalCount = assetEntries.length;
            
            assetEntries = assetEntries.filter(entry => {
                if (entry.creatorId === '1') return true;
                if (groupId && entry.creatorType === 'group' && entry.creatorId === groupId) return false;
                if (!groupId && entry.creatorType === 'user' && entry.creatorId === userId) return false;
                return true;
            });
            
            if (assetEntries.length < originalCount) {
                addUILog('info', `Skipping ${originalCount - assetEntries.length} already owned assets`);
            }
        }

        if (assetEntries.length === 0) {
            addUILog('warn', 'All assets already owned - nothing to transfer');
            return res.json({ success: true, mapping: {} });
        }

        // Get CSRF token
        let csrfToken;
        try {
            csrfToken = await getCsrfToken(savedCookie);
            addUILog('success', '✓ Session active');
        } catch (e) {
            addUILog('error', `Session failed: ${e.message}`);
            return res.status(401).json({ success: false, error: 'Failed to establish session' });
        }

        // Resolve metadata
        addUILog('info', 'Resolving asset metadata...');
        const assetIds = assetEntries.map(e => parseInt(e.id));
        const resolvedMap = {};
        const metadataChunks = [];
        
        for (let i = 0; i < assetIds.length; i += 50) {
            metadataChunks.push(assetIds.slice(i, i + 50));
        }

        await Promise.all(metadataChunks.map(async (chunk) => {
            const info = await getBulkAssetInfo(savedCookie, chunk);
            if (info?.data) {
                info.data.forEach(asset => {
                    resolvedMap[String(asset.id)] = {
                        type: asset.creator.type.toLowerCase() === 'group' ? 'group' : 'user',
                        id: String(asset.creator.targetId)
                    };
                });
            }
        }));

        for (const entry of assetEntries) {
            if (resolvedMap[entry.id]) {
                entry.creatorId = resolvedMap[entry.id].id;
                entry.creatorType = resolvedMap[entry.id].type;
            }
        }

        addUILog('success', `✓ Metadata resolved (${Object.keys(resolvedMap).length}/${assetEntries.length})`);

        // Map place IDs
        addUILog('info', 'Mapping routes...');
        const placeIdMap = {};
        const uniqueCreators = [...new Set(assetEntries.map(e => `${e.creatorType}:${e.creatorId}`))];
        
        let data = await loadAccounts();
        if (!data.placeCache) data.placeCache = {};
        let cacheHits = 0;

        for (const stringKey of uniqueCreators) {
            const [cType, cId] = stringKey.split(':');
            const cached = data.placeCache[stringKey];
            const isFresh = cached && (Date.now() - cached.timestamp < PLACE_CACHE_TTL);
            
            let places = isFresh ? cached.places : [];
            if (!isFresh) {
                try {
                    const maxPlaces = cType === 'group' ? 100 : 50;
                    places = await retryAsync(() => getPlaceIdFromCreator(cType, cId, savedCookie, maxPlaces), 2, 500);
                    data.placeCache[stringKey] = { places, timestamp: Date.now() };
                } catch(e) {}
            } else {
                cacheHits++;
            }
            
            const candidates = new Set();
            if (overridePlaceId && Number(overridePlaceId) > 0) {
                candidates.add(Number(overridePlaceId));
            }
            places.forEach(p => candidates.add(p));
            [1818, 99840799534728, 5323215915, 124701540157418, 168231904, 33225400, 162537373, 60684962].forEach(id => candidates.add(id));
            
            placeIdMap[stringKey] = [...candidates];
        }
        await saveAccounts(data);

        addUILog('success', `✓ Routes mapped (${uniqueCreators.length} sources, ${cacheHits} from cache)`);

        // Locate asset streams
        addUILog('info', 'Locating asset streams...');
        const locationsMap = {};
        const creatorAssetGroups = {};
        
        for (const entry of assetEntries) {
            const cKey = `${entry.creatorType}:${entry.creatorId}`;
            if (!creatorAssetGroups[cKey]) creatorAssetGroups[cKey] = [];
            creatorAssetGroups[cKey].push(entry);
        }

        let locationSuccesses = 0;
        await Promise.all(Object.entries(creatorAssetGroups).map(async ([cKey, creatorEntries]) => {
            const placeIdArray = placeIdMap[cKey] || [99840799534728];
            let remainingItems = creatorEntries.map(e => ({ requestId: String(e.id), assetId: parseInt(e.id) }));
            
            for (let pidx = 0; pidx < placeIdArray.length && remainingItems.length > 0; pidx++) {
                const placeId = placeIdArray[pidx];
                const chunks = [];
                for (let ci = 0; ci < remainingItems.length; ci += 50) {
                    chunks.push(remainingItems.slice(ci, ci + 50));
                }
                
                const stillRemaining = [];
                await Promise.all(chunks.map(async (chunk) => {
                    let locations = null;
                    try {
                        const resp = await fetch('https://assetdelivery.roblox.com/v2/assets/batch', {
                            method: 'POST',
                            headers: {
                                'User-Agent': 'RobloxStudio/WinInet',
                                'Content-Type': 'application/json',
                                'Cookie': `.ROBLOSECURITY=${savedCookie}`,
                                'Roblox-Place-Id': String(placeId)
                            },
                            body: JSON.stringify(chunk)
                        });
                        if (resp.ok) locations = await resp.json();
                    } catch (err) {}
                    
                    if (!locations) {
                        stillRemaining.push(...chunk);
                        return;
                    }
                    
                    for (const loc of locations) {
                        if (loc.locations?.length > 0) {
                            locationsMap[loc.requestId] = loc;
                            locationSuccesses++;
                        } else {
                            const originalItem = chunk.find(item => String(item.requestId) === String(loc.requestId));
                            if (originalItem) stillRemaining.push(originalItem);
                        }
                    }
                }));
                
                remainingItems = stillRemaining;
            }
            
            for (const item of remainingItems) {
                locationsMap[item.requestId] = { 
                    requestId: item.requestId, 
                    locations: [], 
                    errors: [{ code: 403, message: 'No valid file found' }] 
                };
            }
        }));

        addUILog('success', `✓ Streams located (${locationSuccesses} found)`);
        addUILog('info', `Processing ${assetEntries.length} assets...`);

        spoofStatus = 'processing';

        // Process assets
        const totalAssets = assetEntries.length;
        let processedCount = 0;
        const outputMapping = {};
        let successfulUploadCount = 0;
        let currentIndex = 0;
        const CONCURRENCY = assetTypeName === 'Audio' ? 2 : 100;
        const placeCounters = {};

        async function worker() {
            while (currentIndex < totalAssets) {
                const index = currentIndex++;
                const entry = assetEntries[index];
                
                try {
                    const creatorKey = `${entry.creatorType}:${entry.creatorId}`;
                    const candidatePlaces = placeIdMap[creatorKey] || [99840799534728];
                    
                    if (!placeCounters[creatorKey]) placeCounters[creatorKey] = 0;
                    const placeId = candidatePlaces[placeCounters[creatorKey] % candidatePlaces.length];
                    placeCounters[creatorKey]++;

                    
                    addUILog('info', `Downloading ${entry.name}...`);
                    
                    const dlRes = await downloadAssetToBuffer(
                        locationsMap[entry.id]?.locations?.[0]?.location,
                        savedCookie,
                        entry.id,
                        15000,
                        2,
                        placeId
                    );

                    if (dlRes?.success && dlRes.buffer) {
                        
                        addUILog('info', `Uploading ${entry.name} to target...`);
                        
                        const upRes = await publishWithAdaptiveRetry(
                            dlRes.buffer,
                            entry.name,
                            savedCookie,
                            csrfToken,
                            targetGroupId,
                            assetTypeName,
                            5,
                            placeId
                        );

                        processedCount++;
                        if (upRes.success) {
                            outputMapping[entry.id] = upRes.assetId;
                            successfulUploadCount++;
                            addUILog('success', `✓ ${entry.name} (${entry.id} → ${upRes.assetId}) [${processedCount}/${totalAssets}]`);
                            
                            if (makePublic) {
                                setAssetPermissions(upRes.assetId, savedCookie, csrfToken).catch(() => {});
                            }
                        } else {
                            addUILog('error', `✗ ${entry.name} (${entry.id}) FAILED [${processedCount}/${totalAssets}]`);
                        }
                    } else {
                        processedCount++;
                        addUILog('error', `✗ ${entry.name} (${entry.id}) DOWNLOAD_FAIL [${processedCount}/${totalAssets}]`);
                    }
                } catch (err) {
                    processedCount++;
                    addUILog('error', `✗ ${entry.name} ERROR: ${err.message}`);
                }
            }
        }

        const workers = Array.from({ length: Math.min(totalAssets, CONCURRENCY) }, worker);
        await Promise.all(workers);

        const failures = assetEntries.length - successfulUploadCount;
        addUILog('info', `SUMMARY: ${assetEntries.length} total, ${successfulUploadCount} transferred, ${failures} failed`);
        addUILog('success', '✓ Spoof complete!');

        spoofStatus = 'done';

        res.json({ success: true, mapping: outputMapping });
    } catch (error) {
        addUILog('error', `Fatal error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Inject script endpoint - reads Lua from file, no escaping issues
app.post('/inject-script', async (req, res) => {
    try {
        const { mode } = req.body;
        currentMode = mode || 'animation';
        
        // Use the universal polling script in the dedicated lua/ folder
        const luaScriptPath = path.join(process.cwd(), 'lua', 'UniversalPollingSpoof.txt');
        const { exec } = await import('child_process');
        
        addUILog('info', `Auto-injecting universal polling script into Studio...`);
        
        // PowerShell reads the Lua file directly - no escaping needed!
        const psScript = `
$scriptPath = "${luaScriptPath.replace(/\\/g, '\\\\')}"
$script = Get-Content -Path $scriptPath -Raw
Set-Clipboard -Value $script
Start-Sleep -Milliseconds 500

$studio = Get-Process -Name RobloxStudioBeta -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $studio) { Write-Host "ERROR: Studio not found"; exit 1 }

$metaApp = Get-Process | Where-Object { $_.MainWindowTitle -like "*META*" } | Select-Object -First 1

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool ClipCursor(ref RECT lpRect);
    [DllImport("user32.dll")] public static extern bool ClipCursor(IntPtr lpRect);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
}
public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}
public struct POINT {
    public int X;
    public int Y;
}
"@

[WinAPI]::SetForegroundWindow($studio.MainWindowHandle)
Start-Sleep -Milliseconds 1000

[System.Windows.Forms.SendKeys]::SendWait("^{F9}")
Start-Sleep -Milliseconds 3000

Write-Host "Searching for command bar..."

try {
    $automation = [System.Windows.Automation.AutomationElement]::FromHandle($studio.MainWindowHandle)
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
    $editControls = $automation.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    
    $foundCommandBar = $false
    foreach ($edit in $editControls) {
        $helpText = $edit.Current.HelpText
        $name = $edit.Current.Name
        $automationId = $edit.Current.AutomationId
        
        if (($helpText -like "*Execute*") -or ($name -like "*Execute*") -or ($helpText -like "*command*") -or ($name -like "*command*") -or ($automationId -like "*command*")) {
            Write-Host "Found command bar, clicking..."
            
            $rect = $edit.Current.BoundingRectangle
            $clickX = [int]($rect.Left + ($rect.Width / 2))
            $clickY = [int]($rect.Top + ($rect.Height / 2))
            
            [WinAPI]::SetCursorPos($clickX, $clickY)
            Start-Sleep -Milliseconds 200
            
            Write-Host "Locking mouse cursor at click position..."
            $lockRect = New-Object RECT
            $lockRect.Left = $clickX
            $lockRect.Top = $clickY
            $lockRect.Right = $clickX + 1
            $lockRect.Bottom = $clickY + 1
            [WinAPI]::ClipCursor([ref]$lockRect)
            
            [WinAPI]::mouse_event(0x0002, 0, 0, 0, 0)
            Start-Sleep -Milliseconds 50
            [WinAPI]::mouse_event(0x0004, 0, 0, 0, 0)
            Start-Sleep -Milliseconds 800
            
            [System.Windows.Forms.SendKeys]::SendWait("^a")
            Start-Sleep -Milliseconds 200
            [System.Windows.Forms.SendKeys]::SendWait("^v")
            Start-Sleep -Milliseconds 800
            
            Write-Host "Executing with Ctrl+Enter..."
            [System.Windows.Forms.SendKeys]::SendWait("^{ENTER}")
            Start-Sleep -Milliseconds 500
            
            Write-Host "Switching back to META GUI..."
            [System.Windows.Forms.SendKeys]::SendWait("%{TAB}")
            Start-Sleep -Milliseconds 200
            
            Write-Host "SUCCESS: Script executed!"
            $foundCommandBar = $true
            break
        }
    }
    
    if (-not $foundCommandBar) {
        Write-Host "ERROR: Command bar not found"
    }
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
} finally {
    Write-Host "Unlocking mouse cursor..."
    [WinAPI]::ClipCursor([IntPtr]::Zero)
}
`;
        
        const psFile = path.join(process.cwd(), 'temp_inject.ps1');
        await fs.writeFile(psFile, psScript, 'utf8');
        
        exec(`powershell -ExecutionPolicy Bypass -File "${psFile}"`, async (error, stdout, stderr) => {
            try { await fs.unlink(psFile); } catch {}
            
            const lines = stdout.split('\n');
            lines.forEach(line => {
                if (line.trim()) {
                    if (line.includes('SUCCESS')) {
                        addUILog('success', '✓ Universal polling script injected and running!');
                        scriptInjected = true;
                    } else if (line.includes('ERROR') || line.includes('WARNING')) {
                        addUILog('warn', line);
                    } else {
                        addUILog('info', line);
                    }
                }
            });
            
            if (stdout.includes('SUCCESS')) {
                addUILog('info', 'Script is now polling. Select mode and click "Run META" to trigger spoof!');
            }
        });
        
        res.json({ success: true, message: 'Injection started' });
    } catch (error) {
        addUILog('error', `Failed: ${error.message}`);
        res.json({ success: false, error: error.message });
    }
});

// Account management endpoints
app.get('/accounts', async (req, res) => {
    const data = await loadAccounts();
    res.json(data);
});

app.post('/add-account', async (req, res) => {
    try {
        const { cookie, alias } = req.body;
        if (!cookie || !alias) return res.json({ success: false, error: 'Cookie and alias required' });
        
        const user = await getAuthenticatedUser(cookie);
        let data = await loadAccounts();
        
        data.accounts[alias] = { cookie: cookie.trim(), displayName: user.displayName, id: user.id };
        data.active = alias;
        await saveAccounts(data);
        
        authenticatedUser = user;
        savedCookie = cookie.trim();
        await refreshUserGroups();
        
        addUILog('success', `Added account: ${user.displayName} (@${alias})`);
        res.json({ success: true, user, active: alias });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post('/switch-account', async (req, res) => {
    try {
        const { alias } = req.body;
        let data = await loadAccounts();
        if (!data.accounts[alias]) return res.json({ success: false, error: 'Account not found' });
        
        const acc = data.accounts[alias];
        const user = await getAuthenticatedUser(acc.cookie);
        
        data.active = alias;
        await saveAccounts(data);
        
        authenticatedUser = user;
        savedCookie = acc.cookie;
        await refreshUserGroups();
        
        addUILog('success', `Switched to: ${user.displayName}`);
        res.json({ success: true, user, active: alias });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post('/remove-account', async (req, res) => {
    try {
        const { alias } = req.body;
        let data = await loadAccounts();
        if (!data.accounts[alias]) return res.json({ success: false, error: 'Account not found' });
        
        delete data.accounts[alias];
        if (data.active === alias) {
            data.active = Object.keys(data.accounts)[0] || null;
        }
        await saveAccounts(data);
        
        if (data.active) {
            await initializeFromAccount();
        } else {
            authenticatedUser = null;
            savedCookie = '';
            userGroups = [];
        }
        
        addUILog('info', `Removed account: ${alias}`);
        res.json({ success: true, active: data.active });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// Global error handler - ensure we always return JSON, not HTML
app.use((err, req, res, next) => {
    console.error('SERVER ERROR:', err);
    res.status(500).json({ 
        success: false, 
        error: `Server Error: ${err.message || 'Internal Server Error'}` 
    });
});

// Start server
const PORT = 3000;
app.listen(PORT, async () => {
    console.log(`META Electron Backend running on port ${PORT}`);
    console.log('Initializing...');
    
    // Load account and authenticate on startup
    await initializeFromAccount();
    
    console.log('Ready! Waiting for UI connection...');
});
