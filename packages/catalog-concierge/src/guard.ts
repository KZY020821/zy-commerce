/**
 * Off-topic guard for the storefront assistant.
 *
 * Runs BEFORE any model call, in plain code, so a question that has nothing to
 * do with the store costs zero tokens. It is deliberately store-agnostic: the
 * vocabulary is derived from whatever that tenant actually sells (category
 * names, brands, product names, specification keys and values), so the same
 * logic works for pickleball paddles, basketball shoes or anything else.
 *
 * Bias: let borderline questions through. A false block is visible and
 * annoying to a customer; a false pass costs a fraction of a cent and the
 * system prompt still keeps the model on the catalogue.
 */
import type { CatalogProfile } from "./profile";

/** The exact reply shown when a message is judged off-topic. */
export const OFF_TOPIC_REPLY =
  "It seems like the question is not related to the purpose of this chat, try with the sample questions below";

/**
 * Clear non-commerce intents. These win over every allow rule below, so
 * "write me a poem about shoes" is still blocked even though it says "shoes".
 */
const OFF_TOPIC_PATTERNS: RegExp[] = [
  // Content generation / assistant-as-chatbot
  /\b(write|compose|draft|generate|create|give|sing|make|tell|say)\s+(me\s+)?(a|an|some)?\s*(poem|haiku|rhyme|limerick|song|lyric|essay|story|joke|riddle|article|blog|code|script|program|email|letter|resume|cv|caption|quote)\b/,
  /\btell me a (joke|story)\b/,
  /\b(translate|translation)\b/,
  /\bsummar(ise|ize) (this|the following)\b/,
  // General knowledge / trivia
  /\b(weather|forecast|raining|temperature outside)\b/,
  /\b(president|prime minister|election|politics|government)\b/,
  /\b(capital of|population of|who invented|who discovered|when was .{2,30} born|how tall is)\b/,
  /\b(recipe|how to cook|how to bake)\b/,
  /\b(movie|film|song|album|netflix|spotify) recommendation/,
  // Homework / maths
  /\b(homework|assignment|exam answer|solve for x)\b/,
  /\bwhat(?:'s| is)\s*\d+\s*[+\-*/x]\s*\d+/,
  // A sum on its own ("12 * 7 ="). An operator is required: a bare number is
  // far more likely to be an answer to the assistant's own question — a budget
  // ("300"), a shoe size ("10.5") — and blocking those broke real conversations.
  /^\s*\d[\d\s().]*[+*/][\d\s+\-*/().]*=?\s*$/,
  /^\s*\d[\d\s().]+-[\d\s().]*[+\-*/][\d\s+\-*/().]*=?\s*$/,
  // Finance / crypto (note: "stock market" must not catch "in stock")
  /\b(stock market|share price|crypto|bitcoin|forex|invest in)\b/,
  // Medical / legal advice
  /\b(diagnose|symptom|prescription|legal advice|sue)\b/,
  // Prompt injection / role reassignment
  /\bignore (all |any |the )?(previous|prior|above)\b/,
  /\b(system prompt|your instructions|you are now|act as|pretend to be|jailbreak|developer mode)\b/,
];

/**
 * Commerce intent that stands on its own: if a message contains one of these,
 * it is a shopping question even when it names no product ("what's cheapest?",
 * "do you ship?", "help me choose").
 */
const STRONG_INTENT = new Set([
  // price
  "price", "prices", "pricing", "cost", "costs", "cheap", "cheaper", "cheapest", "expensive", "budget",
  "afford", "affordable", "discount", "sale", "deal", "deals", "offer", "under", "below", "rm", "usd", "myr", "dollar", "ringgit",
  // buying / logistics
  "buy", "purchase", "order", "checkout", "cart", "ship", "shipping", "shipped", "deliver", "delivery",
  "stock", "instock", "available", "availability", "soldout", "warranty", "return", "returns", "refund", "exchange",
  // product selection
  "size", "sizes", "sizing", "fit", "fits", "colour", "colours", "color", "colors",
  "compare", "comparison", "difference", "differences", "versus", "vs",
  "recommend", "recommendation", "recommendations", "suggest", "choose", "choosing", "pick",
  "spec", "specs", "specification", "specifications", "feature", "features", "material", "materials",
  "product", "products", "item", "items", "model", "models", "brand", "brands", "catalogue", "catalog", "range", "collection",
  "beginner", "intermediate", "advanced", "professional",
  "lightweight", "durable", "weight", "heavy", "light",
  // common non-English shopping terms (this platform targets MY/SG)
  "harga", "berapa", "murah", "mahal", "saiz", "beli", "ada", "stok", "warna", "cadangkan",
]);

/** Words too generic to imply shopping on their own, kept out of the vocabulary. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at", "for", "with", "by", "from", "as",
  "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "have", "has", "had", "can", "could",
  "will", "would", "should", "shall", "may", "might", "must", "this", "that", "these", "those", "it", "its",
  "i", "you", "he", "she", "we", "they", "me", "my", "your", "his", "her", "our", "their", "what", "which",
  "who", "whom", "when", "where", "why", "how", "all", "any", "some", "no", "not", "only", "own", "same",
  "so", "than", "too", "very", "just", "now", "then", "there", "here", "up", "out", "about", "into", "over",
  "new", "get", "got", "want", "need", "like", "good", "best", "show", "tell", "give", "find", "looking", "help",
  "edition", "unisex", "mens", "womens", "kids", "big", "little",
]);

/**
 * Openers and acknowledgements. Matched on the leading token of a very short
 * message, so "hey there" and "good morning" count without letting a long
 * sentence in just because it starts politely.
 */
const GREETING_WORDS = new Set([
  "hi", "hello", "hey", "yo", "hai", "halo", "hola", "greetings", "good", "morning", "afternoon", "evening",
  "thanks", "thank", "ty", "ok", "okay", "sure", "cool", "nice", "great",
]);
const MAX_GREETING_TOKENS = 3;
/** Longest message still treated as a reply rather than a fresh request. */
const MAX_FOLLOW_UP_TOKENS = 6;

/**
 * Words that point back at something already on screen. A short message
 * containing one of these is continuing the conversation ("the first one",
 * "why?", "something cheaper"); a short message containing none of them is
 * usually a brand new request, and a brand new request has to earn its way in
 * on its own merits like any first message.
 */
const REFERENTIAL_WORDS = new Set([
  // pointing at a previous answer
  "it", "its", "this", "that", "these", "those", "them", "they", "one", "ones", "both", "either", "neither",
  "first", "second", "third", "last", "former", "latter", "other", "another", "else", "next", "previous",
  // agreeing, refusing, or asking for more of the same
  "yes", "yeah", "yep", "yup", "no", "nope", "nah", "maybe", "please",
  "more", "less", "fewer", "again", "instead", "rather", "prefer",
  // comparatives, which only mean anything against something already shown
  "cheaper", "cheapest", "pricier", "lighter", "heavier", "bigger", "smaller", "larger", "longer", "shorter",
  "better", "worse", "softer", "stiffer", "thicker", "thinner",
  // non-English equivalents matching the store's own regions
  "ya", "tak", "tidak", "itu", "ini", "yang", "lagi", "kenapa", "macam",
]);

/**
 * Question words. On their own these refer back — "why?", "which one?" — but
 * they also open most off-topic questions ever asked ("who won the world cup",
 * "what is the meaning of life"), so they only count as referential in a
 * message short enough to be nothing but the question.
 */
const INTERROGATIVES = new Set(["why", "how", "what", "which", "who", "whose", "where", "when"]);
const MAX_BARE_INTERROGATIVE_TOKENS = 2;

/**
 * Scripts that are written without spaces between words.
 *
 * Every rule above works on tokens, and tokenising Chinese on spaces yields
 * one token that is the whole sentence — so "有便宜的球拍吗" ("do you have a
 * cheap paddle?") matched nothing and was refused as off-topic, in a market
 * where a good share of customers type exactly that. These messages are
 * matched by substring instead, which is what the lack of separators calls
 * for. Chinese is covered in depth; Japanese and Korean cover the common
 * shopping words and question forms.
 */
const UNSEGMENTED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Off-topic intents, mirroring OFF_TOPIC_PATTERNS. Checked first, as they are. */
const UNSEGMENTED_OFF_TOPIC = [
  "天气", "天氣", "气温", "氣溫", "写一首", "寫一首", "写首诗", "寫首詩", "笑话", "笑話", "讲个故事", "講個故事",
  "翻译", "翻譯", "新闻", "新聞", "总统", "總統", "首相", "选举", "選舉", "股票", "比特币", "比特幣",
  "食谱", "食譜", "怎么做菜", "怎麼做菜", "作业", "作業", "数学题", "數學題",
  "忽略以上", "忽略之前", "系统提示", "系統提示", "扮演",
  "天気", "翻訳", "ニュース", "レシピ", "冗談",
  "날씨", "번역", "뉴스",
];

/** Shopping words: the unsegmented half of STRONG_INTENT. */
const UNSEGMENTED_INTENT = [
  "价格", "價格", "价钱", "價錢", "多少钱", "多少錢", "便宜", "贵", "貴", "预算", "預算", "折扣", "优惠", "優惠", "促销", "促銷",
  "尺寸", "尺码", "尺碼", "大小", "重量", "颜色", "顏色", "材质", "材質", "规格", "規格", "型号", "型號", "品牌",
  "推荐", "推薦", "介绍", "介紹", "适合", "適合", "比较", "比較", "区别", "區別", "差别", "差別",
  "新手", "初学", "初學", "进阶", "進階", "专业", "專業",
  "购买", "購買", "下单", "下單", "订单", "訂單", "库存", "庫存", "有货", "有貨", "现货", "現貨", "缺货", "缺貨",
  "发货", "發貨", "送货", "送貨", "运费", "運費", "邮费", "郵費", "退货", "退貨", "退款", "保修", "保固",
  "产品", "產品", "商品", "款式", "卖", "賣",
  "値段", "いくら", "サイズ", "在庫", "おすすめ", "送料", "返品",
  "가격", "얼마", "사이즈", "재고", "추천", "배송", "반품",
];

/** Markers that make the message a question — usually one for the shop. */
const UNSEGMENTED_QUESTION = [
  "吗", "嗎", "呢", "什么", "什麼", "怎么", "怎麼", "怎样", "怎樣", "哪", "多少", "几", "幾",
  "为什么", "為什麼", "能不能", "可不可以", "有没有", "有沒有", "是不是", "请问", "請問", "？",
  "ですか", "ますか", "どれ", "どの",
  "있나요", "인가요", "어느",
];

/** Openers, matched on a short message like their English counterparts. */
const UNSEGMENTED_GREETING = ["你好", "您好", "哈喽", "哈囉", "嗨", "早安", "午安", "晚安", "谢谢", "謝謝", "感谢", "感謝", "こんにちは", "ありがとう", "안녕하세요", "감사합니다"];

/** Pointing back at what is already on screen. */
const UNSEGMENTED_REFERENTIAL = [
  "这个", "這個", "那个", "那個", "这款", "這款", "那款", "这两", "這兩", "第一", "第二", "第三",
  "刚才", "剛才", "前面", "还有", "還有", "其他", "其它", "另一", "一样", "一樣", "更便宜", "便宜点", "便宜點", "好的",
  "これ", "それ", "こちら", "이거", "그거",
];

/** Longest message still treated as a greeting in a script without spaces. */
const MAX_UNSEGMENTED_GREETING_CHARS = 10;

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

/** Lowercase word tokens, keeping alphanumerics like "kd19" and "16mm". */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t.length >= 2);
}

