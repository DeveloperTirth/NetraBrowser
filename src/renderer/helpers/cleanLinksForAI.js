export function cleanLinksForAI(rawLinks) {
  // STEP 1: basic hard filtering
  let links = rawLinks.filter(l => {
    if (!l || !l.href) return false;
    if (!l.text || l.text.trim().length < 8) return false;

    const t = l.text.toLowerCase();
    const h = l.href.toLowerCase();

    if (t.includes("skip to")) return false;
    if (t.includes("accessibility")) return false;
    if (t === "read more") return false;
    if (t === "sign in") return false;

    if (h.includes("/search?")) return false;
    if (h.includes("google.com/url?")) return false;
    if (h.includes("accounts.google.com")) return false;

    return true;
  });

  // STEP 2: remove navigation & pagination
  links = links.filter(l => {
    const t = l.text.toLowerCase();
    if (["all", "images", "videos", "news", "maps", "books", "shopping"].includes(t)) return false;
    if (/^\d+$/.test(t)) return false;
    if (t === "next") return false;
    return true;
  });

  // STEP 3: remove junk media (timestamps, yt noise)
  links = links.filter(l => {
    if (l.href.includes("youtube.com/watch") && l.text.includes(":")) return false;
    return true;
  });

  // STEP 4: dedupe + keep real content only
  const seen = new Set();
  links = links.filter(l => {
    if (!l.href.startsWith("http")) return false;
    if (l.href.includes("google.com/search")) return false;
    if (l.href.includes("maps.google")) return false;
    if (l.href.includes("support.google")) return false;

    if (seen.has(l.href)) return false;
    seen.add(l.href);

    return true;
  });

  // FINAL: normalize for AI
  return links.map(l => {
    const domain = new URL(l.href).hostname;
    const title = normalizeTitle(l.text);
    return {
      title,
      url: l.href,
      domain,
      type: detectType(l.href, domain,title)
    };
  });



  function normalizeTitle(title) {
    return title
      .replace(/https?:\/\/\S+/g, "")   // remove URLs
      .replace(/\s+›\s+.*/g, "")        // remove breadcrumb
      .replace(/\s+/g, " ")
      .trim();
  }

  function detectType(url, domain, title) {
    const t = title.toLowerCase();

    if (domain.includes("youtube.com")) return "video";
    if (t.includes("tutorial") || t.includes("learn")) return "tutorial";
    if (t.includes("syntax") || t.includes("reference")) return "reference";
    if (t.includes("roadmap") || t.includes("how long")) return "roadmap";

    return "article";
  }


}
