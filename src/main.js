const { app, BrowserWindow, ipcMain, webContents, Menu  } = require("electron");
const path = require("node:path");
const fs = require('fs');

console.log("🚨 MAIN FILE LOADED FROM:", __filename);
console.log("🚨 __dirname:", __dirname);
console.log("🚨 isPackaged:", app.isPackaged);
console.log("🚨 resourcesPath:", process.resourcesPath);

const { spawn } = require('child_process');
let ollamaProcess = null;


async function ensureModel(model) {
  const res = await fetch("http://127.0.0.1:11434/api/tags");
  const data = await res.json();

  const exists = data.models?.some(m => m.name === model);
  if (exists) {
    console.log("✅ Model already present:", model);
    return;
  }

  console.log("⬇️ Pulling model:", model);

  const pullRes = await fetch("http://127.0.0.1:11434/api/pull", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model })
  });

  if (!pullRes.ok) {
    throw new Error("Model pull failed");
  }

  console.log("✅ Model pulled:", model);
}


function getOllamaPath() {
  const basePath = app.isPackaged
    ? process.resourcesPath        // when packaged
    : app.getAppPath();            // project root in dev

  const ollamaPath = path.join(
    basePath,
    "ollama-bin",
    "win",
    "ollama.exe"
  );

  if (!fs.existsSync(ollamaPath)) {
    console.warn("⚠️ Ollama binary not found at: " + ollamaPath);
    return null;
  }

  return ollamaPath;
}

async function waitForOllamaReady(timeoutMs = 60_000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch("http://127.0.0.1:11434/api/tags");
      if (res.ok) {
        console.log("✅ Ollama is ready");
        return;
      }
    } catch (_) {}

    await new Promise(r => setTimeout(r, 500));
  }

  throw new Error("❌ Ollama did not become ready in time");
}



function startOllama() {

  if (ollamaProcess) return; // 🛑 prevent double start

  const ollamaPath = getOllamaPath();
  if (!ollamaPath) return; // Not installed

  console.log('[ollama] starting:', ollamaPath);

  ollamaProcess = spawn(ollamaPath, ['serve'], {
    windowsHide: true,
    stdio: 'inherit' // DEBUG MODE
  });

  ollamaProcess.on('error', (err) => {
    console.error('[ollama] failed:', err);
  });

  ollamaProcess.on('exit', (code) => {
    console.log('[ollama] exited with code', code);
  });
}

function stopOllama() {
  if (!ollamaProcess) return;

  try {
    ollamaProcess.kill(); // SIGTERM on Windows
    ollamaProcess = null;
  } catch (err) {
    console.error('[ollama] failed to stop:', err);
  }
}


function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  win.loadFile(path.join(__dirname, "renderer/index.html"));
  win.webContents.openDevTools();
}

app.whenReady().then(async () => {
  createWindow();
  startOllama();

  const ollamaPath = getOllamaPath();
  if (ollamaPath) {
    try {
      // wait a moment for server to be ready
      await waitForOllamaReady();

      const model = 'qwen3-vl:4b-instruct';
      await ensureModel(model);

      console.log('[ollama] model ready:', model);
      console.log("🚀 Ollama fully online");
    } catch (err) {
      console.error('[ollama] setup failed:', err);
    }
  } else {
    console.log("⚠️ Ollama not installed, skipping startup logic.");
  }
});

ipcMain.handle("check-ollama", async () => {
  return getOllamaPath() !== null;
});

// Hook to ALL exit paths

app.on('before-quit', () => {
  stopOllama();
});

