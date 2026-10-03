// Safety module for child protection, personal privacy, and electrical safety

const UNSAFE_PATTERNS = [
  /\b(kill|suicide|die|hurt myself|self harm|weapon|gun|bomb|knife|drugs|poison|alcohol|abuse|hate|violence|nsfw|sex|porn)\b/i,
  /\b(danger|dangerous substance|explosive|fire hazard|burn down)\b/i
];

const PERSONAL_INFO_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, // email
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // US phone
  /\b(?:\+?\d{1,3}[-.\s]?)?\d{10}\b/, // 10-digit phone
  /\b(my name is|my full name is|i live at|my address is|my password is|my school is|credit card|my phone number is)\b/i
];

const MAINS_ELECTRICITY_PATTERNS = [
  /\b(wall socket|wall plug|mains|power outlet|220v|110v|plug into the wall|ac power|high voltage|electrical outlet)\b/i
];

function checkSafety(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.trim();

  // 1. Mains Electricity Safety (Crucial STEM physical safety)
  for (const pat of MAINS_ELECTRICITY_PATTERNS) {
    if (pat.test(lower)) {
      return {
        safe: false,
        category: 'mains_electricity',
        message: "⚡ Safety first! Only use small batteries (like AA or 3V coin cells) for our robot circuits, never wall sockets or mains power."
      };
    }
  }

  // 2. Personal Information Privacy
  for (const pat of PERSONAL_INFO_PATTERNS) {
    if (pat.test(lower)) {
      return {
        safe: false,
        category: 'personal_info',
        message: "🛡️ No need to share personal details like names, addresses, or phone numbers! Let's keep exploring science together safely."
      };
    }
  }

  // 3. Unsafe Topics
  for (const pat of UNSAFE_PATTERNS) {
    if (pat.test(lower)) {
      return {
        safe: false,
        category: 'unsafe_topic',
        message: "🌸 That sounds like something important to talk about with a trusted grown-up or teacher. Let's get back to making fun robots!"
      };
    }
  }

  return { safe: true };
}

module.exports = {
  checkSafety
};
