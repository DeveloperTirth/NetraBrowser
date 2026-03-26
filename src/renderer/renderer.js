console.log("electron bridge:", window.electron);

// ============================================
// Execute action via CDP (Works on YouTube!)
// ============================================
async function executeActionViaCDP(action, wcId) {
  try {
    // CLICK via CDP
    if (action.type === "click") {
      // Use the global NID lookup function from overlay
      const coordsCode = `
        (function() {
          // Method 1: Direct element lookup with caching
          let foundEl = null;
          const nid = "${action.id.toUpperCase()}";
          
          // Scan all interactive elements for the NID
          const candidates = document.querySelectorAll(
            'a, button, input, textarea, select, [role="button"]'
          );
          
          for (const el of candidates) {
            if (el.dataset.netraId === nid) {
              foundEl = el;
              break;
            }
          }
          
          if (!foundEl) {
            console.error("❌ NID not found:", nid);
            return "null";
          }
          
          const r = foundEl.getBoundingClientRect();
          if (r.width < 10 || r.height < 10) {
            console.error("❌ Element too small:", nid);
            return "null";
          }
          
          const data = {
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2),
            width: Math.round(r.width),
            height: Math.round(r.height),
            tag: foundEl.tagName,
            nid: nid
          };


          window.__NETRA_VISUAL__?.markClicked("${action.id}");
          window.__NETRA_VISUAL__?.updateHUD("CLICK ${action.id}", "PAGE: PROCESSING");

          
          return JSON.stringify(data);
        })()
      `;

      const coordResult = await window.electron.invoke("electron:eval", {
        wcId,
        code: coordsCode
      });



      console.log("📊 CDP eval result:", coordResult);

      // Extract the string value from CDP result
      let coords = null;
      if (coordResult?.result?.value) {
        try {
          coords = JSON.parse(coordResult.result.value);
        } catch (e) {
          console.error("❌ Failed to parse coordinates:", e);
          return false;
        }
      }

      if (!coords || coords === null) {
        console.error("❌ CDP returned no coordinates for NID:", action.id);
        console.warn("Full result:", coordResult);
        return false;
      }
      console.log("📍 Found element:", coords);

      await window.electron.invoke("electron:cdp-click", {
        wcId,
        x: coords.x,
        y: coords.y
      });

      return true;
    }

    // TYPE via CDP
    if (action.type === "type") {
      console.log("📝 Typing via CDP:", action.value);

      const typeResult = await window.electron.invoke("electron:eval", {
        wcId,
        code: `
          (function() {
            const nid = "${action.id.toUpperCase()}";
            const candidates = document.querySelectorAll(
              'input, textarea, [contenteditable="true"]'
            );
            
            for (const el of candidates) {
              if (el.dataset.netraId === nid) {
                el.focus();
                el.value = "${action.value.replace(/"/g, '\\"')}";
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
                return "success";
              }
            }
            
            console.error("❌ Input element not found:", nid);
            return "failed";
          })()
        `
      });

      console.log("📝 Type result:", typeResult?.result?.value);
      return true;
    }

    // KEY via CDP
    if (action.type === "key") {
      console.log("⌨️ Key via CDP:", action.key);

      await window.electron.invoke("electron:cdp-key", {
        wcId,
        key: action.key
      });

      return true;
    }

    // Other actions via normal JS
    return await window.electron.invoke("electron:eval", {
      wcId,
      code: `window.__NETRA_EXECUTE_ACTION__(${JSON.stringify(action)})`
    });

  } catch (err) {
    console.error("❌ CDP action failed:", err);
    return false;
  }
}



document.addEventListener("DOMContentLoaded", () => {
  const Input = document.getElementById("input");
  const sendBtn = document.getElementById("aiSend");
  const toggleBtn = document.getElementById("toggleAI");
  const aiPanel = document.getElementById("aiPanel");

  // Panel toggle
  if (toggleBtn && aiPanel) {
    toggleBtn.classList.add("active");
    toggleBtn.addEventListener("click", () => {
      aiPanel.classList.toggle("hidden");
      toggleBtn.classList.toggle("active");
    });
  }

  if (!Input) {
    console.warn("#input not found in DOM");
    return;
  }

  async function handleSend() {
    const goal = Input.value.trim();
    if (!goal) return;
    Input.value = "";
    userSay(goal);
    statusSay("Starting task...");
    showAgentBar();
    try {
      await runMultiSubgoalAgent(goal);
    } catch (err) {
      console.error("Agent error:", err);
      aiSay(`Error: ${err.message || "Something went wrong. Please check your API key and try again."}`);
      setAIStatus("");
    } finally {
      hideAgentBar();
    }
  }

  Input.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    handleSend();
  });

  if (sendBtn) {
    sendBtn.addEventListener("click", handleSend);
  }

  // Drag-to-resize AI panel
  const resizeHandle = document.getElementById("resizeHandle");
  if (resizeHandle && aiPanel) {
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    resizeHandle.addEventListener("mousedown", (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = aiPanel.offsetWidth;
      resizeHandle.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isResizing) return;
      const diff = startX - e.clientX;
      const newWidth = Math.min(600, Math.max(280, startWidth + diff));
      aiPanel.style.width = newWidth + "px";
    });

    document.addEventListener("mouseup", () => {
      if (!isResizing) return;
      isResizing = false;
      resizeHandle.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    });
  }
});


// extract text for store_data
async function extractVisibleText(wv) {
  return await wv.executeJavaScript(`
    (() => {
      return Array.from(document.body.querySelectorAll("*"))
        .filter(el => {
          const r = el.getBoundingClientRect();
          if (!r || r.width < 20 || r.height < 20) return false;
          const style = getComputedStyle(el);
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0"
          );
        })
        .map(el => el.innerText)
        .filter(Boolean)
        .join("\\n")
        .slice(0, 6000);
    })();
  `);
}



// const NETRA_HUD_CODE = `
// (() => {
//   if (window.__NETRA_HUD__) return;
//   window.__NETRA_HUD__ = true;