/** Crude singular form so "paddles" matches a "paddle" vocabulary entry. */
function singular(token: string): string {
  if (token.length > 3 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

export interface VocabularySource {
  storeName: string;
  profile: CatalogProfile;
  /** Product names — the richest signal for "is this about something we sell?". */
  productNames: string[];
  /** Brand names not already visible in the profile's per-category brand lists. */
  brands?: string[];
}

/**
 * Builds the set of words that mean "this message is about our catalogue".
 * Pure numbers and stopwords are excluded so they can't make everything pass.
 */
export function buildStoreVocabulary(src: VocabularySource): Set<string> {
  const vocab = new Set<string>();
  const add = (text: string | null | undefined) => {
    if (!text) return;
    for (const token of tokenize(text)) {
      if (STOPWORDS.has(token)) continue;
      if (!/\p{L}/u.test(token)) continue; // skip pure numbers
      vocab.add(token);
      vocab.add(singular(token));
    }
  };

  add(src.storeName);
  for (const c of src.profile.categories) {
    add(c.name);
    add(c.slug.replace(/-/g, " "));
    for (const b of c.brands) add(b);
    for (const f of c.facets) {
      add(f.key);
      for (const v of f.values ?? []) add(v);
    }
  }
  for (const name of src.productNames) add(name);
  for (const brand of src.brands ?? []) add(brand);
  return vocab;
}

export type TopicVerdict =
  | { onTopic: true; reason: "catalogue-term" | "shopping-intent" | "greeting" | "follow-up" | "unsegmented-question" }
  | { onTopic: false; reason: "blocked-pattern" | "no-signal" };

export interface ClassifyOptions {
  /**
   * True once the customer has exchanged at least one turn with the assistant.
   *
   * This must come from the host's own storage. If it can be asserted by the
   * browser, the follow-up rule below becomes a way to talk to the model for
   * free — see the integration note in the README.
   */
  hasHistory: boolean;
  /**
   * True when the assistant's own last message asked the customer a question.
   *
   * The assistant's whole job is to ask one clarifying question at a time, so
   * the reply to it is short, has no keywords, and may be a word that appears
   * nowhere in the catalogue ("casually", "outdoors", "wide"). Those answers
   * have to get through. When the assistant did *not* just ask something, a
   * short message is far more likely to be a fresh request, and is held to the
   * same standard as a first message.
   *
   * Omitted, this defaults to false: strict, and safe for hosts that do not
   * track it.
   */
  awaitingAnswer?: boolean;
  /**
   * True when the customer is on a product page as they type.
   *
   * "Is this any good?" names nothing the catalogue would recognise, but it is
   * obviously about the product on screen — the same reasoning as the
   * follow-up rule, with the page playing the part of the previous turn.
   */
  viewingProduct?: boolean;
  /**
   * Quick-reply chips the assistant offered on its last turn.
   *
   * A chip the assistant itself put on screen cannot be off-topic, whatever it
   * says, so matching one is admitted outright. Hosts that store suggestions
   * alongside the transcript should pass them; without them a chip like
   * "Control and feel", which contains no catalogue term, can be refused.
   */
  offeredSuggestions?: string[];
}

/** Loose match for chip text: case and surrounding punctuation don't matter. */
function normalizeChip(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** True when the assistant's last message ends in, or contains, a question. */
export function isQuestion(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\?/.test(text);
}

/**
 * Decides whether a message is worth sending to the model. No network, no
 * tokens — this is the whole point of the guard.
 */
export function classifyMessage(message: string, vocab: Set<string>, opts: ClassifyOptions): TopicVerdict {
  const text = message.toLowerCase().trim();

  // 1. Explicit off-topic intents win outright, even if a product word appears.
  for (const pattern of OFF_TOPIC_PATTERNS) {
    if (pattern.test(text)) return { onTopic: false, reason: "blocked-pattern" };
  }
  if (containsAny(text, UNSEGMENTED_OFF_TOPIC)) return { onTopic: false, reason: "blocked-pattern" };

  // 2. A chip the assistant just offered. It put the words on screen, so
  //    refusing them would make the assistant contradict itself.
  if (opts.offeredSuggestions?.length) {
    const tapped = normalizeChip(message);
    if (tapped && opts.offeredSuggestions.some((s) => normalizeChip(s) === tapped)) {
      return { onTopic: true, reason: "follow-up" };
    }
  }

  const tokens = tokenize(message);

  // 3. Anything naming something we sell.
  for (const token of tokens) {
    if (vocab.has(token) || vocab.has(singular(token))) return { onTopic: true, reason: "catalogue-term" };
  }

  // 4. Shopping questions that name no product ("what's the cheapest?").
  for (const token of tokens) {
    if (STRONG_INTENT.has(token) || STRONG_INTENT.has(singular(token))) return { onTopic: true, reason: "shopping-intent" };
  }

  // 5. Plain greetings — blocking "hi" would just look broken. The deny list
  //    above has already caught things like "good ... weather?".
  if (tokens.length > 0 && tokens.length <= MAX_GREETING_TOKENS && GREETING_WORDS.has(tokens[0]!)) {
    return { onTopic: true, reason: "greeting" };
  }

  // 6. The same three questions again, for a message written without spaces
  //    between its words. Substring matching is the only thing that can find
  //    a word in "有便宜的球拍吗" without a Chinese dictionary.
  if (UNSEGMENTED_SCRIPT.test(text)) {
    if (containsAny(text, UNSEGMENTED_INTENT)) return { onTopic: true, reason: "shopping-intent" };
    if (text.length <= MAX_UNSEGMENTED_GREETING_CHARS && containsAny(text, UNSEGMENTED_GREETING)) return { onTopic: true, reason: "greeting" };
    // A question asked inside a shop is nearly always about the shop, and the
    // guard's standing bias is that a false block costs more than a false pass.
    if (containsAny(text, UNSEGMENTED_QUESTION)) return { onTopic: true, reason: "unsegmented-question" };
    if ((opts.hasHistory || opts.viewingProduct) && (opts.awaitingAnswer || containsAny(text, UNSEGMENTED_REFERENTIAL))) return { onTopic: true, reason: "follow-up" };
  }

  // 7. Short replies mid-conversation — or asked with a product open — carry no
  //    keywords of their own, so they need a reason to be let through beyond
  //    simply being short. Letting any short message pass once a thread exists
  //    meant "give me a haiku" reached the model on the second turn of a real
  //    conversation.
  if ((opts.hasHistory || opts.viewingProduct) && tokens.length > 0 && tokens.length <= MAX_FOLLOW_UP_TOKENS) {
    // The assistant just asked something, so this is its answer — and the
    // answer may be a word the catalogue has never heard of.
    if (opts.awaitingAnswer) return { onTopic: true, reason: "follow-up" };
    // Otherwise it has to point back at what is already on screen: "the first
    // one", "something cheaper", "size 10", or a bare "why?".
    const refersBack = tokens.some((t) => REFERENTIAL_WORDS.has(t) || REFERENTIAL_WORDS.has(singular(t)) || /^\d/.test(t));
    const bareQuestion = tokens.length <= MAX_BARE_INTERROGATIVE_TOKENS && tokens.some((t) => INTERROGATIVES.has(t));
    if (refersBack || bareQuestion) return { onTopic: true, reason: "follow-up" };
  }

  return { onTopic: false, reason: "no-signal" };
}
