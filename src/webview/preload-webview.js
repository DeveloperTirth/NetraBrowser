const { ipcRenderer } = require("electron");

ipcRenderer.on("extract-dom", () => {
  const q = s => [...document.querySelectorAll(s)];
  function extractMainContent() {
    // Remove obviously useless elements
    const CLONE = document.body.cloneNode(true);

    CLONE.querySelectorAll(
      "nav, footer, header, aside, script, style, noscript, svg, img, iframe, button, input"
    ).forEach(el => el.remove());

    // Get visible text only
    const text = CLONE.innerText
      .replace(/\s+/g, " ")
      .replace(/(\n\s*){2,}/g, "\n")
      .trim();

    return text;
  }

  const data = {
    url: location.href,
    title: document.title,

    buttons: q("button").map(b => ({
      text: b.innerText.trim()
    })),

    inputs: q("input").map(i => ({
      type: i.type,
      placeholder: i.placeholder,
      value: i.value
    })),

    links: q("a").map(a => ({
      text: a.innerText.trim(),
      href: a.href
    })),

    content: extractMainContent()

  };

  ipcRenderer.sendToHost("dom-data", data);
});