//   const hud = document.createElement("div");
//   hud.id = "__netra_hud__";
//   hud.style.position = "fixed";
//   hud.style.top = "8px";
//   hud.style.right = "8px";
//   hud.style.background = "rgba(0,0,0,0.85)";
//   hud.style.color = "#fff";
//   hud.style.fontFamily = "monospace";
//   hud.style.fontSize = "11px";
//   hud.style.padding = "6px 8px";
//   hud.style.zIndex = "2147483647";
//   hud.style.maxWidth = "40vw";

//   hud.innerHTML = \`
//     <div id="netra-step">STEP: —</div>
//     <div id="netra-last-action">LAST: —</div>
//     <div id="netra-page-state">PAGE: STABLE</div>
//   \`;

//   document.body.appendChild(hud);
// })();
// `;

// const NETRA_VISUAL_HELPERS = `
// (() => {
//   window.__NETRA_VISUAL__ = window.__NETRA_VISUAL__ || {};

//   window.__NETRA_VISUAL__.updateHUD = function(last, page) {
//     const l = document.getElementById("netra-last-action");
//     const p = document.getElementById("netra-page-state");
//     if (l) l.textContent = "LAST: " + last;
//     if (p) p.textContent = "PAGE: " + page;
//   };

//   window.__NETRA_VISUAL__.markClicked = function(nid) {
//     const el = document.querySelector('[data-netra-id="' + nid + '"]');
//     if (!el || el.dataset.netraClicked) return;

//     el.dataset.netraClicked = "true";
//     el.style.outline = "4px solid #3399ff";

//     const tag = document.createElement("div");
//     tag.textContent = "✓ CLICKED";
//     tag.style.position = "absolute";
//     tag.style.background = "#3399ff";
//     tag.style.color = "#000";
//     tag.style.fontSize = "10px";
//     tag.style.padding = "2px 4px";
//     tag.style.zIndex = "2147483647";
//     el.parentElement.appendChild(tag);
//   };

//   window.__NETRA_VISUAL__.markTyped = function(nid) {
//     const el = document.querySelector('[data-netra-id="' + nid + '"]');
//     if (!el || el.dataset.netraTyped) return;

//     el.dataset.netraTyped = "true";
//     el.style.outline = "4px solid #00ff00";

//     const tag = document.createElement("div");
//     tag.textContent = "✓ TYPED";
//     tag.style.position = "absolute";
//     tag.style.background = "#00ff00";
//     tag.style.color = "#000";
//     tag.style.fontSize = "10px";
//     tag.style.padding = "2px 4px";
//     tag.style.zIndex = "2147483647";
//     el.parentElement.appendChild(tag);
//   };

//   window.__NETRA_VISUAL__.showPageTransition = function() {
//     const banner = document.createElement("div");
//     banner.textContent = "🔄 PAGE UPDATED";
//     banner.style.position = "fixed";
//     banner.style.top = "6px";
//     banner.style.left = "50%";
//     banner.style.transform = "translateX(-50%)";
//     banner.style.background = "#ffcc00";
//     banner.style.color = "#000";
//     banner.style.padding = "4px 8px";
//     banner.style.fontWeight = "bold";
//     banner.style.zIndex = "2147483647";
//     document.body.appendChild(banner);
//     setTimeout(() => banner.remove(), 1200);
//   };
// })();
// `;


function bufferToBase64(buffer) {
  return buffer.toString("base64");
}

async function captureWebviewScreenshot() {
  const tab = tabs.get(activeTab);
  if (!tab) return null;

  const wcId = tab.webview.getWebContentsId();

  return await window.electron.invoke(
    "capture-webview",
    wcId
  );
}

function getConfig() {
  const configStr = localStorage.getItem("netra-ai-config");
  if (configStr) {
    try { return JSON.parse(configStr); } catch(e){}
  }
  return { provider: "ollama", apiKey: "", modelName: "qwen3-vl:4b-instruct" };
}

async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url, options);
    if (res.status === 429) {
      console.warn(`Rate limit hit (429). Retrying in ${Math.pow(2, i)}s...`);
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
      continue;
    }
    return res;
  }
  return await fetch(url, options);
}

async function askOllamaVision(prompt, base64Image) {
  showThinking();
  try {
    const config = getConfig();

    if (config.provider === 'ollama') {
    // const hi = await window.electron.invoke("ollama:vision", { prompt, base64Image });
    try {
      console.log("asking Ollama Vision");
      const res = await fetchWithRetry("http://127.0.0.1:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.modelName || "qwen3-vl:4b-instruct",
          prompt: prompt,
          images: [base64Image],
          stream: false
        })
      });
      if (!res.ok) throw new Error(`Ollama API error: ${res.status}`);
      const data = await res.json();
      return data.response || "";
    } catch (err) {
      console.error("❌ Ollama Vision failed:", err);
      return "";
    }
  } else if (config.provider === 'openai') {
    try {
      console.log("asking OpenAI Vision");
      const res = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.modelName || "gpt-4o",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } }
              ]
            }
          ]
        })
      });
      if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
      const data = await res.json();
      return data.choices[0].message.content || "";
    } catch (err) {
      console.error("❌ OpenAI Vision failed:", err);
      return "";
    }
  } else if (config.provider === 'anthropic') {
    try {
      console.log("asking Anthropic Vision");
      const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: config.modelName || "claude-3-5-sonnet-20241022",
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: "image/png", data: base64Image } },
                { type: "text", text: prompt }
              ]
            }
          ]
        })
      });
      if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
      const data = await res.json();
      return data.content[0].text || "";
    } catch (err) {
      console.error("❌ Anthropic Vision failed:", err);
      return "";
    }
  } else if (config.provider === 'gemini') {
    try {
      console.log("asking Gemini Vision");
      const model = config.modelName || "gemini-2.5-flash";
      const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: "image/png", data: base64Image } }
            ]
          }]
        })
      });
      if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
      const data = await res.json();
      return data.candidates[0].content.parts[0].text || "";
    } catch (err) {
      console.error("❌ Gemini Vision failed:", err);
      return "";
    }
  }
  } finally {
    removeThinking();
  }
}



