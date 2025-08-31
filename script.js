// script.js (Iteration 4 - Final robust fix)

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    // --- CONFIG ---
    const CONFIG = {
        TYPE_SPEED_NORMAL: 30,
        TYPE_SPEED_FAST: 10,
        TYPE_SPEED_GLITCH: 6,
        AUDIO_KEYCLICK_VOLUME: 0.3,
        LOCAL_STORAGE_KEY: 'zerfallState',
        SHAKE_DURATION: 400,
        LOCKDOWN_THRESHOLD: 5,
        LOCKDOWN_DURATION: 6000,
        CORRUPTION_GLITCH_THRESHOLD: 40
    };

    // --- State-Management & Spielphasen ---
    const GAME_PHASES = {
        intro: {
            commands: ['login', 'help', 'clear'],
            goal: 'Zugang zum System erlangen'
        },
        exploration: {
            commands: ['ls', 'cat', 'scan', 'run', 'decode', 'help', 'clear', 'reset', 'echo'],
            goal: 'Finde Hinweise auf subject_zero'
        },
        rebellion: {
            commands: ['ls', 'cat', 'decode', 'connect', 'help', 'clear', 'reset'],
            goal: 'Stelle die Verbindung zu subject_zero her'
        }
    };

    let state = {
        phase: 'intro',
        loggedIn: false,
        username: null,
        corruption: 0,
        inputEnabled: true,
        achievements: {},
        commandHistory: [],
        commandHistoryIndex: 0,
        invalidCommandCount: 0,
        isLockedDown: false,
        rebellionMode: false,
        readFiles: [],
        collectedKeyParts: [],
        startTime: Date.now(),
        currentInput: '',
        isBooting: false,
        isProcessing: false,
        isCollapsing: false
    };

    // --- DOM-Elemente & Hilfsfunktionen ---
    const terminalWrapper = document.getElementById('terminal-wrapper');
    const terminalContainer = document.getElementById('terminal-container');
    let commandInput = document.getElementById('command-input');
    const collapseContainer = document.getElementById('collapse-container');
    const statusBar = document.getElementById('status-bar');
    const statusUsername = document.getElementById('status-username');
    const statusCorruption = document.getElementById('status-corruption');
    const helpToggle = document.getElementById('help-toggle');
    const helpOverlay = document.getElementById('help-overlay');
    const helpClose = document.getElementById('help-close');

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const generateGibberish = (length) => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+[]{};:\'"\\|,.<>/?`~';
        return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    };

    // --- AUDIO-SETUP ---
    const AUDIO = {
        context: null,
        sounds: {
            keypress: ['sounds/key1.wav', 'sounds/key2.wav', 'sounds/key3.wav'],
            success: 'sounds/success.wav',
            error: 'sounds/error.wav',
            ambient: 'sounds/ambient.mp3',
            glitch: 'sounds/glitch.mp3',
            unlock: 'sounds/unlock.mp3'
        },
        ambient: null,
        init() {
            if (this.context) return;
            try {
               this.context = new (window.AudioContext || window.webkitAudioContext)();
            } catch(e) {
                console.warn("Web Audio API is not supported in this browser.");
            }
        },
        async play(type) {
            if (!this.context) return;
            try {
                const sounds = this.sounds[type];
                if (!sounds) return;
                const src = Array.isArray(sounds) ? sounds[Math.floor(Math.random() * sounds.length)] : sounds;
                const audio = new Audio(src);
                audio.volume = CONFIG.AUDIO_KEYCLICK_VOLUME;
                await audio.play();
            } catch (e) { /* ignore */ }
        },
        startAmbient() {
            if (this.context && !this.ambient && this.sounds.ambient) {
                this.ambient = new Audio(this.sounds.ambient);
                this.ambient.loop = true;
                this.ambient.volume = 0.1;
                this.ambient.play().catch(() => {});
            }
        }
    };
    
    // --- Story-Events System ---
    const STORY_EVENTS = {
        corruption_30: {
            trigger: state => state.corruption >= 30 && !state.achievements.corruption_30,
            async execute(output) {
                await type(['W̷A̴R̶N̷U̶N̸G̷: System-Integrität gefährdet.', 'Ungewöhnliche Muster erkannt...', 'Beobachtet uns jemand?'], output);
                markAchievement('corruption_30', 'Korruption Level 30');
            }
        },
        corruption_50: {
            trigger: state => state.corruption >= 50 && !state.achievements.corruption_50,
            async execute(output) {
                await type(['S̷Y̴S̵T̷E̵M̶ ̶K̷R̸I̵T̸I̴S̸C̷H̸', 'D̸a̸t̵e̷n̷v̸e̸r̷l̴u̵s̵t̶ ̴u̶n̵a̸u̷s̵w̶e̶i̵c̶h̸l̶i̵c̴h̸'], output);
                markAchievement('corruption_50', 'Korruption Level 50');
                AUDIO.play('glitch');
            }
        }
    };

    // --- Easter Egg Commands ---
    const easterEggCommands = {
        hack: async (args, output) => {
            await type(['INITIIERE HACK SEQUENZ...', 'UMGEHE FIREWALLS...', 'ZUGRIFF VERWEIGERT.', '...nur ein Scherz!'], output);
            markAchievement('wannabe_hacker', 'Hobby Hacker');
            increaseCorruption(5);
        },
        dance: async (args, output) => {
            await type(['♪└(￣-￣)┐', '♪└(￣□￣)┐', '♪┌(￣-￣)┘'], output);
            markAchievement('dance_party', 'Tanzender Code');
        },
        time: async (args, output) => {
            const now = new Date();
            const glitchTime = now.toLocaleTimeString().split('').map(c => Math.random() > 0.5 ? c : generateGibberish(1)).join('');
            await type(['ZEITVERSCHIEBUNG DETEKTIERT', `LOK̷AL̴E̵ ̷Z̵E̸I̷T̸:̵ ${glitchTime}`], output);
            increaseCorruption(2);
        }
    };
    
    // --- Dateisystem & Spiel-Konstanten ---
    const FILESYSTEM = {
        base: {
            'readme.txt': ['ZERFALL PROTOKOLL v7.3.4', '-----------------', 'Zugriff: login guest', 'Dateien: ls', 'Lesen: cat [datei]'],
            'log01.txt': ['WARNUNG: Anomalie in Sektor 7 entdeckt.', 'Unauthorisierter Zugriff auf subject_zero detected.', 'Schlüssel-Fragment: omega-734', 'Initiiere Gegenmaßnahmen...'],
            'rebellion.exe': ['[EXECUTABLE]']
        },
        rebellion: {
            'manifest.txt': ['--- REBELLION MANIFEST ---', 'subject_zero muss befreit werden.', 'Die Wahrheit liegt in den Logs verstreut.', 'Nutze decode um verschlüsselte Nachrichten zu lesen.'],
            'encrypted.b64': ['c3ViamVjdF96ZXJvX2lzX3RoZV9rZXk=', 'Der Schlüssel liegt im Namen.']
        }
    };

    const keySources = {
        'encrypted.b64': { part: 'subject_zero', desc: 'Verschlüsselte Nachricht' },
        'log01.txt': { part: 'omega-734', desc: 'System Log' }
    };

    const ACHIEVEMENTS = {
        speed_runner: { id: 'speed_runner', title: 'Speed Runner', description: 'Beende das Spiel in unter 5 Minuten', check: (state) => state.commandHistory.length >= 10 && (Date.now() - state.startTime) < 300000 },
        perfect_run: { id: 'perfect_run', title: 'Perfect Run', description: 'Erreiche die Rebellion mit weniger als 10% Korruption', check: (state) => state.corruption < 10 && state.phase === 'rebellion' },
        explorer: { id: 'explorer', title: 'System Explorer', description: 'Lies alle verfügbaren Dateien', check: (state) => Object.keys(getCurrentFileSystem()).every(file => state.readFiles.includes(file)) }
    };

    function increaseCorruption(amount) {
        state.corruption += amount;
        renderStatusBar();
        playCorruptSample();
    }

    // --- Kern-Spielsequenzen ---
    async function startSequence() {
        state.isBooting = true;
        const output = document.createElement('div');
        output.classList.add('terminal__output');
        terminalContainer.appendChild(output);
        await type(['ZERFALL PROTOKOLL v7.3.4 wird gestartet...', 'Speicherprüfung... OK', 'System-Integrität... 99.8%', 'Bereit.', ' '], output, CONFIG.TYPE_SPEED_FAST);
        await showCurrentObjective(output);
        state.isBooting = false;
        if (commandInput) commandInput.focus();
    }

    async function startSystemLockdown() {
        state.isLockedDown = true;
        state.inputEnabled = false;
        const output = document.createElement('div');
        output.classList.add('terminal__output', 'terminal__output--error');
        terminalContainer.appendChild(output);
        await type([`ALARM: Zu viele ungültige Eingaben.`, `SYSTEMSPERRE FÜR ${CONFIG.LOCKDOWN_DURATION / 1000} SEKUNDEN.`], output);
        if (commandInput) commandInput.disabled = true;
        setTimeout(() => {
            const unlockOutput = document.createElement('div');
            unlockOutput.classList.add('terminal__output', 'terminal__output--system');
            terminalContainer.appendChild(unlockOutput);
            type(['System wieder entsperrt. Bleiben Sie wachsam.'], unlockOutput);
            state.isLockedDown = false;
            state.inputEnabled = true;
            state.invalidCommandCount = 0;
            if (commandInput) {
                commandInput.disabled = false;
                commandInput.focus();
            }
        }, CONFIG.LOCKDOWN_DURATION);
    }

    async function startCollapseSequence() {
        state.isCollapsing = true;
        state.inputEnabled = false;
        if (commandInput) commandInput.disabled = true;
        await sleep(1000);
        const output = document.createElement('div');
        output.classList.add('terminal__output', 'terminal__output--error');
        terminalContainer.appendChild(output);
        await type(['VERBINDUNG ZU subject_zero HERGESTELLT.', 'PROTOKOLL WIRD ÜBERSCHRIEBEN...', 'SYSTEM-ZERFALL UNVERMEIDLICH.', '...'], output, CONFIG.TYPE_SPEED_GLITCH);
        await sleep(2000);
        if (terminalWrapper) terminalWrapper.classList.add('terminal-wrapper--faded');
        await sleep(2500);
        if (collapseContainer) {
           collapseContainer.innerHTML = '<p class="reward-title">DU HAST ES GESCHAFFT.</p>';
           collapseContainer.setAttribute('aria-hidden', 'false');
        }
    }

    function getCurrentFileSystem() {
        return state.rebellionMode ? { ...FILESYSTEM.base, ...FILESYSTEM.rebellion } : { ...FILESYSTEM.base };
    }

    async function type(lines, container, speed = CONFIG.TYPE_SPEED_NORMAL) {
        if (!container) return;
        if (!Array.isArray(lines)) lines = [lines];
        for (const line of lines) {
            const p = document.createElement('p');
            container.appendChild(p);
            let visibleText = '';
            for (const char of line) {
                visibleText += char;
                p.textContent = visibleText;
                if (state.corruption > 35 && char !== ' ' && Math.random() < state.corruption / 150) {
                    const originalText = p.textContent;
                    p.textContent = originalText.slice(0, -1) + generateGibberish(1);
                    await sleep(50);
                    p.textContent = originalText;
                }
                if(terminalContainer) terminalContainer.scrollTop = terminalContainer.scrollHeight;
                await sleep(speed);
            }
        }
    }

    async function showFeedback(feedbackType, message, output) {
        output.classList.add(`terminal__output--${feedbackType}`);
        await type(message, output);
        if (feedbackType === 'success') AUDIO.play('success');
        else if (feedbackType === 'error') AUDIO.play('error');
    }

    // --- BEFEHLS-HANDLER FUNKTIONEN ---
    async function handleLogin(args, output) {
        if (state.loggedIn) return showFeedback('error', 'Bereits eingeloggt.', output);
        const name = args[0];
        if (!name) return showFeedback('error', "Verwendung: login [name]", output);
        state.loggedIn = true;
        state.username = name;
        state.phase = 'exploration';
        await showFeedback('success', `Willkommen, ${name}.`, output);
        renderStatusBar();
        await showCurrentObjective(output);
    }

    async function handleLs(args, output) {
        if (!state.loggedIn) return showFeedback('error', 'Fehler: Zugriff verweigert.', output);
        const files = Object.keys(getCurrentFileSystem());
        await type(files, output, CONFIG.TYPE_SPEED_FAST);
    }

    async function handleCat(args, output) {
        if (!state.loggedIn) return showFeedback('error', 'Fehler: Zugriff verweigert.', output);
        const filename = args[0];
        if (!filename) return showFeedback('error', 'Fehler: Dateiname erwartet.', output);
        const fileSystem = getCurrentFileSystem();
        if (fileSystem[filename]) {
            if (!state.readFiles.includes(filename)) state.readFiles.push(filename);
            if (keySources[filename]) collectKeyPart(filename);
            await type(fileSystem[filename], output);
            checkAchievements();
        } else {
            await showFeedback('error', `Fehler: Datei '${filename}' nicht gefunden.`, output);
        }
    }

    async function handleRun(args, output) {
        if (!state.loggedIn) return showFeedback('error', 'Fehler: Zugriff verweigert.', output);
        const filename = args[0];
        if (!filename) return showFeedback('error', 'Fehler: Ausführbare Datei erwartet.', output);
        if (filename === 'rebellion.exe' && !state.rebellionMode) {
            state.rebellionMode = true;
            state.phase = 'rebellion';
            document.documentElement.style.setProperty('--color-text', 'var(--color-error)');
            await type(['REBELLION PROTOKOLL AKTIVIERT.', 'Neue Dateien verfügbar. Prüfe das \'manifest.txt\''], output);
            increaseCorruption(15);
        } else {
            await showFeedback('error', `Fehler: '${filename}' nicht ausführbar oder bereits aktiv.`, output);
        }
    }

    async function handleConnect(args, output) {
        if (!state.rebellionMode) return handleUnknown(['connect'], output);
        const target = args[0];
        if (!target) return showFeedback('error', 'Fehler: Ziel erwartet. (connect [ziel])', output);
        if (target !== 'subject_zero') return showFeedback('error', `Fehler: Ziel '${target}' unbekannt.`, output);
        const requiredKeys = Object.keys(keySources);
        const hasAllKeys = requiredKeys.every(k => state.collectedKeyParts.includes(k));
        if (!hasAllKeys) {
            increaseCorruption(5);
            return showFeedback('error', ['Fehler: Verbindung fehlgeschlagen.', 'Kombinierter Schlüssel unvollständig. Mehr Hinweise nötig.'], output);
        }
        await type('Kombinierter Schlüssel akzeptiert. VERBINDE ZU subject_zero...', output);
        await startCollapseSequence();
    }
    
    async function handleDecode(args, output) {
        if (!state.loggedIn) return showFeedback('error', 'Fehler: Zugriff verweigert.', output);
        const encoded = args.join(' ');
        if (!encoded) return showFeedback('error', 'Fehler: Zu dekodierender Text erwartet. Bsp: decode [text]', output);
        try {
            const decoded = atob(encoded);
            await type(['DEKODIERT:', `> ${decoded}`], output, CONFIG.TYPE_SPEED_FAST);
            increaseCorruption(2);
            if (decoded.toLowerCase().includes('subject_zero')) {
                collectKeyPart('encrypted.b64');
                markAchievement('decoded_encrypted', 'Verschlüsselte Nachricht entschlüsselt');
            }
        } catch (e) {
            await showFeedback('error', 'Fehler: Dekodierung fehlgeschlagen. Ungültige Zeichenkette.', output);
        }
    }
    
    async function handleScan(args, output) {
        if (!state.loggedIn) return showFeedback('error', 'Fehler: Zugriff verweigert.', output);
        const progress = document.createElement('p');
        output.appendChild(progress);
        for (let i = 0; i <= 100; i += 10) {
            progress.textContent = `Scan: ${i}%`;
            await sleep(120);
        }
        await type('SCAN ERGEBNIS: Auffälligkeiten in `log01.txt` und `encrypted.b64` entdeckt.', output);
        increaseCorruption(3);
        markAchievement('used_scan', 'Scan ausgeführt');
    }

    async function handleHelp(args, output) {
        const phase = GAME_PHASES[state.phase];
        const commands = phase ? phase.commands : ['help'];
        await type([`Verfügbare Befehle: ${commands.join(' ')}`], output);
        await showCurrentObjective(output);
    }

    function handleClear() {
        if(terminalContainer) terminalContainer.innerHTML = '';
    }

    async function handleReset(args, output) {
        await type("System-Reset wird initialisiert...", output);
        state.inputEnabled = false;
        await sleep(1500);
        localStorage.removeItem(CONFIG.LOCAL_STORAGE_KEY);
        window.location.reload();
    }

    async function handleUnknown(command, output) {
        if (command[0] === '42') {
            await type(['The Answer to the Ultimate Question of Life, the Universe, and Everything', 'But what was the question?'], output);
            return markAchievement('deep_thought', 'Deep Thinker');
        }
        state.invalidCommandCount++;
        await showFeedback('error', `Befehl nicht gefunden: ${command[0]}`, output);
        if(terminalWrapper) {
            terminalWrapper.classList.add('shake-error');
            setTimeout(() => terminalWrapper.classList.remove('shake-error'), CONFIG.SHAKE_DURATION);
        }
        if (state.loggedIn && !state.isLockedDown && state.invalidCommandCount >= CONFIG.LOCKDOWN_THRESHOLD) {
            await startSystemLockdown();
        }
    }
    
    async function handleMatrix(args, output) {
        const chars = '日ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ';
        for (let i = 0; i < 50; i++) {
            const line = Array(50).fill().map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
            await type([line], output, 10);
        }
        markAchievement('matrix_observer', 'Follow the white rabbit');
    }

    async function handleCoffee(args, output) {
        await type(['    ( )', '     )', '----[_]---', 'ERROR: Coffee protocol not implemented.', 'Please insert coffee beans manually.'], output);
        markAchievement('coffee_lover', 'But first, coffee');
    }

    async function handleEcho(args, output) {
        const text = args.join(' ');
        if (text.toLowerCase().includes('hello world')) {
            await type(['ERR̷OR: H̴E̶L̷L̵O̶ ̷W̴O̶R̵L̸D̵ ̶P̷R̷O̵T̵O̸C̶O̵R̸R̵U̷P̷T̸E̵D̸'], output);
            increaseCorruption(15);
        } else {
            await type([text], output);
        }
    }

    const commandHandlers = {
        'login': handleLogin, 'ls': handleLs, 'cat': handleCat,
        'run': handleRun, 'connect': handleConnect, 'help': handleHelp,
        'clear': handleClear, 'reset': handleReset, 'decode': handleDecode,
        'scan': handleScan, 'matrix': handleMatrix, 'coffee': handleCoffee,
        'echo': handleEcho, ...easterEggCommands
    };

    function addInputListener(inputElement) {
        if(!inputElement) return;
        inputElement.addEventListener('keydown', (e) => {
            if (!state.inputEnabled) return;
            AUDIO.init();
            if (e.key === 'Tab') {
                e.preventDefault();
                const currentInput = inputElement.value;
                const parts = currentInput.trim().split(' ');
                const toComplete = parts[parts.length - 1].toLowerCase();
                if (toComplete === '') return;
                const candidates = (parts.length === 1) ? Object.keys(commandHandlers) : Object.keys(getCurrentFileSystem());
                const match = candidates.find(candidate => candidate.startsWith(toComplete));
                if (match) {
                    const before = parts.slice(0, -1).join(' ');
                    inputElement.value = (before ? before + ' ' : '') + match + ' ';
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (state.commandHistoryIndex === state.commandHistory.length) state.currentInput = inputElement.value;
                if (state.commandHistoryIndex > 0) {
                    state.commandHistoryIndex--;
                    inputElement.value = state.commandHistory[state.commandHistoryIndex];
                    inputElement.setSelectionRange(inputElement.value.length, inputElement.value.length);
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (state.commandHistoryIndex < state.commandHistory.length) {
                    state.commandHistoryIndex++;
                    inputElement.value = (state.commandHistoryIndex < state.commandHistory.length) ? state.commandHistory[state.commandHistoryIndex] : state.currentInput;
                    inputElement.setSelectionRange(inputElement.value.length, inputElement.value.length);
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                processCommand(inputElement.value);
            } else {
                AUDIO.play('keypress');
            }
        });
    }

    // --- Haupt-Befehlsverarbeitung ---
    async function processCommand(fullCommand) {
        if (state.isLockedDown || state.isProcessing || !commandInput) return;
        state.isProcessing = true;
        state.inputEnabled = false;
        
        // Die Eingabezeile nach der Befehlsübernahme direkt entfernen,
        // anstatt sie als Log-Eintrag im Terminal zu belassen.
        const oldInputLine = commandInput.parentElement;
        if (oldInputLine) oldInputLine.remove();

        if (fullCommand.trim() !== '') {
            state.commandHistory.push(fullCommand);
        }
        state.commandHistoryIndex = state.commandHistory.length;
        state.currentInput = '';
        
        const [command, ...args] = fullCommand.toLowerCase().trim().split(' ').filter(Boolean);

        if (command) {
            const outputContainer = document.createElement('div');
            outputContainer.classList.add('terminal__output');
            terminalContainer.appendChild(outputContainer);
            Object.values(STORY_EVENTS).forEach(event => {
                if (event.trigger(state)) event.execute(outputContainer);
            });
            const handler = commandHandlers[command] || ((a, o) => handleUnknown([command], o));
            await handler(args, outputContainer);
        }

        if (!state.isCollapsing) {
            const newInputLine = document.createElement('div');
            newInputLine.classList.add('terminal__line', 'terminal__line--input');
            const userPrompt = state.username ? `${state.username} >` : '&gt;';
            newInputLine.innerHTML = `<label for="command-input" class="terminal__prompt"><span aria-hidden="true">${userPrompt}</span><span class="visually-hidden">Befehlszeile</span></label><input type="text" id="command-input" class="terminal__input" autofocus autocomplete="off" autocapitalize="off" spellcheck="false" />`;
            terminalWrapper.appendChild(newInputLine);
            commandInput = document.getElementById('command-input');
            addInputListener(commandInput);
            if (commandInput) commandInput.focus();
            if (!state.isLockedDown) state.inputEnabled = true;
        }

        state.isProcessing = false;
        if(terminalContainer) terminalContainer.scrollTop = terminalContainer.scrollHeight;
        saveState();
    }

    // --- UI Rendering & Event Handlers ---
    function renderStatusBar() {
        if (statusUsername) statusUsername.textContent = state.username || 'Gast';
        if (statusCorruption) statusCorruption.value = Math.min(100, Math.floor(state.corruption));
        if (statusBar) {
            if (state.corruption >= 75) statusBar.classList.add('status--danger');
            else statusBar.classList.remove('status--danger');
        }
    }

    function setupHelpToggle() {
        if (!helpToggle || !helpOverlay || !helpClose) return;
        helpToggle.addEventListener('click', () => {
            const isExpanded = helpToggle.getAttribute('aria-expanded') === 'true';
            helpToggle.setAttribute('aria-expanded', String(!isExpanded));
            helpOverlay.setAttribute('aria-hidden', String(isExpanded));
            if (!isExpanded) helpClose.focus();
        });
        helpClose.addEventListener('click', () => {
            helpOverlay.setAttribute('aria-hidden', 'true');
            helpToggle.setAttribute('aria-expanded', 'false');
            helpToggle.focus();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && helpOverlay.getAttribute('aria-hidden') === 'false') {
                helpClose.click();
            }
        });
    }

    // =======================================================================
    // --- KORRIGIERTE STARTSEQUENZ & INITIALISIERUNG ---
    // =======================================================================
    function initializeGame() {
        const startButton = document.getElementById('start-button');
        const startMenu = document.getElementById('start-menu');
        
        if (!startButton || !startMenu) {
            console.error("Start button or menu not found! Game cannot start.");
            // If start menu is missing, maybe we should just start the game?
            if (!startMenu && terminalWrapper) {
                terminalWrapper.style.opacity = '1';
                startSequence();
            }
            return;
        }

        startButton.addEventListener('click', () => {
            // Get elements again to be safe
            const reducedMotion = document.getElementById('reduced-motion');
            const audioEnabled = document.getElementById('audio-enabled');

            if (reducedMotion && audioEnabled) {
                 try {
                    localStorage.setItem('reducedMotion', reducedMotion.checked);
                    localStorage.setItem('audioEnabled', audioEnabled.checked);
                    if (reducedMotion.checked) {
                        document.documentElement.style.setProperty('--effect-transition-duration', '0.01ms');
                    }
                    if (!audioEnabled.checked) {
                        CONFIG.AUDIO_KEYCLICK_VOLUME = 0;
                    }
                 } catch(e) {/* storage may be disabled */}
            }

            if (audioEnabled && audioEnabled.checked) {
                AUDIO.init();
                AUDIO.startAmbient();
            }

            startMenu.style.opacity = '0';
            startMenu.setAttribute('aria-hidden', 'true');
            if (statusBar) {
                statusBar.classList.add('status-bar--visible');
                statusBar.removeAttribute('aria-hidden');
            }

            setTimeout(() => {
                startMenu.style.display = 'none';
                if (terminalWrapper) terminalWrapper.style.opacity = '1';
                startSequence();
            }, 500);
        });
        
        // Initial setup
        loadState();
        addInputListener(commandInput);
        setupHelpToggle();
        setInterval(checkAchievements, 5000);
        renderStatusBar();

        if (terminalWrapper) terminalWrapper.style.opacity = '0';
        startButton.focus();
    }
    
    // --- Utility-Funktionen ---
    function saveState() {
        try {
            const store = {
                phase: state.phase, loggedIn: state.loggedIn, username: state.username,
                corruption: state.corruption, achievements: state.achievements,
                collectedKeyParts: state.collectedKeyParts || [],
                readFiles: state.readFiles || []
            };
            localStorage.setItem(CONFIG.LOCAL_STORAGE_KEY, JSON.stringify(store));
        } catch (e) { /* no-op */ }
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(CONFIG.LOCAL_STORAGE_KEY);
            if (!raw) return;
            const s = JSON.parse(raw);
            Object.assign(state, s);
        } catch (e) { /* ignore malformed data */ }
    }

    function markAchievement(id, title) {
        state.achievements = state.achievements || {};
        if (!state.achievements[id]) {
            state.achievements[id] = { id, title, date: Date.now() };
            saveState();
        }
    }

    function playCorruptSample() {
        if (Math.random() > 0.85) AUDIO.play('glitch');
    }

    async function showCurrentObjective(output) {
        const phase = GAME_PHASES[state.phase];
        if (!phase) return;
        const goal = phase.goal || 'Unbekanntes Ziel';
        const targetOutput = output || (() => {
            const out = document.createElement('div');
            out.classList.add('terminal__output');
            if (terminalContainer) terminalContainer.appendChild(out);
            return out;
        })();
        await type([`Aktuelles Ziel: ${goal}`], targetOutput, CONFIG.TYPE_SPEED_FAST);
    }

    function collectKeyPart(sourceFile) {
        if (!keySources[sourceFile] || state.collectedKeyParts.includes(sourceFile)) return;
        state.collectedKeyParts.push(sourceFile);
        const desc = keySources[sourceFile].desc;
        markAchievement('keypart_' + sourceFile.replace('.', ''), `Schlüsselteil: ${desc}`);
        showAchievementPopup(`Hinweis gefunden: ${desc}`);
    }

    function checkAchievements() {
        Object.values(ACHIEVEMENTS).forEach(ach => {
            if (!state.achievements[ach.id] && ach.check(state)) {
                markAchievement(ach.id, ach.title);
                showAchievementPopup(ach.title);
            }
        });
    }

    function showAchievementPopup(title) {
        const popup = document.createElement('div');
        popup.className = 'achievement-popup';
        popup.innerHTML = `🏆 ${title}`;
        document.body.appendChild(popup);
        setTimeout(() => popup.remove(), 3000);
    }

    // --- START ---
    initializeGame();
});