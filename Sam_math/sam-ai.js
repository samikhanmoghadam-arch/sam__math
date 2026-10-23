/* SAM AI: persistent same-browser chat history and student-first tutoring. */
'use strict';
(() => {
  const SAM_AI_URL = "https://sam-ai-backend.sami-math-lab.workers.dev";
  const STORAGE_KEY = 'sam_ai_conversation_v1';
  const $ = (id) => document.getElementById(id);
  // Appearance only: independent light/dark preference for the SAM AI page.
  const themeButton = $('aiThemeBtn');
  const AI_THEME_KEY = 'sam-ai-theme';
  function applyAITheme(theme) {
    document.body.classList.toggle('light-theme', theme === 'light');
    if (themeButton) {
      themeButton.textContent = theme === 'light' ? '◐ ' : '◐ ';
      themeButton.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
    }
  }
  applyAITheme(localStorage.getItem(AI_THEME_KEY) === 'light' ? 'light' : 'dark');
  if (themeButton) themeButton.addEventListener('click', () => {
    const next = document.body.classList.contains('light-theme') ? 'dark' : 'light';
    localStorage.setItem(AI_THEME_KEY, next);
    applyAITheme(next);
  });

  const form = $('questionForm');
  const input = $('questionInput');
  const messages = $('messages');
  const sendButton = $('sendButton');
  const status = $('statusMessage');
  const dot = $('connectionDot');
  const connectionText = $('connectionText');
  const count = $('charCount');
  const webToggle = $('webSearchToggle');
  const siteInput = $('siteInput');
  const attachmentInput = $('attachmentInput');
  const attachButton = $('attachButton');
  const attachmentPreview = $('attachmentPreview');
  const attachmentName = $('attachmentName');
  const attachmentHint = $('attachmentHint');
  const removeAttachmentButton = $('removeAttachment');
  const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
  const MAX_TEXT_FILE_BYTES = 200 * 1024;
  let selectedAttachment = null;
  const MAX_HISTORY_MESSAGES = 20; // 10 user/assistant turns
  const MAX_SAVED_CHARS = 30000;
  let busy = false;
  let history = loadHistory();

  function setStatus(text, isError = false) {
    status.textContent = text;
    status.classList.toggle('error', isError);
  }
  function faNumber(n) { return String(n).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]); }
  function updateCount() { count.textContent = `${faNumber(input.value.length)} / ۲۰۰۰`; }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw || raw.length > MAX_SAVED_CHARS) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }))
        .filter(m => m.content.trim())
        .slice(-MAX_HISTORY_MESSAGES);
    } catch {
      return [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_HISTORY_MESSAGES)));
      return true;
    } catch (error) {
      console.warn('SAM AI could not save local chat history:', error);
      return false;
    }
  }

  // Remove common formatting wrappers without injecting model text as HTML.
  function cleanAnswer(value) {
    return String(value ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
      .replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1')
      .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
      .replace(/\\\((.*?)\\\)/gs, '$1')
      .replace(/\\\[(.*?)\\\]/gs, '$1')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function addMessage(role, text, thinking = false) {
    const article = document.createElement('article');
    article.className = `message ${role}`;
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'assistant' ? 'Σ' : '●';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (role === 'assistant') {
      const label = document.createElement('strong');
      label.textContent = 'SAM AI';
      bubble.appendChild(label);
    }
    const p = document.createElement('p');
    p.textContent = text;
    p.style.whiteSpace = 'pre-wrap';
    p.style.overflowWrap = 'anywhere';
    if (thinking) p.className = 'thinking';
    bubble.appendChild(p);
    article.append(avatar, bubble);
    messages.appendChild(article);
    messages.scrollTop = messages.scrollHeight;
    return { article, p };
  }

  // Shows the web sources of an answer: small site icon + tiny link text.
  function renderSources(article, sources) {
    if (!Array.isArray(sources) || !sources.length) return;
    const box = document.createElement('div');
    box.className = 'sources';
    for (const source of sources) {
      let domain = '';
      try { domain = new URL(source.url).hostname.replace(/^www\./, ''); } catch { continue; }
      const link = document.createElement('a');
      link.className = 'source-link';
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = source.title || domain;
      const icon = document.createElement('img');
      icon.className = 'source-icon';
      icon.alt = '';
      icon.width = 14;
      icon.height = 14;
      icon.loading = 'lazy';
      icon.referrerPolicy = 'no-referrer';
      icon.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
      icon.onerror = () => icon.remove();
      const text = document.createElement('span');
      text.className = 'source-text';
      text.textContent = `${source.title || domain} · ${domain}`;
      link.append(icon, text);
      box.appendChild(link);
    }
    if (box.childNodes.length) article.querySelector('.bubble').appendChild(box);
  }

  function renderSavedHistory() {
    messages.replaceChildren();
    if (!history.length) {
      addMessage('assistant', 'سلام دوست من! 😊 من SAM AI هستم؛ می‌تونم در برنامه‌نویسی، علوم، ریاضی، نوشتن، یادگیری و ایده‌پردازی کمکت کنم. چی تو ذهنته؟');
      return;
    }
    for (const item of history) addMessage(item.role, item.content);
    setStatus('گفت‌وگوی قبلی از حافظهٔ همین مرورگر بازیابی شد.');
  }

  function checkConfig() {
    const configured = /^https:\/\//.test(SAM_AI_URL);
    if (!configured) {
      dot.className = 'offline';
      connectionText.textContent = 'سرور هنوز تنظیم نشده است.';
      setStatus('آدرس سرور SAM AI تنظیم نشده است.', true);
    }
    return configured;
  }

  function resetAttachment() {
    selectedAttachment = null;
    if (attachmentInput) attachmentInput.value = '';
    if (attachmentPreview) attachmentPreview.hidden = true;
    if (attachmentName) attachmentName.textContent = '';
    if (attachButton) attachButton.disabled = false;
    if (attachmentHint) attachmentHint.textContent = 'عکس یا فایل متنی (حداکثر ۵ مگابایت)';
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('خواندن فایل ممکن نشد.'));
      reader.readAsDataURL(file);
    });
  }

  async function sendQuestion(question) {
    const clean = String(question || '').trim();
    const attachment = selectedAttachment;
    if ((!clean && !attachment) || busy) {
      if (!clean && !attachment) setStatus('اول یک پیام بنویس یا عکس/فایلی انتخاب کن.', true);
      return;
    }
    if (clean.length > 2000) {
      setStatus('سؤال بیش از ۲۰۰۰ نویسه است؛ کوتاه‌ترش کن.', true);
      return;
    }
    if (!checkConfig()) return;

    let prompt = clean;
    let imageData = null;
    let displayText = clean;
    if (attachment) {
      if (attachment.kind === 'image') {
        try { imageData = await readFileAsDataURL(attachment.file); }
        catch (error) { setStatus(error.message || 'خواندن عکس ناموفق بود.', true); return; }
        prompt = clean || 'لطفاً این تصویر را بررسی و توضیح بده.';
        displayText = `${clean ? clean + '\\n' : ''}📎 عکس: ${attachment.file.name}`;
      } else {
        prompt = `${clean ? clean + '\\n\\n' : 'لطفاً فایل زیر را بررسی کن.\\n\\n'}[محتوای فایل: ${attachment.file.name}]\\n${attachment.text}`;
        displayText = `${clean ? clean + '\\n' : ''}📎 فایل: ${attachment.file.name}`;
      }
    }
    if (!prompt.trim()) prompt = 'لطفاً این فایل را بررسی کن.';
    if (prompt.length > 20000) {
      setStatus('متن سؤال و فایل خیلی طولانی است؛ فایل کوچک‌تر یا متن کوتاه‌تری انتخاب کن.', true);
      return;
    }
    addMessage('user', displayText);
    input.value = '';
    updateCount();
    const pending = addMessage('assistant', 'دارم سؤال را بررسی می‌کنم…', true);
    busy = true;
    sendButton.disabled = true;
    input.disabled = true;
    if (attachButton) attachButton.disabled = true;
    setStatus('در حال ارتباط با SAM AI…');

    const outgoing = [...history, { role: 'user', content: prompt.slice(0, 20000) }].slice(-MAX_HISTORY_MESSAGES);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(SAM_AI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: outgoing,
          attachment: imageData ? { name: attachment.file.name, type: attachment.file.type || 'image/jpeg', data: imageData } : null,
          web: Boolean(webToggle && webToggle.checked),
          site: siteInput ? siteInput.value.trim() : ''
        }),
        signal: controller.signal
      });
      let data;
      try { data = await response.json(); }
      catch { throw new Error(`پاسخ سرور قابل خواندن نیست (HTTP ${response.status}).`); }
      if (!response.ok) throw new Error(data.error || `خطای سرور (HTTP ${response.status})`);
      if (typeof data.answer !== 'string' || !data.answer.trim()) {
        throw new Error(data.error || 'پاسخ خالی از مدل دریافت شد.');
      }

      const answer = cleanAnswer(data.answer);
      pending.p.textContent = answer;
      pending.p.classList.remove('thinking');
      renderSources(pending.article, data.sources);
      history = [...outgoing, { role: 'assistant', content: answer }].slice(-MAX_HISTORY_MESSAGES);
      const saved = saveHistory();
      resetAttachment();
      setStatus(saved
        ? 'پاسخ دریافت شد؛ گفت‌وگو روی همین مرورگر ذخیره شد.'
        : 'پاسخ دریافت شد، اما مرورگر اجازهٔ ذخیرهٔ تاریخچه را نداد.');
      dot.className = 'online';
      connectionText.textContent = 'اتصال موفق';
    } catch (error) {
      const message = error.name === 'AbortError'
        ? 'زمان پاسخ‌گویی تمام شد. اینترنت، وضعیت سرور و سهمیهٔ AI را بررسی کن.'
        : (error.message || 'خطای ناشناختهٔ اتصال');
      pending.p.textContent = `پاسخ دریافت نشد: ${message}`;
      pending.p.classList.remove('thinking');
      setStatus('اتصال یا پاسخ مدل ناموفق بود. جزئیات خطا در پیام بالا آمده است.', true);
      dot.className = 'offline';
      connectionText.textContent = 'پاسخ دریافت نشد';
    } finally {
      clearTimeout(timer);
      busy = false;
      sendButton.disabled = false;
      input.disabled = false;
      if (attachButton) attachButton.disabled = false;
      input.focus();
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    sendQuestion(input.value);
  });
  input.addEventListener('input', updateCount);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  document.querySelectorAll('[data-prompt]').forEach(button => {
    button.addEventListener('click', () => {
      input.value = button.dataset.prompt;
      updateCount();
      input.focus();
    });
  });
  $('clearChat').addEventListener('click', () => {
    if (busy) return;
    if (history.length && !window.confirm('گفت‌وگوی ذخیره‌شده در این مرورگر پاک شود؟')) return;
    history = [];
    try { localStorage.removeItem(STORAGE_KEY); } catch (error) { console.warn('Could not clear local history:', error); }
    renderSavedHistory();
    setStatus('گفت‌وگوی تازه شروع شد؛ تاریخچهٔ ذخیره‌شدهٔ این گفت‌وگو پاک شد.');
  });

  if (attachButton && attachmentInput) {
    attachButton.addEventListener('click', () => {
      if (!busy) attachmentInput.click();
    });
    attachmentInput.addEventListener('change', async () => {
      const file = attachmentInput.files && attachmentInput.files[0];
      if (!file) return;
      if (file.size > MAX_ATTACHMENT_BYTES) {
        resetAttachment();
        setStatus('حجم فایل بیشتر از ۵ مگابایت است. لطفاً فایل کوچک‌تری انتخاب کن.', true);
        return;
      }
      const isImage = file.type.startsWith('image/');
      if (isImage) {
        if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) {
          resetAttachment();
          setStatus('این نوع عکس پشتیبانی نمی‌شود؛ JPG، PNG، WEBP یا GIF انتخاب کن.', true);
          return;
        }
        selectedAttachment = { file, kind: 'image' };
      } else {
        const ext = file.name.split('.').pop().toLowerCase();
        const allowed = ['txt','md','csv','json','js','py','html','css','xml','log'];
        if (!allowed.includes(ext) || file.size > MAX_TEXT_FILE_BYTES) {
          resetAttachment();
          setStatus('فقط فایل متنی TXT، MD، CSV، JSON، JS، PY، HTML، CSS، XML یا LOG تا ۲۰۰ کیلوبایت پشتیبانی می‌شود.', true);
          return;
        }
        try {
          const text = await file.text();
          selectedAttachment = { file, kind: 'text', text: text.slice(0, 20000) };
        } catch {
          resetAttachment();
          setStatus('خواندن فایل متنی ممکن نشد.', true);
          return;
        }
      }
      attachmentName.textContent = file.name;
      attachmentPreview.hidden = false;
      attachmentHint.textContent = isImage ? 'عکس آمادهٔ ارسال است' : 'فایل متنی آمادهٔ ارسال است';
      setStatus('فایل انتخاب شد؛ حالا روی «ارسال پیام» بزن.');
    });
    if (removeAttachmentButton) removeAttachmentButton.addEventListener('click', resetAttachment);
  }

  renderSavedHistory();
  updateCount();
  checkConfig();
})();