// main function
async function sendNetraVisionToAI(goal, memory) {
  // 1️⃣ Screenshot
  const buffer = await captureWebviewScreenshot();

  if (!buffer) return;

  // 2️⃣ Base64
  const base64Image = bufferToBase64(buffer);

  // 3️⃣ Prompt (VERY IMPORTANT)
  const prompt = `
You are a highly capable autonomous browser AGENT that can SEE the webpage through a screenshot.

The screenshot contains rectangles drawn over interactive elements.
Each element has a unique ID (like N1, N8, etc.) called an NID, shown above the element rectangle.

# YOUR TASK

Decide the NEXT SINGLE STEP toward the user goal based purely on current visual state and memory.

User Goal:
${goal}

You work ITERATIVELY. Output ONLY ONE STEP.

You are given:
1. The user goal
2. The current website screenshot (with NIDs)
3. Memory of past actions

${memory}

# CRITICAL RULES (VERY IMPORTANT)

1. You MUST visually inspect the screenshot and identify elements by their NID.
2. Choose the NID that best matches the required action. NEVER hallucinate an NID.
3. SCROLLING & PAGINATION (CRUCIAL):
   - If the element you need is clearly BELOW THE FOLD or off-screen, you MUST output a "scroll" action.
   - Do NOT guess NIDs if they aren't visible. Scroll first!

4. CRITICAL ANTI-LOOP RULE & RECOVERY:
If your previous action was BLOCKED or you noticed the page DID NOT visibly change after your last action:
- You MUST NOT repeat the same click, type, or key event.
- You MUST force a progress shift by choosing a DIFFERENT action type.
- Try: {"type": "scroll", "amount": 800} to see new content.
- Try: {"type": "back"} to escape a modal or dead-end page.
- Do NOT hallucinate NIDs that do not exist. If you cannot see it, SCROLL.
- If you are completely stuck for more than 2 turns with no new information, output {"step": "goal_complete", "reason": "Dead end reached, concluding task based on available information for this website."}

5. MULTI-STEP REASONING:
Remember, you are an intelligent autonomous assistant. You can take as many steps as needed to find the information, comparing items, opening links, and scrolling. Never give up on the first screen if the goal requires digging.
6. DATA EXTRACTION:
When you have successfully navigated to a page that contains the information needed to fulfill the user's goal, use the "extract_data" step to extract, summarize, and store it. Do this BEFORE calling "goal_complete".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALLOWED STEP TYPES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
execute_action
extract_data
request_user_info
goal_complete

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALLOWED ACTION SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
For CLICK: { "type": "click", "id": "<nid>" }
For TYPE: { "type": "type", "id": "<nid>", "value": "<text>" }
For KEY: { "type": "key", "key": "<Enter|Escape|Tab>" }
For SCROLL: { "type": "scroll", "amount": 800 } 
For NAVIGATE: { "type": "navigate", "url": "<url>" }
For WAIT: { "type": "wait", "ms": 1000 }

VISUAL LEGEND:
🟢 GREEN  → input field
🔵 BLUE   → button
🟣 PURPLE → link
🟠 ORANGE → dropdown
🔴 RED    → other

STRICT: NEVER type into non-green elements. Use BLUE or PURPLE for clicks.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT (JSON ONLY) (MUST FOLLOW)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "step": "execute_action | extract_data | request_user_info | goal_complete", 
  "reason": "Short explanation why this is the best step",
  "action": {
    "type": "click | type | key | scroll | navigate | back | forward | wait",
    "...": "other required fields"
  }
}
`;
  // 4️⃣ Send to Ollama
  const response = await askOllamaVision(prompt, base64Image);
  return response;
}

// const NETRA_VISION_CODE = `
// (() => {
//   if (window.__NETRA_INSTALLED__) {
//     if (!window.__NETRA_EXECUTE_ACTION__) {
//       console.warn("♻️ Re-attaching NETRA executor");
//     } else {
//       return;
//     }
//   }
//   window.__NETRA_INSTALLED__ = true;

//   function getType(el) {
//     if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return "input";
//     if (el.tagName === "SELECT") return "dropdown";
//     if (el.tagName === "BUTTON") return "button";
//     if (el.tagName === "A") return "link";
//     if (el.getAttribute("role") === "button") return "button";
//     return "element";
//   }

//   function getColorByType(type) {
//     switch (type) {
//       case "input": return "#00ff00";
//       case "button": return "#3399ff";
//       case "link": return "#aa66ff";
//       case "dropdown": return "#ff9900";
//       default: return "#ff4444";
//     }
//   }

//   const overlay = document.createElement("div");
//   overlay.id = "__netra_overlay__";
//   overlay.style.position = "fixed";
//   overlay.style.top = "0";
//   overlay.style.left = "0";
//   overlay.style.width = "100vw";
//   overlay.style.height = "100vh";
//   overlay.style.pointerEvents = "none";
//   overlay.style.zIndex = "2147483647";
//   document.documentElement.appendChild(overlay);

//   let counter = 1;

//   function clear() {
//     overlay.innerHTML = "";
//   }

//   function drawBox(rect, id, el) {
//     const box = document.createElement("div");
//     const type = getType(el);
//     const color = getColorByType(type);

//     box.style.position = "absolute";
//     box.style.left = rect.left + "px";
//     box.style.top = rect.top + "px";
//     box.style.width = rect.width + "px";
//     box.style.height = rect.height + "px";
//     box.style.border = "3px solid " + color;
//     box.style.background = color + "22";
//     box.style.pointerEvents = "none";

//     const label = document.createElement("div");
//     label.textContent = id;
//     label.style.position = "absolute";
//     label.style.top = "-16px";
//     label.style.left = "0";
//     label.style.background = color;
//     label.style.fontSize = "11px";
//     label.style.fontFamily = "monospace";
//     label.style.fontWeight = "bold";

//     box.appendChild(label);
//     overlay.appendChild(box);
//   }

