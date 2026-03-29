const API_URL = 'http://localhost:3000';
let lastLogCount = 0;

const body = document.body;


const savedTheme = localStorage.getItem('theme') || 'light';
if (savedTheme === 'dark') {
    body.classList.add('dark-theme');
}

function animateSetupTitle() {
    const titleElement = document.getElementById('setup-title');
    if (!titleElement) return;
    
    const text = 'SETUP';
    titleElement.textContent = '';
    
    text.split('').forEach((letter, index) => {
        const span = document.createElement('span');
        span.textContent = letter;
        span.className = 'setup-title-letter';
        span.style.animationDelay = `${index * 0.1}s`;
        titleElement.appendChild(span);
    });
}

animateSetupTitle();

async function checkSetup() {
    if (window.electronAPI) {
        const setupComplete = await window.electronAPI.checkSetupComplete();
        
        if (setupComplete) {
            document.getElementById('setup-screen').classList.add('hidden');
            document.getElementById('main-app').classList.remove('hidden');
            startPolling();
        } else {
            document.getElementById('setup-screen').classList.remove('hidden');
            document.getElementById('main-app').classList.add('hidden');
        }
    }
}

const installDepsBtn = document.getElementById('install-deps-btn');
const depsStatus = document.getElementById('deps-status');
const stepDependencies = document.getElementById('step-dependencies');
const stepCookie = document.getElementById('step-cookie');

if (installDepsBtn) {
    installDepsBtn.addEventListener('click', async () => {
        installDepsBtn.disabled = true;
        installDepsBtn.textContent = 'Installing...';
        
        showStatus(depsStatus, 'info', 'Installing dependencies... This may take a few minutes.');
        
        try {
            const result = await window.electronAPI.installDependencies();
            
            if (result.success) {
                showStatus(depsStatus, 'success', 'Dependencies installed successfully!');
                
                setTimeout(() => {
                    stepDependencies.classList.add('hidden');
                    stepCookie.classList.remove('hidden');
                }, 1000);
            } else {
                showStatus(depsStatus, 'error', `Installation failed: ${result.error}`);
                installDepsBtn.disabled = false;
                installDepsBtn.textContent = 'Retry Installation';
            }
        } catch (error) {
            showStatus(depsStatus, 'error', `Error: ${error.message}`);
            installDepsBtn.disabled = false;
            installDepsBtn.textContent = 'Retry Installation';
        }
    });
}

const saveCookieBtn = document.getElementById('save-cookie-btn');
const cookieInput = document.getElementById('cookie-input');
const cookieStatus = document.getElementById('cookie-status');

if (saveCookieBtn) {
    saveCookieBtn.addEventListener('click', async () => {
        const cookie = cookieInput.value.trim();
        
        if (!cookie) {
            showStatus(cookieStatus, 'error', 'Please paste your cookie!');
            return;
        }
        
        if (!cookie.includes('WARNING')) {
            showStatus(cookieStatus, 'error', 'Cookie must include the WARNING text!');
            return;
        }
        
        saveCookieBtn.disabled = true;
        saveCookieBtn.textContent = 'Saving...';
        
        try {
            const result = await window.electronAPI.saveCookie(cookie);
            
            if (result.success) {
                showStatus(cookieStatus, 'success', 'Cookie saved! Loading account...');
                
                try {
                    await fetch(`${API_URL}/reload-cookie`, { method: 'POST' });
                } catch (err) {
                    console.error('Failed to reload cookie in backend:', err);
                }
                
                setTimeout(() => {
                    document.getElementById('setup-screen').classList.add('hidden');
                    document.getElementById('main-app').classList.remove('hidden');
                    startPolling();
                }, 2000);
            } else {
                showStatus(cookieStatus, 'error', result.error || 'Failed to save cookie');
                saveCookieBtn.disabled = false;
                saveCookieBtn.textContent = 'Save Cookie';
            }
        } catch (error) {
            showStatus(cookieStatus, 'error', `Error: ${error.message}`);
            saveCookieBtn.disabled = false;
            saveCookieBtn.textContent = 'Save Cookie';
        }
    });
}

function showStatus(element, type, message) {
    element.textContent = message;
    element.className = `status-message visible ${type}`;
}

const themeToggle = document.getElementById('theme-toggle');
const appLogo = document.querySelector('.app-logo');
const changeAccountBtn = document.getElementById('change-account-btn');

if (themeToggle) {
    themeToggle.textContent = savedTheme === 'dark' ? 'Light' : 'Dark';
    
    if (savedTheme === 'dark') {
        appLogo.src = '../assets/META-logo_inverted.png';
    } else {
        appLogo.src = '../assets/META-logo.png';
    }
    
    themeToggle.addEventListener('click', () => {
        body.classList.toggle('dark-theme');
        const isDark = body.classList.contains('dark-theme');
        themeToggle.textContent = isDark ? 'Light' : 'Dark';
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        
        if (isDark) {
            appLogo.src = '../assets/META-logo_inverted.png';
        } else {
            appLogo.src = '../assets/META-logo.png';
        }
    });
}

