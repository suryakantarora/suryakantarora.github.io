(function () {
  "use strict";

  const nav = document.getElementById("nav");
  const navToggle = document.getElementById("navToggle");
  const navLinks = document.getElementById("navLinks");
  const sections = Array.prototype.slice.call(
    document.querySelectorAll("section[id], header[id]")
  );
  const navAnchors = navLinks ? navLinks.querySelectorAll("a") : [];

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const canAnimate = !reduceMotion;

  /* ── Version check ────────────────────────────────────────────────────────
     Re-downloads the document to compare the app-version meta tag. Deferred to
     idle time so it never competes with fonts/CSS on first paint, and guarded
     with a session flag: if a CDN keeps serving a stale document, the reload
     would otherwise repeat on every load.                                    */
  function checkForLatestVersion() {
    const versionMeta = document.querySelector('meta[name="app-version"]');
    const currentVersion = versionMeta ? versionMeta.getAttribute("content") : "";

    if (!currentVersion || !("fetch" in window) || !("DOMParser" in window)) {
      return;
    }

    const latestUrl = new URL(window.location.href);
    latestUrl.hash = "";
    latestUrl.searchParams.set("_cache_bust", Date.now().toString());

    fetch(latestUrl.toString(), { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Unable to check latest version");
        }
        return response.text();
      })
      .then(function (html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const latestMeta = doc.querySelector('meta[name="app-version"]');
        const latestVersion = latestMeta ? latestMeta.getAttribute("content") : "";

        if (!latestVersion || latestVersion === currentVersion) {
          return;
        }

        let alreadyReloaded = false;
        try {
          alreadyReloaded = sessionStorage.getItem("reloadedForVersion") === latestVersion;
          sessionStorage.setItem("reloadedForVersion", latestVersion);
        } catch (err) {
          return;
        }

        if (!alreadyReloaded) {
          const reloadUrl = new URL(window.location.href);
          reloadUrl.searchParams.set("v", latestVersion);
          window.location.replace(reloadUrl.toString());
        }
      })
      .catch(function () {
        // Keep the page usable if the version check fails.
      });
  }

  function whenIdle(fn) {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(fn, { timeout: 4000 });
    } else {
      window.setTimeout(fn, 2000);
    }
  }

  /* ── Mobile menu ────────────────────────────────────────────────────────── */
  function toggleMenu() {
    const isOpen = navLinks.classList.toggle("open");
    navToggle.classList.toggle("open", isOpen);
    navToggle.setAttribute("aria-expanded", String(isOpen));
  }

  function closeMenu() {
    if (!navLinks) return;
    navLinks.classList.remove("open");
    navToggle.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  }

  if (navToggle) navToggle.addEventListener("click", toggleMenu);
  navAnchors.forEach(function (link) { link.addEventListener("click", closeMenu); });

  /* ── Scroll-driven UI ─────────────────────────────────────────────────────
     One rAF-throttled handler for every scroll effect, so the page never does
     more than a single layout read per frame.                                */
  const progressBar = document.getElementById("scrollProgress");
  const toTop = document.getElementById("toTop");
  const tlFill = document.getElementById("tlFill");
  const timeline = document.querySelector(".tl");
  let ticking = false;

  function handleNavScroll() {
    const y = window.scrollY;

    if (nav) nav.classList.toggle("scrolled", y > 40);
    if (toTop) toTop.classList.toggle("show", y > 700);

    if (progressBar) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progressBar.style.transform = "scaleX(" + (max > 0 ? Math.min(y / max, 1) : 0) + ")";
    }

    if (tlFill && timeline) {
      const r = timeline.getBoundingClientRect();
      const travelled = (window.innerHeight * 0.65) - r.top;
      const pct = Math.max(0, Math.min(travelled / r.height, 1));
      tlFill.style.height = (pct * 100).toFixed(2) + "%";
    }

    ticking = false;
  }

  function onScroll() {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(handleNavScroll);
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });

  if (toTop) {
    toTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    });
  }

  /* ── Active nav link ──────────────────────────────────────────────────────
     An observer band near the top of the viewport, so no layout is read on
     scroll.                                                                  */
  function initNavHighlight() {
    if (!sections.length || !navAnchors.length || !("IntersectionObserver" in window)) return;

    const inBand = new Set();

    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          const id = entry.target.getAttribute("id");
          if (entry.isIntersecting) inBand.add(id);
          else inBand.delete(id);
        });

        for (let i = sections.length - 1; i >= 0; i--) {
          const id = sections[i].getAttribute("id");
          if (inBand.has(id)) {
            navAnchors.forEach(function (link) {
              link.classList.toggle("active", link.getAttribute("href") === "#" + id);
            });
            return;
          }
        }
      },
      { rootMargin: "-25% 0px -65% 0px", threshold: 0 }
    );

    sections.forEach(function (section) { observer.observe(section); });
  }

  /* ── Scroll reveal ──────────────────────────────────────────────────────── */
  function initReveal() {
    const items = document.querySelectorAll(".reveal, .reveal-child");

    if (!canAnimate || !("IntersectionObserver" in window)) {
      items.forEach(function (el) { el.classList.add("visible"); });
      return;
    }

    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    items.forEach(function (el) { observer.observe(el); });
  }

  /* ── Hero name: per-letter entrance ─────────────────────────────────────── */
  function initHeroName() {
    const el = document.querySelector(".hero-name");
    if (!el) return;

    const label = el.getAttribute("data-letters") || el.textContent;
    if (!canAnimate) return;

    el.textContent = "";
    label.split("").forEach(function (ch, i) {
      const span = document.createElement("span");
      span.className = "ltr";
      if (ch === " ") {
        span.innerHTML = "&nbsp;";
      } else {
        span.textContent = ch;
      }
      span.style.animationDelay = (0.18 + i * 0.035).toFixed(3) + "s";
      el.appendChild(span);
    });
  }

  /* ── Cycling role typewriter ────────────────────────────────────────────── */
  function initTypewriter() {
    const out = document.getElementById("typeLine");
    if (!out) return;

    const roles = [
      "Senior Java Backend Engineer",
      "Technical Lead",
      "Microservices Architect"
    ];

    if (!canAnimate) {
      out.textContent = roles[0];
      return;
    }

    let r = 0;
    let n = 0;
    let deleting = false;

    (function tick() {
      const word = roles[r];
      n += deleting ? -1 : 1;
      out.textContent = word.slice(0, n);

      let delay = deleting ? 34 : 62;
      if (!deleting && n === word.length) {
        delay = 1700;
        deleting = true;
      } else if (deleting && n === 0) {
        deleting = false;
        r = (r + 1) % roles.length;
        delay = 320;
      }
      window.setTimeout(tick, delay);
    })();
  }

  /* ── Animated counters ──────────────────────────────────────────────────── */
  function initCounters() {
    const nodes = document.querySelectorAll("[data-count]");
    if (!nodes.length) return;

    function paint(el, value) {
      el.textContent = (el.dataset.prefix || "") + value + (el.dataset.suffix || "");
    }

    if (!canAnimate || !("IntersectionObserver" in window)) {
      nodes.forEach(function (el) { paint(el, Number(el.dataset.count)); });
      return;
    }

    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          observer.unobserve(el);

          const target = Number(el.dataset.count) || 0;
          const duration = 1400;
          const start = performance.now();

          (function step(now) {
            const t = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            paint(el, Math.round(target * eased));
            if (t < 1) requestAnimationFrame(step);
          })(start);
        });
      },
      { threshold: 0.5 }
    );

    nodes.forEach(function (el) { observer.observe(el); });
  }

  /* ── Pointer effects: parallax, tilt, magnetic, spotlight ───────────────── */
  function initPointerFX() {
    if (!finePointer || !canAnimate) return;

    // Hero parallax on the floating tech chips
    const field = document.getElementById("orbitField");
    const hero = document.querySelector(".hero");
    if (field && hero) {
      hero.addEventListener("mousemove", function (e) {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        field.style.setProperty("--px", ((e.clientX - cx) / cx * 12).toFixed(2) + "px");
        field.style.setProperty("--py", ((e.clientY - cy) / cy * 12).toFixed(2) + "px");
      }, { passive: true });
      hero.addEventListener("mouseleave", function () {
        field.style.setProperty("--px", "0px");
        field.style.setProperty("--py", "0px");
      });
    }

    // Card tilt
    document.querySelectorAll(".tilt").forEach(function (card) {
      card.addEventListener("mousemove", function (e) {
        const r = card.getBoundingClientRect();
        const rx = ((e.clientY - r.top) / r.height - 0.5) * -5;
        const ry = ((e.clientX - r.left) / r.width - 0.5) * 5;
        card.style.transform =
          "perspective(900px) rotateX(" + rx.toFixed(2) + "deg) rotateY(" +
          ry.toFixed(2) + "deg) translateY(-6px)";
      }, { passive: true });
      card.addEventListener("mouseleave", function () { card.style.transform = ""; });
    });

    // Magnetic buttons + cursor spotlight inside CTAs
    document.querySelectorAll(".magnetic").forEach(function (btn) {
      btn.addEventListener("mousemove", function (e) {
        const r = btn.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        btn.style.setProperty("--mx", mx + "px");
        btn.style.setProperty("--my", my + "px");
        btn.style.transform =
          "translate(" + ((mx - r.width / 2) * 0.14).toFixed(2) + "px," +
          ((my - r.height / 2) * 0.22).toFixed(2) + "px)";
      }, { passive: true });
      btn.addEventListener("mouseleave", function () { btn.style.transform = ""; });
    });
  }

  function initResumePrint() {
    const modal = document.getElementById("resumeModal");
    const backdrop = document.getElementById("resumeModalBackdrop");
    const printBtn = document.getElementById("resumePrintBtn");
    const downloadBtn = document.getElementById("resumeDownloadBtn");
    const closeBtn = document.getElementById("resumeCloseBtn");

    if (!modal || !backdrop || !printBtn || !closeBtn) {
      return;
    }

    // Browsers derive the "Save as PDF" filename from document.title, so swap in
    // a proper name for the duration of the print and restore it afterwards.
    const PDF_FILENAME = "Surya Kant Kumar - Java Technical Lead";
    let pageTitle = document.title;

    const FOCUSABLE =
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
    let lastFocused = null;

    function isOpen() {
      return !modal.hidden;
    }

    function openResumeModal() {
      if (isOpen()) {
        return;
      }
      lastFocused = document.activeElement;
      modal.hidden = false;
      document.body.classList.add("modal-open");
      closeBtn.focus();
    }

    function closeResumeModal() {
      if (!isOpen()) {
        return;
      }
      modal.hidden = true;
      document.body.classList.remove("modal-open");

      // Return focus to whatever opened the modal. If that element is gone or
      // was never really focused (e.g. the dialog was opened by keyboard
      // shortcut), fall back to a visible trigger — otherwise focus would be
      // stranded on the now-hidden dialog.
      const canRestore =
        lastFocused &&
        lastFocused !== document.body &&
        document.contains(lastFocused) &&
        typeof lastFocused.focus === "function";
      const target = canRestore ? lastFocused : document.querySelector(".resume-open-btn");

      if (target && typeof target.focus === "function") {
        target.focus();
      }
      lastFocused = null;
    }

    function printResume() {
      document.body.classList.add("print-resume-mode");
      window.print();
    }

    // Keep Tab within the dialog while it is open.
    function trapFocus(e) {
      const items = Array.prototype.filter.call(
        modal.querySelectorAll(FOCUSABLE),
        function (el) {
          return el.offsetParent !== null || el === document.activeElement;
        }
      );

      if (!items.length) {
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", function (e) {
      if (!e.key) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        // Already looking at the resume? Ctrl/Cmd+P should print it.
        if (isOpen()) {
          printResume();
        } else {
          openResumeModal();
        }
        return;
      }

      if (!isOpen()) {
        return;
      }

      if (e.key === "Escape") {
        closeResumeModal();
      } else if (e.key === "Tab") {
        trapFocus(e);
      }
    });

    printBtn.addEventListener("click", printResume);

    /* ── Download: build a PDF from the live resume markup ────────────────
       The generator is fetched on first use so visitors who never download
       don't pay for it. Falls back to the print dialog if it can't load.   */
    let pdfLoader = null;

    function loadPdfBuilder() {
      if (window.buildResumePdf) return Promise.resolve(window.buildResumePdf);
      if (!pdfLoader) {
        pdfLoader = new Promise(function (resolve, reject) {
          const s = document.createElement("script");
          s.src = "resume-pdf.js?v=2026.07.16.5";
          s.onload = function () {
            window.buildResumePdf ? resolve(window.buildResumePdf) : reject(new Error("bad build"));
          };
          s.onerror = function () {
            pdfLoader = null;
            reject(new Error("load failed"));
          };
          document.head.appendChild(s);
        });
      }
      return pdfLoader;
    }

    function downloadResume() {
      const source = document.getElementById("resumePrintable");
      if (!source || downloadBtn.disabled) return;

      downloadBtn.disabled = true;
      downloadBtn.classList.add("is-busy");

      loadPdfBuilder()
        .then(function (build) { return build(source); })
        .then(function (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = PDF_FILENAME + ".pdf";
          document.body.appendChild(a);
          a.click();
          a.remove();
          // Revoke once the browser has handed the blob to the download manager.
          setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
        })
        .catch(function () {
          // Never leave the user without a way out.
          printResume();
        })
        .then(function () {
          downloadBtn.disabled = false;
          downloadBtn.classList.remove("is-busy");
        });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener("click", downloadResume);
    }
    closeBtn.addEventListener("click", closeResumeModal);
    backdrop.addEventListener("click", closeResumeModal);

    document.querySelectorAll(".resume-open-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openResumeModal();
        closeMenu();
      });
    });

    // Printing from the browser menu (File > Print) must produce the same clean
    // resume as the toolbar button. The print stylesheet already reveals the
    // dialog even while it is hidden, so switching on the same class is enough
    // — no cloned copy of the resume required.
    window.addEventListener("beforeprint", function () {
      document.body.classList.add("print-resume-mode");
      if (document.title !== PDF_FILENAME) {
        pageTitle = document.title;
        document.title = PDF_FILENAME;
      }
    });

    window.addEventListener("afterprint", function () {
      document.body.classList.remove("print-resume-mode");
      document.title = pageTitle;
    });
  }

  handleNavScroll();
  initNavHighlight();
  initReveal();
  initHeroName();
  initTypewriter();
  initCounters();
  initPointerFX();
  initResumePrint();
  whenIdle(checkForLatestVersion);
})();