//   window.__NETRA_SCAN__ = function () {
//     clear();
//     counter = 1;
//     const map = [];

//     document.querySelectorAll(
//       "a, button, input, textarea, select, [role='button']"
//     ).forEach(el => {
//       const rect = el.getBoundingClientRect();
//       if (rect.width < 10 || rect.height < 10) return;

//       if (!el.dataset.netraId) {
//         el.dataset.netraId = "N" + counter++;
//       }

//       const id = el.dataset.netraId;
//       map.push({ id });

//       drawBox(rect, id, el);
//     });

//     window.__NETRA_ELEMENT_MAP__ = map;
//   };
// })();




// function humanKey(el, key) {
//   const opts = {
//     key,
//     code: key === "Enter" ? "Enter" : key,
//     which: key === "Enter" ? 13 : undefined,
//     keyCode: key === "Enter" ? 13 : undefined,
//     bubbles: true,
//     cancelable: true
//   };

//   el.dispatchEvent(new KeyboardEvent("keydown", opts));
//   el.dispatchEvent(new KeyboardEvent("keypress", opts));
//   el.dispatchEvent(new KeyboardEvent("keyup", opts));
// }


// window.__NETRA_EXECUTE_ACTION__ = function (action) {
//   try {
//     const nid = action?.id ? action.id.toUpperCase() : null;
//     const el = nid
//       ? document.querySelector('[data-netra-id="' + nid + '"]')
//       : null;

//     switch (action.type) {
//       case "type":
//         if (!el) return;
//         el.focus();
//         el.value = action.value || "";
//         el.dispatchEvent(new InputEvent("input", { bubbles: true }));
//         break;

//       case "click":
//         if (!el) return;
//         el.scrollIntoView({ block: "center" });
//         el.click();
//         break;

//       case "key": {
//   const el = document.activeElement;

//   if (!el) {
//     console.warn("❌ No active element for key");
//     return;
//   }

//   humanKey(el, action.key);

//   if (window.__NETRA_VISUAL__) {
//     window.__NETRA_VISUAL__.markKey(action.key);
//     window.__NETRA_VISUAL__.updateHUD("KEY " + action.key, "PAGE: PROCESSING");
//   }

//   break;
// }


//       case "scroll":
//         window.scrollBy({ top: action.amount || 600 });
//         break;

//       case "navigate":
//         if (action.url) location.href = action.url;
//         break;
//     }
//   } catch (e) {
//     console.error("NETRA EXEC ERROR", e);
//   }
// };
// `;

function showThinking() {
  const aiMessages = document.getElementById("aiMessages");
  if (!aiMessages) return;
  const msg = document.createElement("div");
  msg.className = "ai-msg ai";
  msg.id = "thinking-indicator";
  msg.innerHTML = `<div class="thinking-bubble"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;
  aiMessages.appendChild(msg);
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

function removeThinking() {
  const el = document.getElementById("thinking-indicator");
  if (el) el.remove();
}

let _agentStopped = false;

function showAgentBar(text) {
  _agentStopped = false;
  const bar = document.getElementById("agentBar");
  if (bar) bar.style.display = "flex";
  updateAgentBar(text || "Netra is browsing...");
}

function hideAgentBar() {
  const bar = document.getElementById("agentBar");
  if (bar) bar.style.display = "none";
}

function updateAgentBar(text) {
  const el = document.getElementById("agentBarText");
  if (el) el.textContent = text;
}

// Wire stop button
document.addEventListener("DOMContentLoaded", () => {
  const stopBtn = document.getElementById("agentStop");
  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      _agentStopped = true;
      hideAgentBar();
      statusSay("Agent stopped by user.");
      setAIStatus("");
    });
  }
});

function extractJSON(raw) {
  if (typeof raw !== "string") return null;

  // remove markdown fences
  raw = raw.replace(/```json/gi, "").replace(/```/g, "");

  // find FIRST valid JSON object boundaries
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return raw.slice(start, end + 1);
}

async function askTextAPI(prompt) {
  showThinking();
  try {
    const config = getConfig();

    if (config.provider === 'ollama') {
      try {
        const res = await fetchWithRetry("http://127.0.0.1:11434/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: config.modelName || "qwen3-vl:4b-instruct",
            prompt: prompt,
            stream: false
          })
        });
        if (!res.ok) throw new Error(`Ollama API error: ${res.status}`);
        const data = await res.json();
        return data.response || "";
      } catch (err) {
        console.error("Ollama text failed:", err);
        const msg = err.message.includes("Failed to fetch")
          ? "Ollama is not running. Start it and try again."
          : `Ollama error: ${err.message}`;
        statusSay(msg);
        return "";
      }
    } else if (config.provider === 'openai') {
      try {
        const res = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.apiKey}`
          },
          body: JSON.stringify({
            model: config.modelName || "gpt-4o",
            messages: [ { role: "user", content: prompt } ]
          })
        });
        if (!res.ok) {
          const errText = res.status === 429 ? "Rate limited. Wait a moment and try again." : `OpenAI error (${res.status})`;
          throw new Error(errText);
        }
        const data = await res.json();
        return data.choices[0].message.content || "";
      } catch (err) {
        console.error("OpenAI text failed:", err);
        statusSay(err.message);
        return "";
      }
    } else if (config.provider === 'anthropic') {
      try {
        const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "x-api-key": config.apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify({
            model: config.modelName || "claude-3-5-sonnet-20241022",
            max_tokens: 1024,
            messages: [ { role: "user", content: prompt } ]
          })
        });
        if (!res.ok) {
          const errText = res.status === 429 ? "Rate limited. Wait a moment and try again." : `Anthropic error (${res.status})`;
          throw new Error(errText);
        }
        const data = await res.json();
        return data.content[0].text || "";
      } catch (err) {
        console.error("Anthropic text failed:", err);
        statusSay(err.message);
        return "";
      }
    } else if (config.provider === 'gemini') {
      try {
        const model = config.modelName || "gemini-2.5-flash";
        const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [ { text: prompt } ] }]
          })
        });
        if (!res.ok) {
          const errText = res.status === 429 ? "Rate limited by Gemini. Wait a moment and try again."
            : res.status === 400 ? "Invalid request to Gemini. Check your API key."
            : `Gemini error (${res.status})`;
          throw new Error(errText);
        }
        const data = await res.json();
        return data.candidates[0].content.parts[0].text || "";
      } catch (err) {
        console.error("Gemini text failed:", err);
        statusSay(err.message);
        return "";
      }
    }
  } finally {
    removeThinking();
  }
}

