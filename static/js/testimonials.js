// Fills the testimonials page from the JSON named by the container's
// `data-src`, using the templates the page ships beside it.
//
// The quotes are other people's words, and the list may one day be served from
// somewhere that collects them rather than from this repository. Nothing here
// ever assigns markup: values reach the page through `textContent` and
// `setAttribute` only, so a quote containing a tag shows the tag.

(function () {
  "use strict";

  var container = document.querySelector(".testimonials");
  if (!container) {
    return;
  }

  var templates = {
    card: document.querySelector(".testimonial-template"),
    paragraph: document.querySelector(".testimonial-paragraph"),
    question: document.querySelector(".testimonial-question-template"),
    date: document.querySelector(".testimonial-date-template")
  };

  // Keyed by the network id a quote names in `platform`.
  var networks = {};
  document.querySelectorAll(".testimonial-icon").forEach(function (template) {
    networks[template.dataset.network] = template;
  });

  function clone(template) {
    return template.content.firstElementChild.cloneNode(true);
  }

  // An `url` is only ever followed if it is one the browser would navigate to.
  // `javascript:` and `data:` are URLs too, and a name is a link the reader is
  // invited to click, so the scheme is checked rather than the string.
  function httpUrl(url) {
    if (typeof url !== "string" || !url) {
      return null;
    }
    try {
      var parsed = new URL(url, document.baseURI);
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
    } catch (error) {
      return null;
    }
  }

  // `date` is an ISO day, written the way the rest of the site writes one. One
  // that is not a real day is left out rather than printed: `Date` rolls a
  // 30th of February over into March rather than rejecting it, so the parts it
  // gives back have to be the parts it was handed.
  function buildDate(date) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
    if (!match) {
      return null;
    }
    var year = Number(match[1]), month = Number(match[2]) - 1, dayOfMonth = Number(match[3]);
    var day = new Date(year, month, dayOfMonth);
    if (day.getFullYear() !== year || day.getMonth() !== month || day.getDate() !== dayOfMonth) {
      return null;
    }

    var element = clone(templates.date);
    element.setAttribute("datetime", date);
    element.textContent = day.toLocaleDateString("de-AT", {
      day: "numeric", month: "long", year: "numeric"
    });
    return element;
  }

  // The name, and where the quote comes from. A `handle` links to the profile;
  // a network without one only says which network it was.
  function buildSource(figcaption, testimonial) {
    var name = figcaption.querySelector(".testimonial-name");
    var url = httpUrl(testimonial.url);

    if (url) {
      var link = document.createElement("a");
      link.className = name.className;
      link.setAttribute("href", url);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "nofollow noopener noreferrer");
      link.textContent = testimonial.name;
      name.replaceWith(link);
    } else {
      name.textContent = testimonial.name;
    }

    var network = networks[testimonial.platform];
    if (!network) {
      return;
    }

    var handle = testimonial.handle;
    var element = document.createElement(handle ? "a" : "span");
    element.className = "testimonial-handle";
    element.appendChild(clone(network));

    if (handle) {
      element.setAttribute("href", network.dataset.profile + encodeURIComponent(handle));
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "nofollow noopener noreferrer");
      element.appendChild(document.createTextNode(handle));
    }

    // The icon carries no accessible name of its own, and a handle such as
    // `lari_dob` does not say "Instagram", so the network is named in text.
    var label = document.createElement("span");
    label.className = "visually-hidden";
    label.textContent = (handle ? " auf " : "auf ") + network.dataset.name;
    element.appendChild(label);

    figcaption.appendChild(element);
  }

  function buildCard(testimonial) {
    var card = clone(templates.card);
    var quote = card.querySelector("blockquote");

    (testimonial.blocks || []).forEach(function (block) {
      var paragraph = clone(block.kind === "question" ? templates.question : templates.paragraph);
      paragraph.textContent = block.value;
      quote.appendChild(paragraph);
    });

    var figcaption = card.querySelector("figcaption");
    buildSource(figcaption, testimonial);

    var date = buildDate(testimonial.date);
    if (date) {
      figcaption.appendChild(date);
    }

    return card;
  }

  function render(testimonials) {
    var cards = document.createDocumentFragment();
    testimonials.forEach(function (testimonial) {
      cards.appendChild(buildCard(testimonial));
    });
    container.replaceChildren(cards);
  }

  function fail(reason) {
    console.error("Testimonials could not be loaded:", reason);
    var message = document.createElement("p");
    message.className = "testimonials-message";
    message.textContent = "Die Testimonials konnten nicht geladen werden.";
    container.replaceChildren(message);
  }

  fetch(container.dataset.src, { credentials: "omit" })
    .then(function (response) {
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      return response.json();
    })
    .then(function (data) {
      var testimonials = data && data.testimonials;
      if (!Array.isArray(testimonials)) {
        throw new Error("no testimonials array");
      }
      render(testimonials);
    })
    .catch(fail)
    .finally(function () {
      container.setAttribute("aria-busy", "false");
    });
})();