const openAccountsBtn = document.getElementById('open-accounts-btn');
const closeAccountsBtn = document.getElementById('close-accounts-btn');
const accountsModal = document.getElementById('accounts-modal');

if (openAccountsBtn) {
    openAccountsBtn.addEventListener('click', () => {
        accountsModal.classList.remove('hidden');
        fetchAccounts();
    });
}

if (closeAccountsBtn) {
    closeAccountsBtn.addEventListener('click', () => {
        accountsModal.classList.add('hidden');
    });
}

// Account Manager Logic
async function fetchAccounts() {
    try {
        const resp = await fetch(`${API_URL}/accounts`);
        const data = await resp.json();
        updateAccountsUI(data);
    } catch (err) {
        console.error('Failed to fetch accounts:', err);
    }
}

function updateAccountsUI(data) {
    const list = document.getElementById('accounts-list');
    list.innerHTML = '';
    
    const aliases = Object.keys(data.accounts);
    if (aliases.length === 0) {
        list.innerHTML = '<div style="padding: 20px; text-align: center; color: #888; font-size: 13px;">No accounts added yet.</div>';
        return;
    }
    
    aliases.forEach(alias => {
        const acc = data.accounts[alias];
        const isActive = alias === data.active;
        
        const item = document.createElement('div');
        item.className = 'account-item';
        
        item.innerHTML = `
            <div class="account-info">
                <div class="acc-display-name">
                    ${acc.displayName}
                    ${isActive ? '<span class="acc-active-tag">Active</span>' : ''}
                </div>
                <div class="acc-alias">@${alias}</div>
            </div>
            <div class="account-actions">
                ${!isActive ? `<button class="acc-btn btn-switch" data-alias="${alias}">Switch</button>` : ''}
                <button class="acc-btn btn-remove" data-alias="${alias}">Remove</button>
            </div>
        `;
        
        list.appendChild(item);
    });
    
    // Add event listeners to buttons
    list.querySelectorAll('.btn-switch').forEach(btn => {
        btn.addEventListener('click', () => switchAccount(btn.dataset.alias));
    });
    
    list.querySelectorAll('.btn-remove').forEach(btn => {
        btn.addEventListener('click', () => removeAccount(btn.dataset.alias));
    });
}

async function addAccount() {
    const aliasInput = document.getElementById('new-account-alias');
    const cookieInput = document.getElementById('new-account-cookie');
    const addBtn = document.getElementById('add-account-btn');
    
    const alias = aliasInput.value.trim();
    const cookie = cookieInput.value.trim();
    
    if (!alias || !cookie) {
        alert('Please provide both an alias and a cookie.');
        return;
    }
    
    addBtn.disabled = true;
    addBtn.textContent = 'Adding...';
    
    try {
        const resp = await fetch(`${API_URL}/add-account`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alias, cookie })
        });
        const result = await resp.json();
        
        if (result.success) {
            aliasInput.value = '';
            cookieInput.value = '';
            fetchAccounts();
            fetchStatus(); // Refresh main UI
        } else {
            alert(`Error: ${result.error}`);
        }
    } catch (err) {
        alert(`Failed to add account: ${err.message}`);
    } finally {
        addBtn.disabled = false;
        addBtn.textContent = 'Add Account';
    }
}

async function switchAccount(alias) {
    try {
        const resp = await fetch(`${API_URL}/switch-account`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alias })
        });
        const result = await resp.json();
        
        if (result.success) {
            fetchAccounts();
            fetchStatus();
            addLog('success', `Switched to account: ${result.user.displayName}`);
        } else {
            alert(`Error: ${result.error}`);
        }
    } catch (err) {
        alert(`Failed to switch: ${err.message}`);
    }
}

async function removeAccount(alias) {
    if (!confirm(`Are you sure you want to remove account "@${alias}"?`)) return;
    
    try {
        const resp = await fetch(`${API_URL}/remove-account`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alias })
        });
        const result = await resp.json();
        
        if (result.success) {
            fetchAccounts();
            fetchStatus();
        } else {
            alert(`Error: ${result.error}`);
        }
    } catch (err) {
        alert(`Failed to remove: ${err.message}`);
    }
}

const addAccountBtn = document.getElementById('add-account-btn');
if (addAccountBtn) {
    addAccountBtn.addEventListener('click', addAccount);
}

const modal = document.getElementById('confirm-modal');
const confirmYes = document.getElementById('confirm-yes');
const confirmNo = document.getElementById('confirm-no');