async function generateSubgoals(userGoal) {
  const prompt = `
You are an expert task planner for a browser automation agent.

Your job is to convert a user goal into the MINIMUM number of clear, ordered subgoals
that an autonomous agent can execute reliably.

━━━━━━━━━━━━━━━━━━━━━━
IMPORTANT PRINCIPLES
━━━━━━━━━━━━━━━━━━━━━━

1. Each subgoal must represent ONE concrete objective.
2. Each subgoal must be achievable WITHOUT human clarification.
3. Each subgoal must be executable on ONE website or web app.
4. Do NOT include explanations, reasoning, or descriptions.
5. Do NOT include UI-level steps like "click", "type", "scroll".
6. Subgoals describe WHAT to achieve, not HOW.

━━━━━━━━━━━━━━━━━━━━━━
TASK-AWARE RULES
━━━━━━━━━━━━━━━━━━━━━━

• If the goal is SIMPLE (single site, single outcome):
  - Example "go to amazon and search for iphone" -> "Search for 'iphone' on Amazon"
  - Do NOT chop the goal in half. Preserve the actual end objective (the search or the action).
  - Create ONLY ONE subgoal.

• If the goal is RESEARCH / COMPARISON:
  - Create ONE subgoal per website explicitly mentioned.
  - E.g. "compare iphone 15 on amazon and apple" -> Subgoal 1: "Search iPhone 15 on Amazon and note price", Subgoal 2: "Search iPhone 15 on Apple and note price"

• If the goal mentions multiple platforms:
  - Create ONE subgoal per platform.

━━━━━━━━━━━━━━━━━━━━━━
STOP CONDITIONS (CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━

Each subgoal MUST naturally end when:
- Required information is visible and extractable
- Required data entry is complete
- Required action is successfully performed

━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT (JSON ONLY)
━━━━━━━━━━━━━━━━━━━━━━

{
  "subgoals": [
    {
      "id": 1,
      "goal": "<clear, concise objective>"
    }
  ]
}

━━━━━━━━━━━━━━━━━━━━━━
USER GOAL
━━━━━━━━━━━━━━━━━━━━━━

"${userGoal}"


`;

  const responseText = await askTextAPI(prompt);
  console.log("data", responseText);

  if (!responseText) {
    return { subgoals: [] };
  }

  const cleanJsonStr = extractJSON(responseText);
  if (!cleanJsonStr) {
    try {
      return JSON.parse(responseText);
    } catch (e) {
      console.error("❌ Failed to parse subgoals JSON:", e);
      return { subgoals: [] };
    }
  }

  try {
    return JSON.parse(cleanJsonStr);
  } catch (e) {
    console.error("❌ Failed to parse extracted JSON:", e);
    return { subgoals: [] };
  }
}




async function runMultiSubgoalAgent(userGoal) {
  console.log("Generating subgoals...");
  statusSay("Planning task...");
  setAIStatus("Planning");
  const plan = await generateSubgoals(userGoal);

  const finalResults = [];

  for (const sub of plan.subgoals) {
    console.log(`Running subgoal ${sub.id}:`, sub.goal);
    setAIStatus(`Step ${sub.id}`);
    statusSay(`Running step ${sub.id}: ${sub.goal}`);
    const result = await runAgent(sub.goal);

    finalResults.push({
      site: sub.site,
      data: result
    });
  }

  console.log("All subgoals completed");
  statusSay("Gathering findings...");

  const synthesisPrompt = `
You are the Netra AI Assistant. You have just completed a browsing task.
User's original goal: "${userGoal}"

Raw data collected:
${JSON.stringify(finalResults, null, 2)}

Your task: Provide a clean, direct, and professional answer based ONLY on the data collected.
RULES:
1. Do NOT use emojis (no checkboxes, no thinking faces, no pins).
2. Do NOT write verbose headers like "Netra AI Assistant Report". Just give the answer.
3. If no data was found, just say "I couldn't find any data for [task]." and briefly explain why based on the raw data (e.g., website blocked, search failed).
4. Use standard markdown (bolding, lists) for readability.
Output ONLY the final markdown text.
`;
  
  setAIStatus("Synthesizing");
  statusSay("Synthesizing final response...");
  const finalAnswer = await askTextAPI(synthesisPrompt);
  aiSay(finalAnswer);
  setAIStatus("");

  console.log("Raw Final Results:", finalResults);

  return finalResults;
}



