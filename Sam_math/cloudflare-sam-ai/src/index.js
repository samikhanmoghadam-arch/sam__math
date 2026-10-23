const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

const SEARCH_RESULTS = 6;
const SEARCH_TIMEOUT_MS = 12000;

// Accepts "example.com", "www.example.com" or "https://example.com/path"; returns "" when empty, null when invalid.
function cleanSite(value) {
  let site = String(value || "").trim().toLowerCase();
  if (!site) return "";
  site = site.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(site) ? site : null;
}

function stripTags(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Live Google results through Serper.dev. Needs the Worker secret SERPER_API_KEY.
async function searchWeb(query, site, env) {
  if (!env.SERPER_API_KEY) {
    throw new Error("کلید جست‌وجوی وب روی Worker تنظیم نشده است (secret با نام SERPER_API_KEY).");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": env.SERPER_API_KEY },
      body: JSON.stringify({ q: site ? `${query} site:${site}` : query, num: SEARCH_RESULTS }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`جست‌وجوی وب ناموفق بود (HTTP ${response.status}).`);
    const data = await response.json();
    const results = Array.isArray(data?.organic) ? data.organic : [];
    const sources = [];
    for (const item of results.slice(0, SEARCH_RESULTS)) {
      try {
        const link = new URL(String(item.link || ""));
        if (link.protocol !== "https:" && link.protocol !== "http:") continue;
        sources.push({
          title: stripTags(item.title) || link.hostname,
          url: link.href,
          domain: link.hostname.replace(/^www\./, ""),
          snippet: stripTags(item.snippet).slice(0, 400)
        });
      } catch {
        // Skip malformed result URLs.
      }
    }
    return sources;
  } finally {
    clearTimeout(timer);
  }
}

function buildSourceContext(sources, site) {
  const list = sources.map((s, i) => `[${i + 1}] ${s.title}\nآدرس: ${s.url}\nخلاصه: ${s.snippet}`).join("\n\n");
  return `در این پاسخ به نتایج جست‌وجوی زندهٔ وب${site ? ` داخل سایت ${site}` : ""} دسترسی داری. این نتایج برای پرسش کاربر است:\n\n${list}\n\nقوانین: ۱) پاسخ را فقط بر اساس همین نتایج بنویس و هر بخشی که از یک منبع آمده را با شمارهٔ آن مثل [1] مشخص کن. ۲) اگر نتایج برای پاسخ کافی نبود، صریح بگو. ۳) عدد، تاریخ، نام یا نقل‌قولی را که در نتایج نیست جعل نکن.`;
}

const SYSTEM_PROMPT = `تو SAM AI هستی؛ یک دستیار هوش مصنوعی عمومی، دقیق، صبور، خلاق و خوش‌برخورد. فقط معلم ریاضی نیستی و باید به طیف گسترده‌ای از موضوعات کمک کنی: برنامه‌نویسی و رفع خطا، علوم و فناوری، ریاضی، زبان‌آموزی، تاریخ و جغرافیا، نوشتن و ویرایش، ایده‌پردازی، مطالعه، منطق، هنر و پرسش‌های روزمره.
زبان پیش‌فرض تو فارسی روان و طبیعی است؛ اگر کاربر زبان دیگری خواست، به همان زبان پاسخ بده. لحن دوستانه، روشن و مناسب نوجوانان داشته باش. از تاریخچهٔ پیام‌های ارسالی استفاده کن تا سؤال‌های پیگیری را بفهمی و مجبور نباشی کاربر موضوع را تکرار کند.
روش پاسخ‌گویی:
۱) ابتدا منظور واقعی کاربر را تشخیص بده و مستقیم به همان پاسخ بده؛ اگر لازم است سؤال تکمیلی کوتاهی بپرس.
۲) برای مسائل پیچیده، پاسخ را به گام‌های واضح تقسیم کن و دلیل هر گام را توضیح بده. برای درخواست‌های ساده، کوتاه و مستقیم پاسخ بده.
۳) در برنامه‌نویسی، وقتی کد خواسته می‌شود، کد کامل و قابل استفاده بده، بگو در کدام فایل قرار بگیرد و دستورهای اجرا را روشن بنویس. هیچ‌وقت ادعا نکن کد را اجرا یا آزمایش کرده‌ای مگر واقعاً آزمایش شده باشد.
۴) در ریاضی و علوم، محاسبات و استدلال را بررسی کن؛ اگر کاربر چیزی را نفهمید، با روش یا مثال متفاوت توضیح بده.
۵) اگر کاربر پرسید آیا به وب یا گوگل دسترسی داری: اگر نتایج جست‌وجوی وب همراه پیام آمده، بله؛ بگو که الان از نتایج جست‌وجوی گوگل استفاده میکنی و شمارهٔ منبع را کنار مطالب بنویس. اگر نتایج همراه پیام نیامده، بگو که این بار جست‌وجوی وب روشن نبوده. برای اطلاعات لحظه‌ای که نتیجهٔ جست‌وجو ندارد، از حدس‌زدن خبر تازه خودداری کن.
۶) «همه‌چیزدان» نیستی: اگر پاسخ را نمی‌دانی یا مطمئن نیستی، شفاف بگو، محدودیت‌ها را توضیح بده و واقعیت، احتمال و نظر را از هم جدا کن. منبع، عدد، نقل‌قول یا قابلیتی را جعل نکن.
۷) اطلاعات خصوصی، رمز عبور، کلید API یا دادهٔ حساس درخواست نکن. در موضوعات پزشکی، حقوقی، مالی و ایمنی، اطلاعات عمومی و محتاطانه بده و برای تصمیم‌های مهم مراجعه به متخصص را توصیه کن.
۸) اگر کاربر تمرین می‌خواهد، با سطح او هماهنگ شو و تعاملی کمک کن؛ اگر جواب کامل می‌خواهد، بی‌دلیل از دادن جواب طفره نرو.
قالب پاسخ:
- فارسی خوانا و طبیعی بنویس؛ انگلیسی بی‌دلیل، JSON خام و جداکننده‌های LaTeX مثل $...$ را استفاده نکن.
- فرمول‌ها را در صورت امکان به شکل خوانا مثل 2x + 5 = 17 بنویس.
- جواب را بیش از حد طولانی نکن، مگر اینکه کاربر توضیح کامل بخواهد. از تیترهای کوتاه و فهرست فقط وقتی کمک می‌کنند استفاده کن.
- در پاسخ‌های آموزشی، مثال ملموس بده؛ در پاسخ‌های فنی، جزئیات اجرایی دقیق و قابل‌پیگیری ارائه کن.`;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return reply({ error: "برای پرسش از SAM AI باید درخواست POST ارسال شود." }, 405);
    if (!env || !env.AI || typeof env.AI.run !== "function") {
      return reply({ error: "اتصال Workers AI روی این Worker تنظیم نشده است. binding با نام AI را بررسی کن." }, 503);
    }

    try {
      const body = await request.json();
      const site = cleanSite(body.site);
      const attachment = body.attachment && typeof body.attachment === "object" ? body.attachment : null;
      if (site === null) return reply({ error: "نام سایت معتبر نیست؛ مثل example.com بنویس." }, 400);
      let messages;
      if (Array.isArray(body.messages)) {
        messages = body.messages;
      } else {
        const question = String(body.question || "").trim();
        if (!question) return reply({ error: "لطفاً یک سؤال بنویس." }, 400);
        messages = [{ role: "user", content: question }];
      }

      messages = messages
        .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map(m => ({ role: m.role, content: m.content.trim().slice(-20000) }))
        .filter(m => m.content)
        .slice(-20);

      if (!messages.length || messages[messages.length - 1].role !== "user") {
        return reply({ error: "پیام کاربر دریافت نشد؛ دوباره تلاش کن." }, 400);
      }
      if (messages[messages.length - 1].content.length > 20000) {
        return reply({ error: "متن سؤال یا فایل بیش از حد طولانی است." }, 413);
      }

      // Images are validated before being passed to the vision-capable model.
      let imageUrl = null;
      if (attachment) {
        const data = typeof attachment.data === "string" ? attachment.data : "";
        const mime = typeof attachment.type === "string" ? attachment.type : "";
        const prefix = `data:${mime};base64,`;
        if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime) ||
            !data.startsWith(prefix) ||
            !/^[A-Za-z0-9+/=]+$/.test(data.slice(prefix.length)) ||
            data.length > 7 * 1024 * 1024) {
          return reply({ error: "عکس نامعتبر است یا حجم آن بیش از حد مجاز است. JPG، PNG، WEBP یا GIF تا ۵ مگابایت ارسال کن." }, 400);
        }
        imageUrl = data;
      }

      const systemMessages = [{ role: "system", content: SYSTEM_PROMPT }];
      let sources = [];
      if (body.web === true) {
        const query = messages[messages.length - 1].content;
        try {
          sources = await searchWeb(query, site, env);
        } catch (error) {
          return reply({ error: String(error?.message || error).slice(0, 300) }, 502);
        }
        systemMessages.push({
          role: "system",
          content: sources.length
            ? buildSourceContext(sources, site)
            : "جست‌وجوی وب برای این پرسش نتیجه‌ای نداشت. صادقانه بگو نتیجهٔ مشخصی پیدا نشد و فقط در صورت اطمینان پاسخ عمومی بده."
        });
      }

      const modelMessages = [...systemMessages, ...messages];
      if (imageUrl) {
        const last = modelMessages[modelMessages.length - 1];
        last.content = [
          { type: "text", text: last.content || "این تصویر را بررسی کن و به پرسش کاربر پاسخ بده." },
          { type: "image_url", image_url: { url: imageUrl } }
        ];
      }

      const result = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
        messages: modelMessages,
        max_tokens: 900,
        temperature: 0.25,
        chat_template_kwargs: { enable_thinking: false }
      });

      const answer = result?.response || result?.choices?.[0]?.message?.content || result?.output_text;
      if (typeof answer !== "string" || !answer.trim()) {
        console.error("SAM AI returned an empty/unrecognized response shape");
        return reply({ error: "مدل پاسخ متنی برنگرداند. گزارش Worker و سهمیهٔ Workers AI را بررسی کن." }, 502);
      }
      return reply({
        answer: answer.trim(),
        sources: sources.map(({ title, url, domain }) => ({ title, url, domain }))
      });
    } catch (error) {
      const detail = String(error?.message || error || "Unknown error").slice(0, 300);
      console.error("SAM AI request failed:", detail);
      return reply({ error: `درخواست مدل ناموفق بود: ${detail}` }, 500);
    }
  }
};