console.log('Modal elements:', { modal: !!modal, confirmYes: !!confirmYes, confirmNo: !!confirmNo });

if (confirmYes) {
    confirmYes.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        console.log('Switch Account YES clicked');
        
        const modal = document.getElementById('confirm-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
        
        try {
            await fetch(`${API_URL}/clear-logs`, { method: 'POST' });
        } catch (err) {
            console.error('Failed to clear logs:', err);
        }
        
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
        
        lastLogCount = 0;
        
        const mainApp = document.getElementById('main-app');
        const setupScreen = document.getElementById('setup-screen');
        const stepDeps = document.getElementById('step-dependencies');
        const stepCookie = document.getElementById('step-cookie');
        const cookieInput = document.getElementById('cookie-input');
        const targetSelect = document.getElementById('target-select');
        const saveCookieBtn = document.getElementById('save-cookie-btn');
        const cookieStatus = document.getElementById('cookie-status');
        
        console.log('Elements found:', {
            mainApp: !!mainApp,
            setupScreen: !!setupScreen,
            stepDeps: !!stepDeps,
            stepCookie: !!stepCookie,
            cookieInput: !!cookieInput,
            saveCookieBtn: !!saveCookieBtn
        });
        
        if (targetSelect) {
            while (targetSelect.options.length > 1) {
                targetSelect.remove(1);
            }
        }
        
        if (saveCookieBtn) {
            saveCookieBtn.disabled = false;
            saveCookieBtn.textContent = 'Save Cookie';
        }
        
        if (cookieStatus) {
            cookieStatus.className = 'status-message';
            cookieStatus.textContent = '';
        }
        
        if (mainApp) {
            mainApp.classList.add('hidden');
            console.log('Main app hidden');
        }
        if (setupScreen) {
            setupScreen.classList.remove('hidden');
            console.log('Setup screen shown');
        }
        if (stepDeps) {
            stepDeps.classList.add('hidden');
        }
        if (stepCookie) {
            stepCookie.classList.remove('hidden');
            console.log('Cookie step shown');
        }
        if (cookieInput) {
            cookieInput.value = '';
        }
        
        console.log('Account switch complete');
    });
} else {
    console.error('confirmYes button not found!');
}

if (confirmNo) {
    confirmNo.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        console.log('Cancel NO clicked');
        
        const modal = document.getElementById('confirm-modal');
        if (modal) {
            modal.classList.add('hidden');
            console.log('Modal hidden');
        }
    });
} else {
    console.error('confirmNo button not found!');
}

if (modal) {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            e.preventDefault();
            e.stopPropagation();
            modal.classList.add('hidden');
            console.log('Modal closed by backdrop click');
        }
    });
}

const completionModal = document.getElementById('completion-modal');
const completionOk = document.getElementById('completion-ok');

console.log('Completion modal elements:', { completionModal: !!completionModal, completionOk: !!completionOk });

if (completionOk) {
    completionOk.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        console.log('Completion OK clicked');
        
        if (completionModal) {
            completionModal.classList.add('hidden');
            console.log('Completion modal hidden');
        }
    });
} else {
    console.error('completionOk button not found!');
}

if (completionModal) {
    completionModal.addEventListener('click', (e) => {
        if (e.target === completionModal) {
            e.preventDefault();
            e.stopPropagation();
            completionModal.classList.add('hidden');
            console.log('Completion modal closed by backdrop click');
        }
    });
}

let studioConnected = false;

async function fetchStatus() {
    try {
        const response = await fetch(`${API_URL}/status`);
        if (!response.ok) throw new Error('Not connected');
        
        const data = await response.json();
        updateUI(data);
        
        const statusText = document.getElementById('status-text');
        if (statusText && data.userId) {
            statusText.className = 'status-text connected';
            statusText.textContent = `User ID: ${data.userId}`;
        }
    } catch (error) {
        
    }
}

