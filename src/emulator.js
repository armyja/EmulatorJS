class EmulatorJS {
    createElement(type) {
        return document.createElement(type);
    }
    addEventListener(element, listener, callback) {
        const listeners = listener.split(" ");
        for (let i=0; i<listeners.length; i++) {
            element.addEventListener(listeners[i], callback);
            this.listeners.push({cb:callback, elem:element, listener:listeners[i]});
        }
    }
    downloadFile(path, cb, progressCB, notWithPath, opts) {
        const basePath = notWithPath ? '' : this.config.dataPath;
        path = basePath + path;
        let url;
        try {url=new URL(path)}catch(e){};
        if ((url && ['http:', 'https:'].includes(url.protocol)) || !url) {
            const xhr = new XMLHttpRequest();
            if (progressCB instanceof Function) {
                xhr.addEventListener('progress', (e) => {
                    const progress = e.total ? ' '+Math.floor(e.loaded / e.total * 100).toString()+'%' : ' '+(e.loaded/1048576).toFixed(2)+'MB';
                    progressCB(progress);
                });
            }
            xhr.onload = function() {
                if (xhr.readyState === xhr.DONE) {
                    let data = xhr.response;
                    try {data=JSON.parse(data)}catch(e){}
                    cb({
                        data: data,
                        headers: {
                            "content-length": xhr.getResponseHeader('content-length'),
                            "content-type": xhr.getResponseHeader('content-type'),
                            "last-modified": xhr.getResponseHeader('last-modified')
                        }
                    });
                }
            }
            xhr.responseType = opts.responseType;
            xhr.onerror = () => cb(-1);
            xhr.open(opts.method, path, true);
            xhr.send();
        } else {
            (async () => {
                //Most commonly blob: urls. Not sure what else it could be
                if (opts.method === 'HEAD') {
                    cb({headers:{}});
                    return;
                }
                let res;
                try {
                    res = await fetch(path);
                    if (opts.type && opts.type.toLowerCase() === 'arraybuffer') {
                        res = await res.arrayBuffer();
                    } else {
                        res = await res.text();
                        try {res = JSON.parse(res)} catch(e) {}
                    }
                } catch(e) {
                    cb(-1);
                }
                if (path.startsWith('blob:')) URL.revokeObjectURL(path);
                cb({
                    data: res,
                    headers: {}
                });
            })
        }
    }
    constructor(element, config) {
        window.EJS_TESTING = this;
        this.debug = (window.EJS_DEBUG_XX === true);
        this.setElements(element);
        this.started = false;
        this.paused = true;
        this.listeners = [];
        this.config = config;
        this.canvas = this.createElement('canvas');
        this.canvas.classList.add('ejs_canvas');
        this.bindListeners();
        this.fullscreen = false;
        
        
        this.game.classList.add("ejs_game");
        
        this.createStartButton();
        
        console.log(this)
    }
    setElements(element) {
        this.game =  document.querySelector(element);
        this.elements = {
            main: this.game,
            parent: this.game.parentElement
        }
        this.elements.parent.classList.add("ejs_parent");
    }
    // Start button
    createStartButton() {
        const button = this.createElement("div");
        button.classList.add("ejs_start_button");
        button.innerText = this.localization("Start Game");
        this.elements.parent.appendChild(button);
        this.addEventListener(button, "click", this.startButtonClicked.bind(this));
    }
    startButtonClicked(e) {
        e.preventDefault();
        e.target.remove();
        this.createText();
        this.downloadGameCore();
    }
    // End start button
    createText() {
        this.textElem = this.createElement("div");
        this.textElem.classList.add("ejs_loading_text");
        this.textElem.innerText = this.localization("Loading...");
        this.elements.parent.appendChild(this.textElem);
    }
    localization(text) {
        //todo
        return text;
    }
    checkCompression(data, msg) {
        if (msg) {
            this.textElem.innerText = msg;
        }
        //to be put in another file
        function isCompressed(data) { //https://www.garykessler.net/library/file_sigs.html
            //todo. Use hex instead of numbers
            if ((data[0] === 80 && data[1] === 75) && ((data[2] === 3 && data[3] === 4) || (data[2] === 5 && data[3] === 6) || (data[2] === 7 && data[3] === 8))) {
                return 'zip';
            } else if (data[0] === 55 && data[1] === 122 && data[2] === 188 && data[3] === 175 && data[4] === 39 && data[5] === 28) {
                return '7z';
            } else if ((data[0] === 82 && data[1] === 97 && data[2] === 114 && data[3] === 33 && data[4] === 26 && data[5] === 7) && ((data[6] === 0) || (data[6] === 1 && data[7] == 0))) {
                return 'rar';
            }
        }
        const createWorker = (path) => {
            return new Promise((resolve, reject) => {
                this.downloadFile(path, (res) => {
                    if (res === -1) {
                        this.textElem.innerText = "Error";
                        this.textElem.style.color = "red";
                        return;
                    }
                    const blob = new Blob([res.data], {
                        'type': 'application/javascript'
                    })
                    const url = window.URL.createObjectURL(blob);
                    resolve(new Worker(url));
                }, null, false, {responseType: "arraybuffer", method: "GET"});
            })
        }
        const decompress7z = (file) => {
            return new Promise((resolve, reject) => {
                const files = {};
                const onMessage = (data) => {
                    if (!data.data) return;
                    //data.data.t/ 4=progress, 2 is file, 1 is zip done
                    if (data.data.t === 4 && msg) {
                        const pg = data.data;
                        const num = Math.floor(pg.current / pg.total * 100);
                        if (isNaN(num)) return;
                        const progress = ' '+num.toString()+'%';
                        this.textElem.innerText = msg + progress;
                    }
                    if (data.data.t === 2) {
                        files[data.data.file] = data.data.data;
                    }
                    if (data.data.t === 1) {
                        resolve(files);
                    }
                }
                
                createWorker('compression/extract7z.js').then((worker) => {
                    worker.onmessage = onMessage;
                    worker.postMessage(file);
                    //console.log(file);
                })
            })
        }
        async function decompressRar() {
            
        }
        const compression = isCompressed(data.slice(0, 10));
        if (compression) {
            //Need to do zip and rar still
            return decompress7z(data);
        } else {
            return new Promise(resolve => resolve(data));
        }
        
    }
    downloadGameCore() {
        this.textElem.innerText = this.localization("Download Game Core");
        this.downloadFile('cores/'+this.getCore()+'-wasm.data', (res) => {
            if (res === -1) {
                this.textElem.innerText = "Error";
                this.textElem.style.color = "red";
                return;
            }
            this.checkCompression(new Uint8Array(res.data), this.localization("Decompress Game Core")).then((data) => {
                //console.log(data);
                let js, wasm;
                for (let k in data) {
                    if (k.endsWith(".wasm")) {
                        wasm = data[k];
                    } else if (k.endsWith(".js")) {
                        js = data[k];
                    }
                }
                this.initGameCore(js, wasm);
            });
        }, (progress) => {
            this.textElem.innerText = this.localization("Download Game Core") + progress;
        }, false, {responseType: "arraybuffer", method: "GET"});
        
    }
    initGameCore(js, wasm) {
        this.initModule(wasm);
        let script = this.createElement("script");
        script.src = URL.createObjectURL(new Blob([js], {type: "application/javascript"}));
        document.body.appendChild(script);
    }
    getCore() {
        const core = this.config.system;
        const options = {
            'nes': 'fceumm',
            'snes': 'snes9x',
            'atari5200': 'a5200',
            'gb': 'gambatte',
            'gba': 'mgba',
            'vb': 'beetle_vb',
            'n64': 'mupen64plus_next',
            'nds': 'desmume2015',
            'mame2003': 'mame2003',
            'arcade': 'fbalpha2012_cps1', // I need to find a more  compatible arcade core
            'psx': 'mednafen_psx_hw',
            '3do': 'opera'
        }
        return options[core] || core;
    }
    downloadRom() {
        this.gameManager = new window.EJS_GameManager(this.Module);
        
        this.textElem.innerText = this.localization("Download Game Data");
        this.downloadFile(this.config.gameUrl, (res) => {
            if (res === -1) {
                this.textElem.innerText = "Error";
                this.textElem.style.color = "red";
                return;
            }
            this.checkCompression(new Uint8Array(res.data), this.localization("Decompress Game Data")).then((data) => {
                FS.writeFile("/game", data);
                this.startGame();
            });
        }, (progress) => {
            this.textElem.innerText = this.localization("Download Game Data") + progress;
        }, true, {responseType: "arraybuffer", method: "GET"});
    }
    initModule(wasmData) {
        window.Module = {
            'TOTAL_MEMORY': 0x10000000,
            'noInitialRun': true,
            'onRuntimeInitialized': this.downloadRom.bind(this),
            'arguments': [],
            'preRun': [],
            'postRun': [],
            'canvas': this.canvas,
            'print': (msg) => {
                if (this.debug) {
                    console.log(msg);
                }
            },
            'printErr': (msg) => {
                if (this.debug) {
                    console.log(msg);
                }
            },
            'totalDependencies': 0,
            'monitorRunDependencies': () => {},
            'locateFile': function(fileName) {
                console.log(fileName);
                if (fileName.endsWith(".wasm")) {
                    return URL.createObjectURL(new Blob([wasmData], {type: "application/wasm"}));
                }
            },
            'readAsync': function(a, b, c) {
                console.log(a, b, c)
            }
        };
        this.Module = window.Module;
    }
    startGame() {
        this.textElem.remove();
        this.textElem = null;
        this.game.classList.remove("ejs_game");
        this.game.appendChild(this.canvas);
        const args = [];
        if (this.debug) args.push('-v');
        args.push('/game');
        this.Module.callMain(args);
        this.Module.resumeMainLoop();
        this.started = true;
        this.paused = false;
        
        //this needs to be fixed...
        setInterval(() => {
            if (document.fullscreenElement !== null) {
                this.Module.setCanvasSize(this.canvas.getBoundingClientRect().width-10, this.canvas.getBoundingClientRect().height-10);
            } else {
                this.Module.setCanvasSize(800, 600);
            }
        }, 100)
    }
    bindListeners() {
        this.createContextMenu();
        this.createBottomMenuBar();
        this.createControlSettingMenu();
        this.addEventListener(document, "keydown keyup", this.keyChange.bind(this));
        //keyboard, etc...
    }
    createContextMenu() {
        this.elements.contextmenu = this.createElement('div');
        this.elements.contextmenu.classList.add("ejs_context_menu");
        this.addEventListener(this.game, 'contextmenu', (e) => {
            if (this.started) {
                this.elements.contextmenu.style.display = "block";
                this.elements.contextmenu.style.left = e.offsetX;
                this.elements.contextmenu.style.top = e.offsetY;
            }
            e.preventDefault();
        })
        const hideMenu = () => {
            this.elements.contextmenu.style.display = "none";
        }
        this.addEventListener(this.elements.contextmenu, 'contextmenu', (e) => e.preventDefault());
        this.addEventListener(this.elements.parent, 'contextmenu', (e) => e.preventDefault());
        this.addEventListener(this.game, 'mousedown', hideMenu);
        const parent = this.createElement("ul");
        const addButton = (title, hidden, functi0n) => {
            //<li><a href="#" onclick="return false">'+title+'</a></li>
            const li = this.createElement("li");
            if (hidden) li.hidden = true;
            const a = this.createElement("a");
            if (functi0n instanceof Function) {
                this.addEventListener(li, 'click', (e) => {
                    e.preventDefault();
                    functi0n();
                });
            }
            a.href = "#";
            a.onclick = "return false";
            a.innerText = title;
            li.appendChild(a);
            parent.appendChild(li);
            hideMenu();
        }
        let screenshotUrl;
        addButton("Take Screenshot", false, () => {
            if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
            const screenshot = this.gameManager.screenshot();
            const blob = new Blob([screenshot]);
            screenshotUrl = URL.createObjectURL(blob);
            const a = this.createElement("a");
            a.href = screenshotUrl;
            a.download = "screenshot.png";
            a.click();
            hideMenu();
        });
        addButton("Quick Save", false, () => {
            this.gameManager.quickSave();
            hideMenu();
        });
        addButton("Quick Load", false, () => {
            this.gameManager.quickLoad();
            hideMenu();
        });
        addButton("EmulatorJS", false, () => {
            hideMenu();
            const body = this.createPopup("EmulatorJS", {
                "Close": () => {
                    this.closePopup();
                }
            });
            body.innerText = "Todo. Write about, include tabs on side with licenses, links to docs/repo/discord?";
            
        });
        
        this.elements.contextmenu.appendChild(parent);
        
        this.elements.parent.appendChild(this.elements.contextmenu);
    }
    closePopup() {
        if (this.currentPopup !== null) {
            try {
                this.currentPopup.remove();
            } catch(e){}
            this.currentPopup = null;
        }
    }
    //creates a full box popup.
    createPopup(popupTitle, buttons, hidden) {
        if (!hidden) this.closePopup();
        const popup = this.createElement('div');
        popup.classList.add("ejs_popup_container");
        this.elements.parent.appendChild(popup);
        const title = this.createElement("h4");
        title.innerText = popupTitle;
        const main = this.createElement("div");
        main.classList.add("ejs_popup_body");
        
        popup.appendChild(title);
        popup.appendChild(main);
        
        for (let k in buttons) {
            const button = this.createElement("a");
            if (buttons[k] instanceof Function) {
                button.addEventListener("click", (e) => {
                    buttons[k]();
                    e.preventDefault();
                });
            }
            button.classList.add("ejs_button");
            button.innerText = k;
            popup.appendChild(button);
        }
        if (!hidden) {
            this.currentPopup = popup;
        } else {
            popup.style.display = "none";
        }
        
        return main;
    }
    selectFile() {
        return new Promise((resolve, reject) => {
            const file = this.createElement("input");
            file.type = "file";
            this.addEventListener(file, "change", (e) => {
                resolve(e.target.files[0]);
            })
            file.click();
        })
    }
    createBottomMenuBar() {
        this.elements.menu = this.createElement("div");
        this.elements.menu.classList.add("ejs_menu_bar");
        this.elements.menu.classList.add("ejs_menu_bar_hidden");
        
        let timeout = null;
        const hide = () => {
            if (this.paused) return;
            this.elements.menu.classList.add("ejs_menu_bar_hidden");
        }
        
        this.addEventListener(this.elements.parent, 'mousemove click', (e) => {
            if (!this.started) return;
            if (timeout !== null) clearTimeout(timeout);
            timeout = setTimeout(hide, 3000);
            this.elements.menu.classList.remove("ejs_menu_bar_hidden");
        })
        this.menu = {
            close: () => {
                if (!this.started) return;
                if (timeout !== null) clearTimeout(timeout);
                this.elements.menu.classList.remove("ejs_menu_bar_hidden");
            },
            open: () => {
                if (!this.started) return;
                if (timeout !== null) clearTimeout(timeout);
                timeout = setTimeout(hide, 3000);
                this.elements.menu.classList.remove("ejs_menu_bar_hidden");
            }
        }
        this.elements.parent.appendChild(this.elements.menu);
        
        //Now add buttons
        const addButton = (title, image, callback) => {
            const button = this.createElement("button");
            button.type = "button";
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute("role", "presentation");
            svg.setAttribute("focusable", "false");
            svg.innerHTML = image;
            const text = this.createElement("span");
            text.innerText = title;
            text.classList.add("ejs_menu_text");
            
            button.classList.add("ejs_menu_button");
            button.appendChild(svg);
            button.appendChild(text);
            this.elements.menu.appendChild(button);
            if (callback instanceof Function) {
                this.addEventListener(button, 'click', callback);
            }
            return button;
        }
        
        //todo. Center text on not restart button
        
        addButton("Restart", '<svg viewBox="0 0 512 512"><path d="M496 48V192c0 17.69-14.31 32-32 32H320c-17.69 0-32-14.31-32-32s14.31-32 32-32h63.39c-29.97-39.7-77.25-63.78-127.6-63.78C167.7 96.22 96 167.9 96 256s71.69 159.8 159.8 159.8c34.88 0 68.03-11.03 95.88-31.94c14.22-10.53 34.22-7.75 44.81 6.375c10.59 14.16 7.75 34.22-6.375 44.81c-39.03 29.28-85.36 44.86-134.2 44.86C132.5 479.9 32 379.4 32 256s100.5-223.9 223.9-223.9c69.15 0 134 32.47 176.1 86.12V48c0-17.69 14.31-32 32-32S496 30.31 496 48z"/></svg>', () => {
            this.gameManager.restart();
        });
        const pauseButton = addButton("Pause", '<svg viewBox="0 0 320 512"><path d="M272 63.1l-32 0c-26.51 0-48 21.49-48 47.1v288c0 26.51 21.49 48 48 48L272 448c26.51 0 48-21.49 48-48v-288C320 85.49 298.5 63.1 272 63.1zM80 63.1l-32 0c-26.51 0-48 21.49-48 48v288C0 426.5 21.49 448 48 448l32 0c26.51 0 48-21.49 48-48v-288C128 85.49 106.5 63.1 80 63.1z"/></svg>', () => {
            this.togglePlaying();
        });
        const playButton = addButton("Play", '<svg viewBox="0 0 320 512"><path d="M361 215C375.3 223.8 384 239.3 384 256C384 272.7 375.3 288.2 361 296.1L73.03 472.1C58.21 482 39.66 482.4 24.52 473.9C9.377 465.4 0 449.4 0 432V80C0 62.64 9.377 46.63 24.52 38.13C39.66 29.64 58.21 29.99 73.03 39.04L361 215z"/></svg>', () => {
            this.togglePlaying();
        });
        playButton.style.display = "none";
        this.togglePlaying = () => {
            this.paused = !this.paused;
            if (this.paused) {
                pauseButton.style.display = "none";
                playButton.style.display = "";
            } else {
                pauseButton.style.display = "";
                playButton.style.display = "none";
            }
            this.gameManager.toggleMainLoop(this.paused ? 0 : 1);
        }
        
        
        let stateUrl;
        addButton("Save State", '<svg viewBox="0 0 448 512"><path fill="currentColor" d="M433.941 129.941l-83.882-83.882A48 48 0 0 0 316.118 32H48C21.49 32 0 53.49 0 80v352c0 26.51 21.49 48 48 48h352c26.51 0 48-21.49 48-48V163.882a48 48 0 0 0-14.059-33.941zM224 416c-35.346 0-64-28.654-64-64 0-35.346 28.654-64 64-64s64 28.654 64 64c0 35.346-28.654 64-64 64zm96-304.52V212c0 6.627-5.373 12-12 12H76c-6.627 0-12-5.373-12-12V108c0-6.627 5.373-12 12-12h228.52c3.183 0 6.235 1.264 8.485 3.515l3.48 3.48A11.996 11.996 0 0 1 320 111.48z"/></svg>', async () => {
            if (stateUrl) URL.revokeObjectURL(stateUrl);
            const state = await this.gameManager.getState();
            const blob = new Blob([state]);
            stateUrl = URL.createObjectURL(blob);
            const a = this.createElement("a");
            a.href = stateUrl;
            a.download = "game.state";
            a.click();
        });
        addButton("Load State", '<svg viewBox="0 0 576 512"><path fill="currentColor" d="M572.694 292.093L500.27 416.248A63.997 63.997 0 0 1 444.989 448H45.025c-18.523 0-30.064-20.093-20.731-36.093l72.424-124.155A64 64 0 0 1 152 256h399.964c18.523 0 30.064 20.093 20.73 36.093zM152 224h328v-48c0-26.51-21.49-48-48-48H272l-64-64H48C21.49 64 0 85.49 0 112v278.046l69.077-118.418C86.214 242.25 117.989 224 152 224z"/></svg>', async () => {
            const file = await this.selectFile();
            const state = new Uint8Array(await file.arrayBuffer());
            this.gameManager.loadState(state);
        });
        addButton("Control Settings", '<svg viewBox="0 0 640 512"><path fill="currentColor" d="M480 96H160C71.6 96 0 167.6 0 256s71.6 160 160 160c44.8 0 85.2-18.4 114.2-48h91.5c29 29.6 69.5 48 114.2 48 88.4 0 160-71.6 160-160S568.4 96 480 96zM256 276c0 6.6-5.4 12-12 12h-52v52c0 6.6-5.4 12-12 12h-40c-6.6 0-12-5.4-12-12v-52H76c-6.6 0-12-5.4-12-12v-40c0-6.6 5.4-12 12-12h52v-52c0-6.6 5.4-12 12-12h40c6.6 0 12 5.4 12 12v52h52c6.6 0 12 5.4 12 12v40zm184 68c-26.5 0-48-21.5-48-48s21.5-48 48-48 48 21.5 48 48-21.5 48-48 48zm80-80c-26.5 0-48-21.5-48-48s21.5-48 48-48 48 21.5 48 48-21.5 48-48 48z"/></svg>', () => {
            this.controlMenu.style.display = "";
        });
        
        const spacer = this.createElement("span");
        spacer.style = "flex:1;";
        this.elements.menu.appendChild(spacer);
        
        
        const enter = addButton("Enter Fullscreen", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M208 281.4c-12.5-12.5-32.76-12.5-45.26-.002l-78.06 78.07l-30.06-30.06c-6.125-6.125-14.31-9.367-22.63-9.367c-4.125 0-8.279 .7891-12.25 2.43c-11.97 4.953-19.75 16.62-19.75 29.56v135.1C.0013 501.3 10.75 512 24 512h136c12.94 0 24.63-7.797 29.56-19.75c4.969-11.97 2.219-25.72-6.938-34.87l-30.06-30.06l78.06-78.07c12.5-12.49 12.5-32.75 .002-45.25L208 281.4zM487.1 0h-136c-12.94 0-24.63 7.797-29.56 19.75c-4.969 11.97-2.219 25.72 6.938 34.87l30.06 30.06l-78.06 78.07c-12.5 12.5-12.5 32.76 0 45.26l22.62 22.62c12.5 12.5 32.76 12.5 45.26 0l78.06-78.07l30.06 30.06c9.156 9.141 22.87 11.84 34.87 6.937C504.2 184.6 512 172.9 512 159.1V23.1C512 10.74 501.3 0 487.1 0z"/></svg>', () => {
            if (this.elements.parent.requestFullscreen) {
                this.elements.parent.requestFullscreen();
            } else if (this.elements.parent.mozRequestFullScreen) {
                this.elements.parent.mozRequestFullScreen();
            } else if (this.elements.parent.webkitRequestFullscreen) {
                this.elements.parent.webkitRequestFullscreen();
            } else if (this.elements.parent.msRequestFullscreen) {
                this.elements.parent.msRequestFullscreen();
            }
            exit.style.display = "";
            enter.style.display = "none";
        });
        const exit = addButton("Exit Fullscreen", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M215.1 272h-136c-12.94 0-24.63 7.797-29.56 19.75C45.47 303.7 48.22 317.5 57.37 326.6l30.06 30.06l-78.06 78.07c-12.5 12.5-12.5 32.75-.0012 45.25l22.62 22.62c12.5 12.5 32.76 12.5 45.26 .0013l78.06-78.07l30.06 30.06c6.125 6.125 14.31 9.367 22.63 9.367c4.125 0 8.279-.7891 12.25-2.43c11.97-4.953 19.75-16.62 19.75-29.56V296C239.1 282.7 229.3 272 215.1 272zM296 240h136c12.94 0 24.63-7.797 29.56-19.75c4.969-11.97 2.219-25.72-6.938-34.87l-30.06-30.06l78.06-78.07c12.5-12.5 12.5-32.76 .0002-45.26l-22.62-22.62c-12.5-12.5-32.76-12.5-45.26-.0003l-78.06 78.07l-30.06-30.06c-9.156-9.141-22.87-11.84-34.87-6.937c-11.97 4.953-19.75 16.62-19.75 29.56v135.1C272 229.3 282.7 240 296 240z"/></svg>', () => {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
            exit.style.display = "none";
            enter.style.display = "";
        });
        exit.style.display = "none";
        
    }
    createControlSettingMenu() {
        this.controls = this.defaultControllers;
        const body = this.createPopup("Control Settings", {
            "Close": () => {
                this.controlMenu.style.display = "none";
            }
        }, true);
        this.controlMenu = body.parentElement;
        body.classList.add("ejs_control_body");
        
        const buttons = {
            0: 'B',
            1: 'Y',
            2: 'SELECT',
            3: 'START',
            4: 'UP',
            5: 'DOWN',
            6: 'LEFT',
            7: 'RIGHT',
            8: 'A',
            9: 'X',
            10: 'L',
            11: 'R',
            12: 'L2',
            13: 'R2',
            14: 'L3',
            15: 'R3',
            19: 'L STICK UP',
            18: 'L STICK DOWN',
            17: 'L STICK LEFT',
            16: 'L STICK RIGHT',
            23: 'R STICK UP',
            22: 'R STICK DOWN',
            21: 'R STICK LEFT',
            20: 'R STICK RIGHT',
            24: this.localization('QUICK SAVE STATE'),
            25: this.localization('QUICK LOAD STATE'),
            26: this.localization('CHANGE STATE SLOT')
        }
        let selectedPlayer;
        let players = [];
        let playerDivs = [];
        
        const playerSelect = this.createElement("ul");
        playerSelect.classList.add("ejs_control_player_bar");
        for (let i=1; i<5; i++) {
            const playerContainer = this.createElement("li");
            playerContainer.classList.add("tabs-title");
            playerContainer.setAttribute("role", "presentation");
            const player = this.createElement("a");
            player.innerText = "Player "+i;
            player.setAttribute("role", "tab");
            player.setAttribute("aria-controls", "controls-"+(i-1));
            player.setAttribute("aria-selected", "false");
            player.id = "controls-"+(i-1)+"-label";
            this.addEventListener(player, "click", (e) => {
                e.preventDefault();
                players[selectedPlayer].classList.remove("ejs_control_selected");
                playerDivs[selectedPlayer].setAttribute("hidden", "");
                selectedPlayer = i-1;
                players[i-1].classList.add("ejs_control_selected");
                playerDivs[i-1].removeAttribute("hidden");
            })
            playerContainer.appendChild(player);
            playerSelect.appendChild(playerContainer);
            players.push(playerContainer);
        }
        body.appendChild(playerSelect);
        
        
        const controls = this.createElement("div");
        for (let i=0; i<4; i++) {
            const player = this.createElement("div");
            const playerTitle = this.createElement("div");
            
            const gamepadTitle = this.createElement("div");
            gamepadTitle.style = "font-size:12px;";
            gamepadTitle.innerText = "Connected Gamepad: ";
            
            const gamepadName = this.createElement("span");
            gamepadName.innerText = "n/a";
            gamepadTitle.appendChild(gamepadName);
            
            const leftPadding = this.createElement("div");
            leftPadding.style = "width:25%;float:left;";
            leftPadding.innerHTML = "&nbsp;";
            
            const aboutParent = this.createElement("div");
            aboutParent.style = "font-size:12px;width:50%;float:left;";
            const gamepad = this.createElement("div");
            gamepad.style = "text-align:center;width:50%;float:left;";
            gamepad.innerText = "Gamepad";
            aboutParent.appendChild(gamepad);
            const keyboard = this.createElement("div");
            keyboard.style = "text-align:center;width:50%;float:left;";
            keyboard.innerText = "Keyboard";
            aboutParent.appendChild(keyboard);
            
            const headingPadding = this.createElement("div");
            headingPadding.style = "clear:both;";
            
            playerTitle.appendChild(gamepadTitle);
            playerTitle.appendChild(leftPadding);
            playerTitle.appendChild(aboutParent);
            playerTitle.appendChild(headingPadding);
            
            
            player.appendChild(playerTitle);
            
            for (const k in buttons) {
                const buttonText = this.createElement("div");
                buttonText.setAttribute("data-id", k);
                buttonText.setAttribute("data-index", i);
                buttonText.setAttribute("data-label", buttons[k]);
                buttonText.style = "margin-bottom:10px;";
                buttonText.classList.add("ejs_control_bar");
                
                
                const title = this.createElement("div");
                title.style = "width:25%;float:left;font-size:12px;";
                const label = this.createElement("label");
                label.innerText = buttons[k]+":";
                title.appendChild(label);
                
                const textBoxes = this.createElement("div");
                textBoxes.style = "width:50%;float:left;";
                
                const textBox1Parent = this.createElement("div");
                textBox1Parent.style = "width:50%;float:left;padding: 0 5px;";
                const textBox1 = this.createElement("input");
                textBox1.style = "text-align:center;height:25px;width: 100%;";
                textBox1.type = "text";
                textBox1.setAttribute("readonly", "");
                textBox1.setAttribute("placeholder", "");
                textBox1Parent.appendChild(textBox1);
                
                const textBox2Parent = this.createElement("div");
                textBox2Parent.style = "width:50%;float:left;padding: 0 5px;";
                const textBox2 = this.createElement("input");
                textBox2.style = "text-align:center;height:25px;width: 100%;";
                textBox2.type = "text";
                textBox2.setAttribute("readonly", "");
                textBox2.setAttribute("placeholder", "");
                textBox2Parent.appendChild(textBox2);
                
                if (this.controls[i][k] && this.controls[i][k].value) {
                    textBox2.value = this.controls[i][k].value;
                }
                if (this.controls[i][k] && this.controls[i][k].value2) {
                    textBox1.value = this.controls[i][k].value2;
                }
                
                textBoxes.appendChild(textBox1Parent);
                textBoxes.appendChild(textBox2Parent);
                
                const padding = this.createElement("div");
                padding.style = "clear:both;";
                textBoxes.appendChild(padding);
                
                const setButton = this.createElement("div");
                setButton.style = "width:25%;float:left;";
                const button = this.createElement("button");
                button.innerText = "Set";
                setButton.appendChild(button);
                
                const padding2 = this.createElement("div");
                padding2.style = "clear:both;";
                
                buttonText.appendChild(title);
                buttonText.appendChild(textBoxes);
                buttonText.appendChild(setButton);
                buttonText.appendChild(padding2);
                
                player.appendChild(buttonText);
                
                this.addEventListener(buttonText, "mousedown", (e) => {
                    e.preventDefault();
                    this.controlPopup.parentElement.removeAttribute("hidden");
                    this.controlPopup.innerText = "[ " + buttons[k] + " ]\ntest";
                    this.controlPopup.setAttribute("button-num", k);
                    this.controlPopup.setAttribute("player-num", i);
                    this.updateTextBoxes = () => {
                        if (this.controls[i][k] && this.controls[i][k].value) {
                            textBox2.value = this.controls[i][k].value;
                        }
                        if (this.controls[i][k] && this.controls[i][k].value2) {
                            textBox1.value = this.controls[i][k].value2;
                        }
                        delete this.updateTextBoxes;
                    }
                })
            }
            controls.appendChild(player);
            player.setAttribute("hidden", "");
            playerDivs.push(player);
        }
        body.appendChild(controls);
        
        
        selectedPlayer = 0;
        players[0].classList.add("ejs_control_selected");
        playerDivs[0].removeAttribute("hidden");
        
        
        const popup = this.createElement('div');
        popup.classList.add("ejs_popup_container");
        const popupMsg = this.createElement("div");
        popupMsg.classList.add("ejs_popup_box");
        popupMsg.innerText = "yes";
        popup.setAttribute("hidden", "");
        this.controlPopup = popupMsg;
        popup.appendChild(popupMsg);
        this.controlMenu.appendChild(popup);
    }
    defaultControllers = {
        0: {
            0: {
                'value': 'x'
            },
            1: {
                'value': 's'
            },
            2: {
                'value': 'v'
            },
            3: {
                'value': 'enter'
            },
            4: {
                'value': 'arrowup'
            },
            5: {
                'value': 'arrowdown'
            },
            6: {
                'value': 'arrowleft'
            },
            7: {
                'value': 'arrowright'
            },
            8: {
                'value': 'z'
            },
            9: {
                'value': 'a'
            },
            10: {
                'value': 'q'
            },
            11: {
                'value': 'e'
            },
            12: {
                'value': 'e'
            },
            13: {
                'value': 'w'
            },
            14: {},
            15: {},
            16: {
                'value': 'h'
            },
            17: {
                'value': 'f'
            },
            18: {
                'value': 'g'
            },
            19: {
                'value': 't'
            },
            20: {'value': 'l'},
            21: {'value': 'j'},
            22: {'value': 'k'},
            23: {'value': 'i'},
            24: {},
            25: {},
            26: {}
        },
        1: {},
        2: {},
        3: {}
    }
    controls;
    keyChange(e) {
        if (!this.started) return;
        e.preventDefault();
        if (this.controlPopup.parentElement.getAttribute("hidden") === null) {
            const num = this.controlPopup.getAttribute("button-num");
            const player = this.controlPopup.getAttribute("player-num");
            if (!this.controls[player][num]) {
                this.controls[player][num] = {};
            }
            this.controls[player][num].value = e.key.toLowerCase();
            this.controlPopup.parentElement.setAttribute("hidden", "");
            this.updateTextBoxes();
            return;
        }
        const special = [16, 17, 18, 19, 20, 21, 22, 23];
        for (let i=0; i<4; i++) {
            for (let j=0; j<26; j++) {
                if (this.controls[i][j] && this.controls[i][j].value === e.key.toLowerCase()) {
                    this.gameManager.simulateInput(i, j, (e.type === 'keyup' ? 0 : (special.includes(j) ? 0x7fff : 1)));
                }
            }
        }
        
    }
}
