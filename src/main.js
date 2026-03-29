import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// baseDir is the project root, one level up from src/
const baseDir = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..');

let mainWindow;
let backendProcess;

async function checkSetupComplete() {
    try {
        const cookiePath = path.join(baseDir, 'data', 'Cookie.txt');
        await fs.access(cookiePath);
        
        const nodeModulesPath = path.join(baseDir, 'node_modules');
        await fs.access(nodeModulesPath);
        
        return true;
    } catch {
        return false;
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 450,
        height: 700,
        resizable: false,
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'assets', 'META-logo.png'),
        alwaysOnTop: false,
        skipTaskbar: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'frontend', 'preload.js')
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'frontend', 'index.html'));

    mainWindow.on('blur', () => {});

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (backendProcess) {
            backendProcess.kill();
        }
    });
}

function startBackend() {
    backendProcess = spawn('node', [path.join(__dirname, 'backend', 'index-electron.mjs')], {
        cwd: baseDir,
        stdio: 'ignore',
        windowsHide: true,
        detached: false,
        shell: false
    });

    backendProcess.on('error', (err) => {
        console.error('Failed to start backend:', err);
    });

    backendProcess.on('exit', (code) => {
        console.log(`Backend process exited with code ${code}`);
    });
}

ipcMain.handle('check-setup-complete', async () => {
    return await checkSetupComplete();
});

ipcMain.handle('install-dependencies', async () => {
    return new Promise((resolve) => {
        const depsPath = path.join(baseDir, 'resources', 'dependencies.txt');
        
        fs.readFile(depsPath, 'utf8')
            .then(content => {
                const deps = content.split('\n').filter(line => line.trim());
                
                if (deps.length === 0) {
                    resolve({ success: false, error: 'No dependencies found in dependencies.txt' });
                    return;
                }
                
                const npmProcess = spawn('npm', ['install', ...deps, '--no-fund', '--no-audit'], {
                    cwd: baseDir,
                    shell: true
                });

                let output = '';
                let errorOutput = '';

                npmProcess.stdout.on('data', (data) => {
                    output += data.toString();
                    console.log(data.toString());
                });

                npmProcess.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                    console.error(data.toString());
                });

                npmProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve({ success: true });
                    } else {
                        resolve({ 
                            success: false, 
                            error: `npm install exited with code ${code}. ${errorOutput}` 
                        });
                    }
                });

                npmProcess.on('error', (err) => {
                    resolve({ 
                        success: false, 
                        error: `Failed to start npm: ${err.message}` 
                    });
                });
            })
            .catch(err => {
                resolve({ 
                    success: false, 
                    error: `Failed to read resources/dependencies.txt: ${err.message}` 
                });
            });
    });
});

ipcMain.handle('save-cookie', async (event, cookie) => {
    try {
        if (!cookie || !cookie.trim()) {
            return { success: false, error: 'Cookie is required' };
        }

        if (!cookie.includes('WARNING')) {
            return { success: false, error: 'Cookie must include WARNING text' };
        }

        const cookiePath = path.join(baseDir, 'data', 'Cookie.txt');
        await fs.writeFile(cookiePath, cookie.trim(), 'utf8');

        startBackend();
        
        await new Promise(resolve => setTimeout(resolve, 2000));

        return { success: true };
    } catch (error) {
        return { 
            success: false, 
            error: `Failed to save cookie: ${error.message}` 
        };
    }
});

ipcMain.handle('minimize-window', () => {
    if (mainWindow) {
        mainWindow.minimize();
    }
});

app.whenReady().then(async () => {
    createWindow();
    
    const setupComplete = await checkSetupComplete();
    if (setupComplete) {
        startBackend();
    }
});

app.on('window-all-closed', () => {
    if (backendProcess) {
        backendProcess.kill();
    }
    app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});