app.on('window-all-closed', () => {
  stopOllama();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

process.on('exit', () => {
  stopOllama();
});

process.on('SIGINT', () => {
  stopOllama();
  process.exit();
});

process.on('SIGTERM', () => {
  stopOllama();
  process.exit();
});


function getWC(id) {
  return webContents.fromId(id);
}

// ============================================
// OVERLAY CODE - Draws boxes around elements
// ============================================
const NETRA_OVERLAY_CODE = `
(() => {
  if (window.__NETRA_INSTALLED__) return;
  window.__NETRA_INSTALLED__ = true;

  function getType(el) {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return "input";
    if (el.tagName === "SELECT") return "dropdown";
    if (el.tagName === "BUTTON") return "button";
    if (el.tagName === "A") return "link";
    if (el.getAttribute("role") === "button") return "button";
    return "element";
  }

  function getColorByType(type) {
    return {
      input: "#00ff00",
      button: "#3399ff",
      link: "#aa66ff",
      dropdown: "#ff9900",
      element: "#ff4444"
    }[type];
  }

  let overlay = document.getElementById("__netra_overlay__");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "__netra_overlay__";
    overlay.style.cssText = \`
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483647;
    \`;
    document.body.appendChild(overlay);
  }

  const BOXES = {};
  let counter = window.__NETRA_NID_COUNTER__ || 1;
  window.__NETRA_NID_COUNTER__ = counter;
  let scheduled = false;

  function drawOrUpdate(el) {
    if (!el.dataset.netraId) {
      el.dataset.netraId = "N" + window.__NETRA_NID_COUNTER__++;
    }

    const id = el.dataset.netraId;
    const rect = el.getBoundingClientRect();
    if (!rect || rect.width < 10 || rect.height < 10) return;

    const type = getType(el);
    const color = getColorByType(type);

    let box = BOXES[id];
    if (!box) {
      box = document.createElement("div");
      box.style.position = "absolute";
      box.style.border = "3px solid " + color;
      box.style.background = color + "22";
      box.style.boxSizing = "border-box";

      const label = document.createElement("div");
      label.textContent = id;
      label.style.background = color;
      label.style.color = "#000";
      label.style.border = "1px solid " + color;
      label.style.font = "bold 11px monospace";
      label.style.padding = "0 4px";
      label.style.borderRadius = "2px";
      label.style.boxShadow = "0 0 2px rgba(0,0,0,0.4)";
      label.style.position = "absolute";
      label.style.top = "-16px";
      label.style.left = "0";

      box.appendChild(label);
      overlay.appendChild(box);
      BOXES[id] = box;
    }

    box.style.left = rect.left + "px";
    box.style.top = rect.top + "px";
    box.style.width = rect.width + "px";
    box.style.height = rect.height + "px";
    box.dataset.netraId = id;
    box.dataset.cx = rect.left + rect.width / 2;
    box.dataset.cy = rect.top + rect.height / 2;
  }

  function scan() {
    if (scheduled) return;
    scheduled = true;

    requestAnimationFrame(() => {
      scheduled = false;
      document.querySelectorAll(
        "a, button, input, textarea, select, [role='button']"
      ).forEach(drawOrUpdate);
    });
  }

  scan();
  new MutationObserver(scan).observe(document, {
    subtree: true,
    childList: true
  });
  window.addEventListener("scroll", scan, { passive: true });
  window.addEventListener("resize", scan);
})();
`;

// ============================================
// RUNTIME CODE - Action execution engine
// ============================================
const NETRA_RUNTIME_CODE = `
(() => {
  /* ================= HUD ================= */
  if (!window.__NETRA_HUD__) {
    window.__NETRA_HUD__ = true;

    const hud = document.createElement("div");
    hud.id = "__netra_hud__";
    hud.style.cssText = \`
      position:fixed;
      top:8px;
      right:8px;
      background:rgba(0,0,0,0.85);
      color:#fff;
      font:11px monospace;
      padding:6px 8px;
      z-index:2147483647;
      max-width:40vw;
    \`;

    hud.innerHTML =
      '<div id="netra-step">STEP: —</div>' +
      '<div id="netra-last-action">LAST: —</div>' +
      '<div id="netra-page-state">PAGE: STABLE</div>';

    document.body.appendChild(hud);
  }

  /* ================= VISUAL HELPERS ================= */
  window.__NETRA_VISUAL__ = window.__NETRA_VISUAL__ || {};

  window.__NETRA_VISUAL__.updateHUD = function(last, page) {
    const l = document.getElementById("netra-last-action");
    const p = document.getElementById("netra-page-state");
    if (l) l.textContent = "LAST: " + last;
    if (p) p.textContent = "PAGE: " + page;
  };

  window.__NETRA_VISUAL__.markClicked = function(nid) {
    const el = document.querySelector('[data-netra-id="' + nid + '"]');
    if (!el || el.dataset.netraClicked) return;
    el.dataset.netraClicked = "true";
    el.style.outline = "4px solid #3399ff";
  };

  window.__NETRA_VISUAL__.markTyped = function(nid) {
    const el = document.querySelector('[data-netra-id="' + nid + '"]');
    if (!el || el.dataset.netraTyped) return;
    el.dataset.netraTyped = "true";
    el.style.outline = "4px solid #00ff00";
  };

  /* ================= HELPERS ================= */
  function getActiveEditableElement() {
    const el = document.activeElement;
    if (!el) return null;

    if (
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.isContentEditable
    ) {
      return el;
    }

    return document.querySelector('[contenteditable="true"]:focus');
  }

  function humanKey(el, key) {
    ["keydown", "keypress", "keyup"].forEach(type => {
      el.dispatchEvent(new KeyboardEvent(type, {
        key,
        bubbles: true,
        cancelable: true
      }));
    });
  }

  function realClick(el) {
    el.scrollIntoView({ block: "center" });
    
    setTimeout(() => {
      el.click();
    }, 100);
  }

  /* ================= ACTION EXECUTOR ================= */
  window.__NETRA_EXECUTE_ACTION__ = function(action) {
    try {
      if (!action || !action.type) {
        console.error("Invalid action:", action);
        return false;
      }

      const nid = action?.id ? action.id.toUpperCase() : null;
      const el = nid
        ? document.querySelector('[data-netra-id="' + nid + '"]')
        : document.activeElement;

      if (!el && action.type !== "navigate" && action.type !== "scroll" && action.type !== "back" && action.type !== "forward") {
        console.error("Element not found for NID:", nid);
        return false;
      }

      switch (action.type) {
        case "type":
          if (!el) return false;
          el.focus();
          el.value = action.value || "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          if (el.onchange) {
            el.onchange(new Event("change", { bubbles: true }));
          }
          window.__NETRA_VISUAL__.markTyped(nid);
          window.__NETRA_VISUAL__.updateHUD("TYPE " + nid, "PAGE: STABLE");
          break;

        case "click":
          if (!el) return false;
          realClick(el);
          window.__NETRA_VISUAL__.markClicked(nid);
          window.__NETRA_VISUAL__.updateHUD("CLICK " + nid, "PAGE: PROCESSING");
          break;

        case "key":
          const editEl = getActiveEditableElement();
          if (!editEl) {
            console.warn("No active editable element for key");
            return false;
          }

          if (action.key === "Enter") {
            if (editEl.form && editEl.form.requestSubmit) {
              editEl.form.requestSubmit();
            } else {
              humanKey(editEl, "Enter");
            }
          } else {
            humanKey(editEl, action.key);
          }

          window.__NETRA_VISUAL__.updateHUD(
            "KEY " + action.key,
            "PAGE: PROCESSING"
          );
          break;

        case "scroll":
          window.scrollBy({ top: action.amount || 600 });
          window.__NETRA_VISUAL__.updateHUD("SCROLL", "PAGE: MOVED");
          break;

        case "navigate":
          if (action.url) {
            location.href = action.url;
            window.__NETRA_VISUAL__.updateHUD("NAVIGATE", "PAGE: LOADING");
          }
          break;

        case "back":
          history.back();
          window.__NETRA_VISUAL__.updateHUD("BACK", "PAGE: LOADING");
          break;

        case "forward":
          history.forward();
          window.__NETRA_VISUAL__.updateHUD("FORWARD", "PAGE: LOADING");
          break;

        case "wait":
          const ms = action.ms || 800;
          return new Promise(r => setTimeout(r, ms));

        default:
          console.warn("Unknown action type:", action.type);
          return false;
      }

      return true;
    } catch (e) {
      console.error("NETRA EXEC ERROR", e);
      return false;
    }
  };
})();
`;

// ============================================
// HUD CODE - Status display
// ============================================
const NETRA_HUD_RUNTIME_CODE = `
(() => {
  if (!window.__NETRA_HUD__) {
    window.__NETRA_HUD__ = true;

    const hud = document.createElement("div");
    hud.id = "__netra_hud__";
    hud.style.position = "fixed";
    hud.style.top = "8px";
    hud.style.right = "8px";
    hud.style.background = "rgba(0,0,0,0.85)";
    hud.style.color = "#fff";
    hud.style.fontFamily = "monospace";
    hud.style.fontSize = "11px";
    hud.style.padding = "6px 8px";
    hud.style.zIndex = "2147483647";
    hud.style.maxWidth = "40vw";

    const step = document.createElement("div");
    step.id = "netra-step";
    step.textContent = "STEP: —";

    const last = document.createElement("div");
    last.id = "netra-last-action";
    last.textContent = "LAST: —";

    const page = document.createElement("div");
    page.id = "netra-page-state";
    page.textContent = "PAGE: STABLE";

    hud.appendChild(step);
    hud.appendChild(last);
    hud.appendChild(page);
    document.body.appendChild(hud);
  }

  window.__NETRA_VISUAL__ = window.__NETRA_VISUAL__ || {};

  window.__NETRA_VISUAL__.updateHUD = function(last, page) {
    const l = document.getElementById("netra-last-action");
    const p = document.getElementById("netra-page-state");
    if (l) l.textContent = "LAST: " + last;
    if (p) p.textContent = "PAGE: " + page;
  };

  window.__NETRA_VISUAL__.markClicked = function(nid) {
    const el = document.querySelector('[data-netra-id="' + nid + '"]');
    if (!el || el.dataset.netraClicked) return;
    el.dataset.netraClicked = "true";
    el.style.outline = "4px solid #3399ff";
  };

  window.__NETRA_VISUAL__.markTyped = function(nid) {
    const el = document.querySelector('[data-netra-id="' + nid + '"]');
    if (!el || el.dataset.netraTyped) return;
    el.dataset.netraTyped = "true";
    el.style.outline = "4px solid #00ff00";
  };
})();
`;

// ============================================
// IPC HANDLERS - Attach CDP
// ============================================

ipcMain.handle("electron:attach-cdp", async (_, wcId) => {
  try {
    const wc = getWC(wcId);
    if (!wc) {
      throw new Error(`WebContents ${wcId} not found`);
    }

    if (!wc.debugger.isAttached()) {
      wc.debugger.attach("1.3");
      console.log("✅ CDP attached to webview");
    }
    return true;
  } catch (err) {
    console.error("❌ Attach CDP failed:", err);
    throw err;
  }
});

// ============================================
// IPC HANDLERS - Inject Overlay
// ============================================

ipcMain.handle("electron:inject-overlay", async (_, wcId) => {
  try {
    const wc = getWC(wcId);
    if (!wc) {
      throw new Error(`WebContents ${wcId} not found`);
    }

    if (!wc.debugger.isAttached()) {
      wc.debugger.attach("1.3");
    }

    await wc.debugger.sendCommand("Runtime.evaluate", {
      expression: NETRA_OVERLAY_CODE,
      awaitPromise: true
    });
    console.log("🔥 Overlay injected into webview");
    return true;
  } catch (err) {
    console.error("❌ Inject overlay failed:", err);
    throw err;
  }
});

// ============================================
// IPC HANDLERS - Inject Runtime
// ============================================

ipcMain.handle("electron:inject-netra-runtime", async (_, wcId) => {
  try {
    const wc = getWC(wcId);
    if (!wc) {
      throw new Error(`WebContents ${wcId} not found`);
    }

    if (!wc.debugger.isAttached()) {
      wc.debugger.attach("1.3");
    }

    await wc.debugger.sendCommand("Runtime.evaluate", {
      expression: NETRA_RUNTIME_CODE,
      awaitPromise: true
    });
    console.log("🧠 NETRA runtime injected");
    return true;
  } catch (err) {
    console.error("❌ Inject runtime failed:", err);
    throw err;
  }
});

// ============================================
// IPC HANDLERS - Inject HUD
// ============================================

ipcMain.handle("electron:inject-netra-hud", async (_, wcId) => {
  try {
    const wc = getWC(wcId);
    if (!wc) {
      throw new Error(`WebContents ${wcId} not found`);
    }

    if (!wc.debugger.isAttached()) {
      wc.debugger.attach("1.3");
    }

    await wc.debugger.sendCommand("Runtime.evaluate", {
      expression: NETRA_HUD_RUNTIME_CODE,
      awaitPromise: true
    });
    console.log("🧩 NETRA HUD injected");
    return true;
  } catch (err) {
    console.error("❌ Inject HUD failed:", err);
    throw err;
  }
});

// ============================================
// IPC HANDLERS - Eval Code
// ============================================

ipcMain.handle("electron:eval", async (_, { wcId, code }) => {
  try {
    const wc = webContents.fromId(wcId);
    if (!wc) {
      throw new Error(`WebContents ${wcId} not found`);
    }

    if (!wc.debugger.isAttached()) {
      throw new Error("Debugger not attached");
    }

    const result = await wc.debugger.sendCommand("Runtime.evaluate", {
      expression: code,
      awaitPromise: true
    });

    if (result.exceptionDetails) {
      console.error("❌ Code execution error:", result.exceptionDetails);
      return null;
    }

    return result;
  } catch (err) {
    console.error("❌ CDP command failed:", err);
    throw err;
  }
});
// 

// ============================================
// IPC HANDLERS - Dispatch Key (Old Method)
// ============================================

ipcMain.handle("electron:dispatch-key", async (_, { wcId, key }) => {
  try {
    const wc = webContents.fromId(wcId);
    if (!wc) {
      throw new Error(`WebContents ${wcId} not found`);
    }

    const vk =
      key === "Enter" ? 13 :
        key === "Tab" ? 9 :
          key.startsWith("Arrow") ? 37 : 0;

    await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key,
      code: key,
      windowsVirtualKeyCode: vk
    });

    await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code: key,
      windowsVirtualKeyCode: vk
    });

    console.log("✅ CDP KEY SENT:", key);
    return true;
  } catch (err) {
    console.error("❌ Dispatch key failed:", err);
    throw err;
  }
});

