'use strict';
// RecruitCairn landing: header and menu, scroll reveals, nav indicator, request form, privacy dialog.
// The form is delivered by Web3Forms (public access key, only emails our inbox). The page stores nothing.
const inbox = 'recruitcairn@gmail.com';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Sticky header: compacts and gains depth once the page has scrolled.
const header = document.getElementById('site-header');
const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 12);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Mobile menu: disclosure pattern with Escape and outside click to close.
const toggle = document.getElementById('menu-toggle');
const nav = document.getElementById('site-nav');
const setMenu = open => {
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  nav.classList.toggle('is-open', open);
};
toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
nav.addEventListener('click', event => { if (event.target.closest('a')) setMenu(false); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { setMenu(false); toggle.focus(); }
});
document.addEventListener('click', event => { if (!header.contains(event.target)) setMenu(false); });
window.matchMedia('(min-width: 961px)').addEventListener('change', event => { if (event.matches) setMenu(false); });

// Smooth glide to in-page sections. Native smooth scrolling is abrupt in Chrome and off when the OS
// reduces motion; this eased glide is user-initiated, so it always runs (shorter with reduced motion).
const HEADER_GAP = 16;
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
let glideFrame = 0;
const stopGlide = () => { cancelAnimationFrame(glideFrame); glideFrame = 0; };
['wheel', 'touchstart', 'keydown'].forEach(type => window.addEventListener(type, stopGlide, { passive: true }));
const glideTo = target => {
  stopGlide();
  // The sticky header sits in the flow and compacts on scroll, which shifts the page up by the height it
  // loses; subtracting its current height lands the section just below the compact header.
  const top = target.id === 'top' ? 0 : target.getBoundingClientRect().top + window.scrollY - header.offsetHeight - HEADER_GAP;
  const start = window.scrollY;
  const distance = Math.max(0, Math.min(top, document.documentElement.scrollHeight - window.innerHeight)) - start;
  const duration = reduceMotion.matches ? 380 : Math.min(1100, Math.max(550, Math.abs(distance) * 0.35));
  const began = performance.now();
  const step = time => {
    const progress = Math.min(1, (time - began) / duration);
    window.scrollTo({ top: start + distance * ease(progress), behavior: 'instant' });
    glideFrame = progress < 1 ? requestAnimationFrame(step) : 0;
  };
  glideFrame = requestAnimationFrame(step);
};
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const target = document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)));
  if (!target) return;
  event.preventDefault();
  history.pushState(null, '', link.getAttribute('href'));
  glideTo(target);
  // Move keyboard focus to the section without a second jump.
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
});

// Scroll reveals: content stays visible without JS, without IntersectionObserver or with reduced motion.
if ('IntersectionObserver' in window && !reduceMotion.matches) {
  document.documentElement.classList.add('js');
  const revealer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('is-visible');
    revealer.unobserve(entry.target);
  }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach(element => revealer.observe(element));
}