function updateUI(data) {
    if (data.username) {
        const usernameEl = document.getElementById('username');
        const displayNameEl = document.getElementById('display-name');
        
        usernameEl.textContent = data.username;
        
        if (data.displayName && data.displayName !== data.username) {
            displayNameEl.textContent = ` (@${data.displayName})`;
        } else {
            displayNameEl.textContent = '';
        }
    }
    
    if (data.groups) {
        const select = document.getElementById('target-select');
        const currentGroupsCount = select.querySelectorAll('option[value^="group:"]').length;
        
        if (currentGroupsCount !== data.groups.length) {
            // Re-populate group list
            while (select.options.length > 1) {
                select.remove(1);
            }
            data.groups.forEach(group => {
                const option = document.createElement('option');
                option.value = group.id; // Corrected to just ID for targetGroupId
                option.textContent = `${group.name} (${group.roleName})`;
                select.appendChild(option);
            });
        }
    }
    
    if (data.logs && data.logs.length > lastLogCount) {
        const newLogs = data.logs.slice(lastLogCount);
        lastLogCount = data.logs.length;
        
        const logsContainer = document.getElementById('logs');
        
        if (logsContainer.textContent === 'Ready to spoof...') {
            logsContainer.textContent = '';
        }
        
        newLogs.forEach((log, index) => {
            setTimeout(() => {
                const logLine = document.createElement('div');
                logLine.className = `log-line log-${log.type || 'info'}`;
                logLine.textContent = `[${new Date().toLocaleTimeString()}] ${log.message}`;
                logLine.style.opacity = '0';
                logLine.style.transform = 'translateY(-5px)';
                logsContainer.appendChild(logLine);
                
                requestAnimationFrame(() => {
                    logLine.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
                    logLine.style.opacity = '1';
                    logLine.style.transform = 'translateY(0)';
                    
                    logsContainer.scrollTop = logsContainer.scrollHeight;
                });
            }, index * 50);
        });
    }
    
    if (data.status === 'processing') {
        document.getElementById('status-text').className = 'status-text connected';
        document.getElementById('status-text').textContent = 'Processing...';
    } else if (data.status === 'done') {
        document.getElementById('status-text').className = 'status-text connected';
        document.getElementById('status-text').textContent = 'Complete!';
        
        const completionModal = document.getElementById('completion-modal');
        if (completionModal && !completionModal.classList.contains('shown-once')) {
            completionModal.classList.remove('hidden');
            completionModal.classList.add('shown-once');
        }
    }
}

const targetSelect = document.getElementById('target-select');
if (targetSelect) {
    targetSelect.addEventListener('change', async (e) => {
        const value = e.target.value;
        try {
            await fetch(`${API_URL}/set-target`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target: value })
            });
            
            addLog('info', `Target changed to: ${e.target.options[e.target.selectedIndex].text}`);
        } catch (error) {
            console.error('Failed to set target:', error);
        }
    });
}

const runMetaBtn = document.getElementById('run-meta-btn');
const modeSelect = document.getElementById('mode-select');

if (runMetaBtn) {
    runMetaBtn.addEventListener('click', async () => {
        runMetaBtn.disabled = true;
        
        const selectedMode = modeSelect ? modeSelect.value : 'animation';
        
        addLog('info', 'Starting META...');
        
        let dotCount = 0;
        const dotsInterval = setInterval(() => {
            dotCount = (dotCount + 1) % 4;
            const dots = '.'.repeat(dotCount);
            runMetaBtn.innerHTML = `<span class="run-icon">▶</span> Running${dots}`;
        }, 500);
        
        try {
            const makePublic = document.getElementById('make-public-toggle')?.checked || false;
            
            const triggerResponse = await fetch(`${API_URL}/trigger-spoof`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: selectedMode, makePublic })
            });
            
            const triggerData = await triggerResponse.json();
            
            if (triggerData.needsInjection) {
                clearInterval(dotsInterval);
                
                addLog('info', `Injecting universal polling script...`);
                
                const injectResponse = await fetch(`${API_URL}/inject-script`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: selectedMode })
                });
                
                const injectData = await injectResponse.json();
                
                if (injectData.success) {
                    addLog('success', 'Polling script injected! Click "Run META" again to start spoofing.');
                } else {
                    addLog('error', injectData.error || 'Failed to inject');
                }
            } else if (triggerData.success) {
                clearInterval(dotsInterval);
                
                // If it's successful, we clear the completion modal flag from previous runs
                const completionModal = document.getElementById('completion-modal');
                if (completionModal) completionModal.classList.remove('shown-once');
            } else {
                clearInterval(dotsInterval);
                addLog('error', 'Failed to trigger spoof');
            }
        } catch (error) {
            clearInterval(dotsInterval);
            addLog('error', `Failed: ${error.message}`);
        } finally {
            setTimeout(() => {
                runMetaBtn.disabled = false;
                runMetaBtn.innerHTML = '<span class="run-icon">▶</span> Run META';
            }, 2000);
        }
    });
}

function addLog(type, message) {
    const logsContainer = document.getElementById('logs');
    
    if (logsContainer.textContent === 'Ready to spoof...') {
        logsContainer.textContent = '';
    }
    
    const logLine = document.createElement('div');
    logLine.className = `log-line log-${type}`;
    logLine.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logsContainer.appendChild(logLine);
    logsContainer.scrollTop = logsContainer.scrollHeight;
}

let pollInterval = null;

function startPolling() {
    if (pollInterval) return;
    
    pollInterval = setInterval(fetchStatus, 100);
    
    fetchStatus();
}

checkSetup();