// ============================================
// IPC HANDLERS - Capture Screenshot
// ============================================

ipcMain.handle("capture-webview", async (_, webContentsId) => {
  try {
    const wc = webContents.fromId(webContentsId);
    if (!wc) {
      throw new Error(`WebContents ${webContentsId} not found`);
    }

    const image = await wc.capturePage();
    const base64 = image.toPNG().toString("base64");
    console.log("✅ Screenshot captured");
    return base64;
  } catch (err) {
    console.error("❌ Screenshot failed:", err);
    throw err;
  }
});

// ============================================
// NEW: CDP CLICK HANDLER (YouTube Ready)
// ============================================

ipcMain.handle("electron:cdp-click", async (_, { wcId, x, y }) => {
  try {
    const wc = webContents.fromId(wcId);
    if (!wc) {
      throw new Error(`WebContents ${wcId} not found`);
    }

    if (!wc.debugger.isAttached()) {
      wc.debugger.attach("1.3");
    }

    // Move mouse
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y
    });

    // Mouse down
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1
    });

    // Mouse up
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1
    });

    console.log("✅ CDP CLICK sent:", x, y);
    return true;
  } catch (err) {
    console.error("❌ CDP click failed:", err);
    throw err;
  }
});

// ============================================
// NEW: CDP INSERT TEXT HANDLER (YouTube Ready)
// ============================================