// Nav indicator: marks the link of the section currently in view.
const navLinks = [...document.querySelectorAll('.site-nav a[data-nav]')];
if ('IntersectionObserver' in window) {
  // Every section is watched, so sections without a nav link (hero, about, contact) clear the mark.
  const spy = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    navLinks.forEach(link => {
      if (link.getAttribute('href') === '#' + entry.target.id) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }), { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('main > section').forEach(section => spy.observe(section));
}

// Request form: one form for the free sample, the pilot and questions.
const WEB3FORMS_KEY = 'e8273704-3ac5-4e69-8948-6325c8117f10';
const MIN_FILL_MS = 2500;
const intents = {
  sample: { label: 'Free sample', button: 'Request my free sample', message: 'Anything else? (optional)',
    done: 'We will reply to {email} to confirm fit and timing before we start your five opportunities.' },
  pilot: { label: 'Pilot', button: 'Ask about the pilot', message: 'Anything else? (optional)',
    done: 'We will reply to {email} with pilot dates and scope. Nothing is charged until you agree in writing.' },
  question: { label: 'Question', button: 'Send my question', message: 'Your question',
    done: 'We will reply to {email}, usually within one business day.' }
};
const form = document.getElementById('request-form');
const sendButton = document.getElementById('send-request');
const buttonLabel = sendButton.querySelector('.btn-label');
const statusText = document.getElementById('request-status');
const fallback = document.getElementById('request-fallback');
const requestText = document.getElementById('request-text');
const openRequest = document.getElementById('open-request');
const success = document.getElementById('request-success');
const successText = document.getElementById('success-text');
const loadedAt = Date.now();
let sending = false;
let lastSent = '';
let quickAttempt = false;

const currentIntent = () => (form.elements.intent.value in intents ? form.elements.intent.value : 'sample');
const value = id => String(form.elements[id].value || '').trim().replace(/[\r\n]+/g, ' ');
const setStatus = (text, kind) => { statusText.textContent = text; statusText.className = 'status' + (kind ? ' is-' + kind : ''); };
const errorFor = input => document.getElementById('err-' + input.id);

const applyIntent = () => {
  const intent = currentIntent();
  form.querySelectorAll('[data-for]').forEach(field => {
    const shown = field.dataset.for.split(' ').includes(intent);
    field.hidden = !shown;
    field.querySelectorAll('input').forEach(input => { input.required = shown; if (!shown) clearError(input); });
  });
  form.elements.message.required = intent === 'question';
  if (!form.elements.message.required) clearError(form.elements.message);
  document.getElementById('message-label').textContent = intents[intent].message;
  buttonLabel.textContent = intents[intent].button;
};
const selectIntent = intent => {
  if (!(intent in intents)) return;
  form.elements.intent.value = intent;
  applyIntent();
};

const messages = {
  name: 'Enter your name.',
  agency: 'Enter your agency’s name.',
  email: 'Enter a work email we can reply to, like name@agency.com.',
  focus: 'Tell us which roles you recruit for, so the research matches your desk.',
  markets: 'Tell us which hiring markets you cover, for example US remote.',
  message: 'Write your question so we can answer it.'
};
const clearError = input => {
  input.removeAttribute('aria-invalid');
  const error = errorFor(input);
  if (error) error.textContent = '';
};
const checkField = input => {
  input.value = input.type === 'email' ? input.value.trim() : input.value;
  const bad = !input.checkValidity() || (input.required && !input.value.trim());
  if (bad) {
    input.setAttribute('aria-invalid', 'true');
    errorFor(input).textContent = messages[input.id];
  } else clearError(input);
  return !bad;
};
const visibleFields = () => ['name', 'agency', 'email', 'focus', 'markets', 'message']
  .map(id => form.elements[id]).filter(input => !input.closest('[hidden]'));

const setBusy = busy => {
  sending = busy;
  sendButton.disabled = busy;
  sendButton.classList.toggle('is-loading', busy);
  form.setAttribute('aria-busy', String(busy));
  buttonLabel.textContent = busy ? 'Sending…' : intents[currentIntent()].button;
};
const buildBody = intent => [
  'Request: ' + intents[intent].label,
  'Name: ' + value('name'), 'Agency: ' + value('agency'), 'Reply email: ' + value('email'),
  ...(intent === 'question' ? [] : ['Roles we recruit for: ' + value('focus'), 'Hiring markets: ' + value('markets')]),
  'Message: ' + (value('message') || '(none)'), '', 'Sent from juanmacriniti.github.io/recruitcairn-web'
].join('\n');
const showEmailFallback = (subject, body) => {
  requestText.value = 'To: ' + inbox + '\nSubject: ' + subject + '\n\n' + body;
  openRequest.href = 'mailto:' + inbox + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  fallback.hidden = false;
};

form.addEventListener('change', event => { if (event.target.name === 'intent') applyIntent(); });
form.addEventListener('input', event => {
  if (event.target.getAttribute('aria-invalid') === 'true') checkField(event.target);
});
form.addEventListener('focusout', event => {
  const input = event.target;
  if (input.id in messages && input.value.trim()) checkField(input);
});
document.querySelectorAll('a[data-intent]').forEach(link => link.addEventListener('click', () => selectIntent(link.dataset.intent)));

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (sending) return;
  const invalid = visibleFields().filter(input => !checkField(input));
  if (invalid.length) {
    setStatus(invalid.length === 1 ? 'One field needs your attention.' : invalid.length + ' fields need your attention.', 'error');
    invalid[0].focus();
    return;
  }
  // Antispam: a form completed faster than a person can type is asked to confirm once.
  if (Date.now() - loadedAt < MIN_FILL_MS && !quickAttempt) {
    quickAttempt = true;
    setStatus('Please check your details and press the button again to send.', 'error');
    return;
  }
  const intent = currentIntent();
  const subject = 'RecruitCairn web request (' + intents[intent].label + '): ' + value('agency');
  const body = buildBody(intent);
  if (body === lastSent) {
    setStatus('This exact request was already sent. We will reply by email.', 'error');
    return;
  }
  setBusy(true);
  setStatus('Sending your request…');
  fallback.hidden = true;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15000);
  try {
    const response = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: WEB3FORMS_KEY, subject, from_name: 'RecruitCairn website', replyto: value('email'),
        botcheck: form.elements.botcheck.checked, request: intents[intent].label,
        name: value('name'), agency: value('agency'), email: value('email'),
        ...(intent === 'question' ? {} : { roles: value('focus'), markets: value('markets') }),
        message: value('message') || '(none)'
      }),
      signal: timeout.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.message || 'HTTP ' + response.status);
    lastSent = body;
    successText.textContent = intents[intent].done.replace('{email}', value('email'));
    setStatus('');
    form.hidden = true;
    success.hidden = false;
    success.focus();
  } catch (_) {
    setStatus('Your request could not be sent from this page. Please email it instead using the options below.', 'error');
    showEmailFallback(subject, body);
  } finally {
    clearTimeout(timer);
    setBusy(false);
  }
});
document.getElementById('send-another').addEventListener('click', () => {
  form.reset();
  visibleFields().forEach(clearError);
  applyIntent();
  success.hidden = true;
  form.hidden = false;
  form.elements.name.focus();
});
document.getElementById('copy-request').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(requestText.value);
    setStatus('Request copied. Paste it into an email to ' + inbox + ' and press Send.');
  } catch (_) {
    requestText.focus();
    requestText.select();
    setStatus('Select the text below, copy it and send it to ' + inbox + '.');
  }
});
applyIntent();

// Privacy dialog.
const privacy = document.getElementById('privacy-dialog');
document.querySelectorAll('[data-open-privacy]').forEach(button => button.addEventListener('click', () => privacy.showModal()));
document.getElementById('close-privacy').addEventListener('click', () => privacy.close());
privacy.addEventListener('click', event => { if (event.target === privacy) privacy.close(); });