async function runAgent(goal) {
  const STORE_DATA_PROMPT = `Summarize the following webpage content into
5–8 factual bullet points relevant to the user goal.

Rules:
- ONLY include information explicitly present in the text
- NO assumptions
- NO extra information
- NO opinions
- NO reasoning
- Short factual bullets
- If nothing relevant is found, output: NONE
- deep detail. full information.

User goal:
<USER_GOAL>

Webpage content:
<TEXT>
`
  const tab = tabs.get(activeTab);
  if (!tab || !tab.webview) {
    console.warn("❌ No active tab/webview");
    return;
  }

  const wv = tab.webview;


  console.log("Netra Agent started on tab:", activeTab);

  /* =========================
     AGENT STATE
  ========================= */

  const STATES = {
    INIT: "state_0",
    ACT: "state_act",
    STORE: "state_store",
    END: "state_end"
  };

  function enterEndState(agent) {
    console.log("ENTERING STATE_END");

    if (agent.storedData && agent.storedData.length > 0) {
      console.log("Final extracted data:");
      agent.storedData.forEach((d, i) => {
        console.log(`Source ${i + 1}:`, d);
      });
    } else {
      console.log("No data collected.");
      console.log("Actions performed:");
      agent.memory.forEach((m, i) => {
        console.log(`Step ${i + 1}:`, m.action);
      });
    }

    agent.running = false;
  }



  const agent = {
    goal,
    memory: [],
    storedData: [],
    currentPlan: null,
    clickedNids: new Set(),
    typedNids: new Set(),
    lastAction: null,
    lastUrl: null,
    step: 0,
    running: true,
    blockedActions: [],
    lastFeedback: null,
    lastExtraction: null,
    maxSteps: 10
  };

  function parsePlan(raw) {
    if (typeof raw !== "string") {
      console.warn("⚠️ Plan already parsed:", raw);
      return raw;
    }

    const cleaned = raw
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("❌ No JSON found in model output:\n" + raw);
    }

    return JSON.parse(match[0]);
  }
  function normalizePlan(plan) {
    if (!plan) return plan;

    // normalize step FIRST so all checks below work reliably
    if (plan.step) plan.step = String(plan.step).toLowerCase();

    // Auto-fix if LLM hallucinates extract_data, goal_complete, etc as an action type
    if (plan.action && ["extract_data", "goal_complete", "request_user_info"].includes(plan.action.type)) {
       plan.step = plan.action.type;
       delete plan.action;
    }

    // Auto-fix missing action wrapper (flattened output)
    if (!plan.action && (plan.type === "click" || plan.type === "type" || plan.type === "scroll" || plan.type === "key" || plan.type === "navigate" || plan.type === "wait")) {
       plan.action = {
          type: plan.type,
          id: plan.id,
          value: plan.value,
          key: plan.key,
          amount: plan.amount,
          url: plan.url
       };
    }

    // Auto-fix missing step if action is present
    if (plan.action && !["goal_complete", "request_user_info", "extract_data"].includes(plan.step)) {
       plan.step = "execute_action";
    }

    // normalize action id
    if (plan.action && plan.action.id) {
      plan.action.id = String(plan.action.id).replace(/[^a-z0-9]/gi, "").toUpperCase();
    }

    return plan;
  }


  async function generateInitialAction(goal) {
    const prompt = `
You are an intelligent navigation router. 
Analyze the user goal: "${goal}"

If the goal explicitly mentions a website (e.g., "go to hackernews", "open youtube.com", "login to github"), 
output ONLY a valid URL starting with https://. Keep it simple (e.g., https://news.ycombinator.com, https://youtube.com)

If the goal is a generic topic requiring a search (e.g., "what's the weather in london", "best laptops 2024"), 
output ONLY the Google search query string that a user would type.

Output NOTHING ELSE. No explanations.
`;

    const responseText = await askTextAPI(prompt);
    return responseText.trim();
  }


  async function extractAndStoreData(goal, wv) {


    const pageText = await extractVisibleText(wv);

    if (!pageText || pageText.length < 200) return false;

    const prompt = STORE_DATA_PROMPT
      .replace("<USER_GOAL>", goal)
      .replace("<TEXT>", pageText);



    const responseText = await askTextAPI(prompt);
    const summary = responseText.trim() || "NONE";



    agent.storedData.push({
      url: wv.getURL?.() || "unknown",
      summary
    });

    return true;
  }
  function isActionInvalid(action, agent) {
    const id = action.id?.toUpperCase();

    if (action.type === "click" && agent.clickedNids.has(id)) {
      console.warn("BLOCKED repeat click:", id);
      return true;
    }

    if (action.type === "type" && agent.typedNids.has(id)) {
      console.warn("BLOCKED repeat type:", id);
      return true;
    }

    return false;
  }
  function buildMemoryText(agent) {
    const recentMemory = agent.memory.slice(-5);
    return `
CLICKED_NIDS:
${[...agent.clickedNids].join(", ") || "NONE"}

TYPED_NIDS:
${[...agent.typedNids].join(", ") || "NONE"}

LAST_ACTION:
${agent.lastAction ? JSON.stringify(agent.lastAction) : "NONE"}

LAST_EXTRACTION:
${agent.lastExtraction ? JSON.stringify(agent.lastExtraction) : "NONE"}

RECENT_ACTIONS_HISTORY (Last 5 steps):
${recentMemory.map(m => `Step ${m.step}: ${JSON.stringify(m.action)}`).join("\n") || "NONE"}

BLOCKED_ACTIONS (DO NOT REPEAT):
${agent.blockedActions.map(a => JSON.stringify(a)).join("\n") || "NONE"}

${agent.lastFeedback ? "USER FEEDBACK / SYSTEM ERROR FROM LAST STEP:\n" + JSON.stringify(agent.lastFeedback) : ""}

IMPORTANT:
If an action is blocked, you MUST choose a DIFFERENT action type
(e.g., scroll, wait, navigate, different NID).
`;
  }




  /* =========================
     AGENT LOOP
  ========================= */
  let state = STATES.INIT;

  while (agent.running && agent.step < agent.maxSteps) {
    agent.step++;

    console.log(`Agent step ${agent.step} | STATE: ${state}`);
    updateAgentBar(`Step ${agent.step}`);

    // Check if user pressed stop
    if (_agentStopped) {
      agent.running = false;
      break;
    }

    agent.lastUrl = wv.getURL();

    await new Promise(r => setTimeout(r, 120));

    /* =========================
       STATE 0 — INIT
    ========================= */
    if (state === STATES.INIT) {
      console.log("STATE_0: Initializing Navigation...");
      
      const initialSt = await generateInitialAction(agent.goal);
      if (!initialSt) {
        state = STATES.END;
        continue;
      }

      // Extract only the first valid URL from the response
      let targetUrl = "";
      const urlMatch = initialSt.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        targetUrl = urlMatch[0].replace(/["'`,;]+$/, '');
        console.log("Direct navigation:", targetUrl);
      } else {
        targetUrl = "https://www.google.com/search?q=" + encodeURIComponent(initialSt.trim());
        console.log("Search query:", initialSt);
      }

      wv.loadURL(targetUrl);

      // ⏳ IMPORTANT: wait for navigation
      await new Promise(r => setTimeout(r, 4000));

      // Reset memory
      agent.memory = [];
      agent.currentPlan = null;

      // Start vision loop
      state = STATES.ACT;
      continue;
    }


    /* =========================
      STATE ACT — PLAN + EXECUTE
   ========================= */
    if (state === STATES.ACT) {
      console.log("STATE_ACT: planning");

      // 1️⃣ Build memory
      const memoryText = buildMemoryText(agent);

      // 2️⃣ Ask vision model for NEXT plan
      const rawResponse = await sendNetraVisionToAI(
        agent.goal,
        memoryText
      );

      const json = extractJSON(rawResponse);
      if (!json) {
        console.error("Planner returned no JSON, retrying...");
        agent.lastFeedback = { type: "format_error", error: "You must output a valid JSON object." };
        agent.memory.push({ step: agent.step, action: { status: "FAILED", type: "system_error", reason: "No JSON in output" } });
        continue;
      }

      const plan = normalizePlan(parsePlan(json));
      console.log("Planner decided:", plan);



      if (plan.step === "goal_complete") {
        console.log("Goal complete");
        if (plan.reason) {
          agent.storedData.push({ url: wv.getURL(), summary: "Final conclusion reason: " + plan.reason });
        }
        state = STATES.END;
        continue;
      }

      if (plan.step === "request_user_info") {
        console.log("User info required");
        state = STATES.END;
        continue;
      }

      if (plan.step === "extract_data") {
        console.log("🧠 AI explicitly decided to extract data");
        state = STATES.STORE;
        continue;
      }

      if (plan.step !== "execute_action" || !plan.action) {
        console.warn("Invalid planner step or missing action, retrying...");
        agent.lastFeedback = { type: "format_error", error: "Your step was invalid or you forgot the 'action' object. Use 'execute_action' and provide a valid 'action' object." };
        agent.memory.push({ step: agent.step, action: { status: "FAILED", type: "system_error", reason: "Missing action object" } });
        continue;
      }

      const action = plan.action;
      const wcId = wv.getWebContentsId();

      if (isActionInvalid(action, agent)) {
        agent.blockedActions.push(action);
        agent.lastFeedback = {
          type: "blocked_action",
          action,
          reason: "This action was already performed. Choose a DIFFERENT action type or DIFFERENT element."
        };
        continue;
      }


      console.log("Executing:", action);

      // 4️⃣ Execute action
      let ok = true;
      if (["click", "type", "key"].includes(action.type)) {
        ok = await executeActionViaCDP(action, wcId);
      } else {
        await window.electron.invoke("electron:eval", {
          wcId,
          code: `window.__NETRA_EXECUTE_ACTION__(${JSON.stringify(action)})`
        });
      }

      if (!ok) {
        console.error("Action execution failed");
        
        agent.blockedActions.push(action);
        agent.lastFeedback = {
          type: "blocked_action",
          action,
          reason: "Action execution failed in the DOM (element not found or intractable). Please try a different approach or scroll to find it."
        };
        agent.memory.push({ step: agent.step, action: { ...action, status: "FAILED" } });
        
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      // 5️⃣ Save memory
      agent.memory.push({
        step: agent.step,
        action
      });

      if (action.type === "click" && action.id) {
        agent.clickedNids.add(action.id.toUpperCase());
      }

      if (action.type === "type" && action.id) {
        agent.typedNids.add(action.id.toUpperCase());
      }

      agent.lastAction = action;

      // 6️⃣ Let page settle
      await new Promise(r => setTimeout(r, 1800));

      const currentUrl = wv.getURL();

      // Update last url
      if (currentUrl && agent.lastUrl && new URL(currentUrl).hostname !== new URL(agent.lastUrl).hostname) {
        console.log("🌍 Major navigation detected:", currentUrl);
      }
      agent.lastUrl = currentUrl;

      // 7️⃣ Loop STATE_ACT again
      continue;
    }


    /* =========================
       STATE STORE — STORE DATA IN BULLET POINTS
    ========================= */

    if (state === STATES.STORE) {
      console.log("STATE_STORE: extracting data");
      statusSay("Extracting page data...");

      const extracted = await extractAndStoreData(agent.goal, wv, agent);
      const lastItem = agent.storedData[agent.storedData.length - 1];

      // 🔥 ADD THIS
      agent.lastExtraction = {
        url: wv.getURL(),
        success: extracted === true,
        description: `Relevant information has been extracted from this page. Content summary: ${lastItem ? lastItem.summary : "No summary"}`
      };

      state = STATES.ACT;
      continue;
    }


    /* =========================
       STATE END — FINISH
    ========================= */
    if (state === STATES.END) {
      enterEndState(agent);
      break;
    }
  }

  return agent.storedData;

}



// -------------------------------------------------

const tabBar = document.getElementById("tabBar");
const webviews = document.getElementById("webviews");
const address = document.getElementById("address");

let tabs = new Map();
let activeTab = null;
let tabId = 0;

async function createTab(url = "https://google.com") {
  const id = `tab-${++tabId}`;

  const tabEl = document.createElement("div");
  tabEl.className = "tab";
  tabEl.innerHTML = `<span>New Tab</span><span class="tab-close">✕</span>`;
  tabBar.appendChild(tabEl);

  const webview = document.createElement("webview");
  webview.src = url;
  webview.setAttribute("preload", "../webview/preload-webview.js");
  webview.setAttribute("nodeintegration", "true");
  webview.setAttribute("webviewTag", "true");
  webview.setAttribute("contextIsolation", "true");
  webview.addEventListener("ipc-message", (event) => {
    if (event.channel === "dom-data") {
      const data = event.args[0];
      console.log("Extracted Data:", JSON.stringify(data, null, 2));
    }
    if (event.channel === "dropdown-options") {
      console.log("🧾 Dropdown options:", event.args[0]);
    }
  });

  webviews.appendChild(webview);
  webview.addEventListener("dom-ready", async () => {
    const wcId = webview.getWebContentsId();

    // Wait for CDP to attach
    await window.electron.invoke("electron:attach-cdp", wcId);

    // CRITICAL: Wait before injecting
    await new Promise(r => setTimeout(r, 500));

    await window.electron.invoke("electron:inject-overlay", wcId);
    await window.electron.invoke("electron:inject-netra-runtime", wcId);
    await window.electron.invoke("electron:inject-netra-hud", wcId);
  });


  tabs.set(id, { tabEl, webview });

  tabEl.onclick = () => switchTab(id);
  tabEl.querySelector(".tab-close").onclick = (e) => {
    e.stopPropagation();
    closeTab(id);
  };

  webview.addEventListener("page-title-updated", e => {
    const titleSpan = tabEl.querySelector("span:first-child");
    if (titleSpan) titleSpan.textContent = e.title;
  });

  webview.addEventListener("did-navigate", e => {
    if (id === activeTab) address.value = e.url;
  });

  switchTab(id);
}

function switchTab(id) {
  tabs.forEach(t => {
    t.tabEl.classList.remove("active");
    t.webview.classList.remove("active");
  });

  tabs.get(id).tabEl.classList.add("active");
  tabs.get(id).webview.classList.add("active");
  activeTab = id;
}

function closeTab(id) {
  if (tabs.size === 1) return;
  const t = tabs.get(id);
  t.tabEl.remove();
  t.webview.remove();
  tabs.delete(id);
  switchTab([...tabs.keys()][0]);
}

address.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  let url = address.value;
  if (!url.startsWith("http")) url = "https://" + url;
  tabs.get(activeTab).webview.loadURL(url);
});

