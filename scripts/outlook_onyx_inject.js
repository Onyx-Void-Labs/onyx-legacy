// ─── Onyx Outlook WebView Injection Script ───────────────────────────────────
// LEGAL: Keeps Outlook branding (URL bar, logo) visible at all times.
// NO SCRAPING: Only reads DOM when user explicitly clicks "Import to Note".
// This script injects an Onyx-branded overlay toolbar on top of Outlook Web.
// ──────────────────────────────────────────────────────────────────────────────

(function () {
  "use strict";

  // Retry until Outlook SPA has finished its initial render
  var attempts = 0;
  var maxAttempts = 40; // 40 × 500 ms = 20 s maximum wait
  var readyTimer = setInterval(function () {
    attempts++;
    if (document.body && document.querySelector("#app, #MainModule, [role='main'], .ms-Layer")) {
      clearInterval(readyTimer);
      bootstrap();
    } else if (attempts >= maxAttempts) {
      clearInterval(readyTimer);
      // Even if selectors didn't match, inject the toolbar anyway
      bootstrap();
    }
  }, 500);

  function bootstrap() {
    // ────────────────────────────────────────────────────────────────────────
    // 1. CUSTOM STYLES — Onyx purple theme overlay + hide non-essential UI
    //    Outlook branding (logo, URL bar in the title-bar) stays visible.
    // ────────────────────────────────────────────────────────────────────────
    var style = document.createElement("style");
    style.id = "onyx-outlook-style";
    style.textContent = [
      // Onyx purple background on the root
      "html, body { background: linear-gradient(135deg, #1e1b4b 0%, #0f0f23 100%) !important; }",

      // Hide the O365 top chrome (waffle button, app switcher, etc.)
      // but keep the Outlook logo visible via the page <title>
      '#O365_NavHeader, #O365_MainLink_NavMenu, [data-app-section="AppModuleHeader"] { display: none !important; }',

      // Hide left app-bar icons (Calendar, People, To Do, etc.)
      '#LeftRail, [data-app-section="LeftPane"] > div:first-child, .ms-FocusZone[role="toolbar"] { display: none !important; }',

      // Hide account / profile button and notifications
      '#O365_HeaderRightRegion, #meControlContainer, #O365_MainLink_MeFlexPane { display: none !important; }',

      // Hide the search bar
      '#topSearchInput, [aria-label="Search"], #SearchBoxContainer { display: none !important; }',

      // Subtle purple tint on the folder / nav pane
      '[role="navigation"], [data-app-section="LeftPane"] {',
      "  background: rgba(30, 27, 75, 0.35) !important;",
      "  border-right: 1px solid rgba(139, 92, 246, 0.15) !important;",
      "}",

      // Purple tint on the message list & reading pane
      '[role="main"], [data-app-section="MainModule"] {',
      "  background: rgba(15, 15, 35, 0.6) !important;",
      "}",

      // Onyx purple scrollbars
      "::-webkit-scrollbar { width: 6px; }",
      "::-webkit-scrollbar-track { background: transparent; }",
      "::-webkit-scrollbar-thumb { background: rgba(139, 92, 246, 0.3); border-radius: 3px; }",
      "::-webkit-scrollbar-thumb:hover { background: rgba(139, 92, 246, 0.5); }",
    ].join("\n");
    document.head.appendChild(style);

    // ────────────────────────────────────────────────────────────────────────
    // 2. ONYX FLOATING TOOLBAR
    //    Purple gradient bar in top-right with:
    //      ✨ Onyx Email  |  Import to Note  |  ← Back to Onyx
    // ────────────────────────────────────────────────────────────────────────
    var toolbar = document.createElement("div");
    toolbar.id = "onyx-outlook-toolbar";
    toolbar.style.cssText = [
      "position: fixed",
      "top: 12px",
      "right: 12px",
      "z-index: 999999",
      "display: flex",
      "align-items: center",
      "gap: 8px",
      "background: linear-gradient(135deg, #8b5cf6, #6d28d9)",
      "padding: 8px 16px",
      "border-radius: 14px",
      "box-shadow: 0 8px 32px rgba(139, 92, 246, 0.45)",
      "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      "color: white",
      "user-select: none",
    ].join(";");

    // Logo / title
    var title = document.createElement("span");
    title.style.cssText = "font-weight: 700; font-size: 14px; letter-spacing: 0.02em;";
    title.textContent = "\u2728 Onyx Email";

    // Divider
    function makeDivider() {
      var d = document.createElement("div");
      d.style.cssText = "width: 1px; height: 18px; background: rgba(255,255,255,0.25);";
      return d;
    }

    // ── Import to Note button ───────────────────────────────────────────
    var importBtn = document.createElement("button");
    importBtn.id = "onyx-import";
    importBtn.style.cssText = [
      "background: rgba(255,255,255,0.18)",
      "border: 1px solid rgba(255,255,255,0.25)",
      "border-radius: 8px",
      "padding: 5px 12px",
      "color: white",
      "font-size: 12px",
      "font-weight: 600",
      "cursor: pointer",
      "transition: background 0.15s ease",
    ].join(";");
    importBtn.textContent = "Import to Note";
    importBtn.addEventListener("mouseenter", function () {
      importBtn.style.background = "rgba(255,255,255,0.3)";
    });
    importBtn.addEventListener("mouseleave", function () {
      importBtn.style.background = "rgba(255,255,255,0.18)";
    });

    // ── Back to Onyx button ─────────────────────────────────────────────
    var backBtn = document.createElement("button");
    backBtn.id = "onyx-back";
    backBtn.style.cssText = [
      "background: rgba(255,255,255,0.12)",
      "border: 1px solid rgba(255,255,255,0.2)",
      "border-radius: 8px",
      "padding: 5px 12px",
      "color: rgba(255,255,255,0.9)",
      "font-size: 12px",
      "font-weight: 600",
      "cursor: pointer",
      "transition: background 0.15s ease",
    ].join(";");
    backBtn.textContent = "\u2190 Back to Onyx";
    backBtn.addEventListener("mouseenter", function () {
      backBtn.style.background = "rgba(255,255,255,0.25)";
    });
    backBtn.addEventListener("mouseleave", function () {
      backBtn.style.background = "rgba(255,255,255,0.12)";
    });

    toolbar.appendChild(title);
    toolbar.appendChild(makeDivider());
    toolbar.appendChild(importBtn);
    toolbar.appendChild(makeDivider());
    toolbar.appendChild(backBtn);
    document.body.appendChild(toolbar);

    // ────────────────────────────────────────────────────────────────────────
    // 3. IMPORT HANDLER — user explicitly clicks to extract current email
    //    Zero scraping: only reads the DOM at the moment of the click.
    // ────────────────────────────────────────────────────────────────────────
    importBtn.addEventListener("click", function () {
      var senderEl =
        document.querySelector('[data-testid="from"]') ||
        document.querySelector('[aria-label*="From"]') ||
        document.querySelector(".allowTextSelection .lpc_hdr") ||
        document.querySelector("._pe_b"); // newer OWA class
      var subjectEl =
        document.querySelector('[data-testid="subject"]') ||
        document.querySelector('[role="heading"]') ||
        document.querySelector("h2") ||
        document.querySelector('[autoid="_lvs_1"]');
      var bodyEl =
        document.querySelector('[aria-label="Message body"]') ||
        document.querySelector(".wide-content-host") ||
        document.querySelector('[role="main"] div[class*="body"]') ||
        document.querySelector('[autoid="_lvv_v"]');

      var emailData = {
        sender: senderEl ? senderEl.textContent.trim() : "",
        subject: subjectEl ? subjectEl.textContent.trim() : "",
        body: bodyEl ? bodyEl.innerHTML : "",
      };

      if (window.__TAURI_INTERNALS__) {
        window.__TAURI_INTERNALS__
          .invoke("onyx_import_email", { email: emailData })
          .then(function () {
            showToast("Imported to Onyx \u2728");
          })
          .catch(function (err) {
            showToast("Import failed: " + err, true);
          });
      } else {
        showToast("Tauri bridge not available", true);
      }
    });

    // ────────────────────────────────────────────────────────────────────────
    // 4. BACK BUTTON — close this WebView and return to Onyx email UI
    // ────────────────────────────────────────────────────────────────────────
    backBtn.addEventListener("click", function () {
      if (window.__TAURI_INTERNALS__) {
        window.__TAURI_INTERNALS__
          .invoke("close_outlook_onyx")
          .catch(function (err) {
            console.error("[Onyx-Outlook] Close failed:", err);
          });
      } else {
        window.close();
      }
    });

    // ────────────────────────────────────────────────────────────────────────
    // 5. TOAST NOTIFICATION — small inline feedback
    // ────────────────────────────────────────────────────────────────────────
    function showToast(message, isError) {
      var existing = document.getElementById("onyx-toast");
      if (existing) existing.remove();

      var toast = document.createElement("div");
      toast.id = "onyx-toast";
      toast.textContent = message;
      toast.style.cssText = [
        "position: fixed",
        "bottom: 24px",
        "right: 24px",
        "z-index: 9999999",
        "padding: 12px 20px",
        "border-radius: 10px",
        "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        "font-size: 13px",
        "font-weight: 600",
        "color: white",
        "box-shadow: 0 8px 24px rgba(0,0,0,0.3)",
        "opacity: 0",
        "transform: translateY(8px)",
        "transition: opacity 0.25s ease, transform 0.25s ease",
        isError
          ? "background: linear-gradient(135deg, #ef4444, #dc2626)"
          : "background: linear-gradient(135deg, #8b5cf6, #6d28d9)",
      ].join(";");

      document.body.appendChild(toast);

      requestAnimationFrame(function () {
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
      });

      setTimeout(function () {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(8px)";
        setTimeout(function () {
          toast.remove();
        }, 300);
      }, 3000);
    }
  }
})();