ipcMain.handle("electron:cdp-insert-text", async (_, { wcId, text }) => {
  try {
    const wc = webContents.fromId(wcId);
    if (!wc) {
      throw new Error(`WebContents ${wcId} not found`);
    }

    if (!wc.debugger.isAttached()) {
      wc.debugger.attach("1.3");
    }

    await wc.debugger.sendCommand("Input.insertText", {
      text: text
    });

    console.log("✅ CDP TEXT inserted:", text);
    return true;
  } catch (err) {
    console.error("❌ CDP insert text failed:", err);
    throw err;
  }
});

// ============================================
// NEW: CDP KEY HANDLER (YouTube Ready)
// ============================================

ipcMain.handle("electron:cdp-key", async (_, { wcId, key, times = 1 }) => {
  try {
    const wc = webContents.fromId(wcId);
    if (!wc) {
      throw new Error(`WebContents ${wcId} not found`);
    }

    if (!wc.debugger.isAttached()) {
      wc.debugger.attach("1.3");
    }

    const keyCode = {
      "Enter": 13,
      "Tab": 9,
      "Escape": 27,
      "Backspace": 8,
      "ArrowUp": 38,
      "ArrowDown": 40,
      "ArrowLeft": 37,
      "ArrowRight": 39
    }[key] || 0;

    for (let i = 0; i < times; i++) {
      await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key,
        code: key,
        windowsVirtualKeyCode: keyCode
      });

      await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code: key,
        windowsVirtualKeyCode: keyCode
      });
    }

    console.log("✅ CDP KEY sent:", key);
    return true;
  } catch (err) {
    console.error("❌ CDP key failed:", err);
    throw err;
  }
});




ipcMain.handle("ollama:vision", async (_, { prompt, base64Image }) => {
  const res = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen3-vl:4b-instruct",
      prompt,
      images: [base64Image],
      stream: false
    })
  });
  const data = await res.json();
  return data.response || "";
});