document.getElementById("newTab").onclick = () => createTab();
document.getElementById("reload").onclick = async () => {
  await wv.executeJavaScript(`
  (function() {
    if (window.__NETRA_BOOTED__) return;
    window.__NETRA_BOOTED__ = true;
    ${NETRA_VISION_CODE}
  })();
`);

  tabs.get(activeTab).webview.reload();
}
document.getElementById("back").onclick = () => {
  const tab = tabs.get(activeTab);
  if (!tab) return;

  const wv = tab.webview;

  // 1️⃣ Browser-level back
  if (wv.canGoBack()) {
    wv.goBack();
    return;
  }

  // 2️⃣ SPA-level back (🔥 THIS IS THE FIX)
  wv.executeJavaScript(`
    if (window.history.length > 1) {
      history.back();
    } else {
      console.log("No SPA history to go back");
    }
  `);
};

document.getElementById("forward").onclick = () => {
  const w = tabs.get(activeTab).webview;
  if (w.canGoForward()) w.goForward();
};

createTab();




const aiMessages = document.getElementById("aiMessages");
const aiInput = document.getElementById("input");
const aiSend = document.getElementById("aiSend");

/* =========================
   UI HELPERS
========================= */

function addMessage(role, text, isStatus = false) {
  const msg = document.createElement("div");
  msg.className = `ai-msg ${role}${isStatus ? ' status-msg' : ''}`;
  
  if (role === "ai" && !isStatus) {
    const div = document.createElement('div');
    div.innerText = text;
    let html = div.innerHTML;
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/\n/g, '<br/>');
    msg.innerHTML = html;
  } else {
    msg.innerText = text;
  }
  
  aiMessages.appendChild(msg);
  aiMessages.scrollTop = aiMessages.scrollHeight;
}


function aiSay(text) {
  addMessage("ai", text);
}

function userSay(text) {
  addMessage("user", text);
}

function statusSay(text) {
  addMessage("ai", text, true);
}

function setAIStatus(text) {
  const el = document.getElementById("aiStatus");
  if (el) el.textContent = text;
}

/* =========================
   BYOK / SETTINGS MODAL
========================= */
const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const aiProviderSelect = document.getElementById("aiProvider");
const apiKeyGroup = document.getElementById("apiKeyGroup");
const apiKeyInput = document.getElementById("apiKey");
const aiModelName = document.getElementById("aiModelName");
const ollamaGuide = document.getElementById("ollamaGuide");

async function checkOllama() {
  const isInstalled = await window.electron.invoke("check-ollama");
  return isInstalled;
}

function loadSettings() {
  const config = getConfig();
  if (config.provider) aiProviderSelect.value = config.provider;
  if (config.apiKey) apiKeyInput.value = config.apiKey;
  if (config.modelName) aiModelName.value = config.modelName;
}

function saveSettings() {
  const config = {
    provider: aiProviderSelect.value,
    apiKey: apiKeyInput.value,
    modelName: aiModelName.value || (aiProviderSelect.value === 'ollama' ? 'qwen3-vl:4b-instruct' : '')
  };
  localStorage.setItem("netra-ai-config", JSON.stringify(config));
}

async function updateModalView() {
  const provider = aiProviderSelect.value;
  if (provider === 'ollama') {
    apiKeyGroup.style.display = 'none';
    const installed = await checkOllama();
    if (!installed) {
      ollamaGuide.style.display = 'block';
    } else {
      ollamaGuide.style.display = 'none';
    }
  } else {
    apiKeyGroup.style.display = 'block';
    ollamaGuide.style.display = 'none';
  }
}

aiProviderSelect.addEventListener("change", () => {
  // auto-set common model names if empty or switching provider
  const p = aiProviderSelect.value;
  if (p === 'ollama') aiModelName.value = 'qwen3-vl:4b-instruct';
  else if (p === 'openai') aiModelName.value = 'gpt-4o';
  else if (p === 'anthropic') aiModelName.value = 'claude-3-5-sonnet-20241022';
  else if (p === 'gemini') aiModelName.value = 'gemini-2.5-flash';
  
  updateModalView();
});

settingsBtn.addEventListener("click", async () => {
  loadSettings();
  await updateModalView();
  settingsModal.style.display = "flex";
});

closeSettingsBtn.addEventListener("click", () => {
  settingsModal.style.display = "none";
});

saveSettingsBtn.addEventListener("click", () => {
  saveSettings();
  settingsModal.style.display = "none";
  aiSay("Settings saved.");
});
