// ============================================================
//  ADAY — configuration par défaut
// ============================================================
//
// Copie ce fichier en `config.local.js` (dans le même dossier) et
// remplis tes valeurs. Au chargement, l'app lira ces defaults en
// PRIORITÉ (avant customs/settings.json). Tu peux toujours overrider via
// l'UI, et tes réglages non secrets resteront dans le stockage local ignoré.
// Si l'option Settings "Mémoriser la clé" est activée, le serveur local
// peut créer ou réécrire `config.local.js` dans ce format canonique.
//
// Le fichier est facultatif : si `config.local.js` est absent,
// l'app fonctionne normalement avec les valeurs du repo ou
// celles saisies dans l'UI.
//
// NE COMMITE PAS `config.local.js` si tu versionnes le dossier —
// il contient ta clé API. Mets-le dans .gitignore.

window.LLM_CONFIG_DEFAULTS = {
  // Exemples :
  //   Qwen intl : "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
  //   Qwen Chine: "https://dashscope.aliyuncs.com/compatible-mode/v1"
  //   Proxy     : "/v1"  (backend/server.py relaie vers LLM_BASE)
  //   Groq      : "https://api.groq.com/openai/v1"
  //   OpenAI    : "https://api.openai.com/v1"
  //   OpenRouter: "https://openrouter.ai/api/v1"
  //   Ollama    : "http://localhost:11434/v1"   (avec OLLAMA_ORIGINS=*)
  baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",

  // Exemples selon le provider :
  //   Qwen      : "qwen-plus" | "qwen-max" | "qwen-turbo" | "qwen-flash"
  //   Groq      : "openai/gpt-oss-120b" | "llama-3.3-70b-versatile"
  //   OpenAI    : "gpt-4o-mini" | "gpt-4o"
  //   OpenRouter: "openai/gpt-oss-120b:free" | "deepseek/deepseek-chat:free"
  //   Ollama    : "gpt-oss:120b" | "qwen2.5:14b"
  model: "qwen-plus",

  // Modèle multimodal utilisé pour analyser layouts, icônes et photos.
  // Qwen : "qwen-vl-plus" | "qwen-vl-max".
  // Laisse vide pour utiliser `model` en fallback.
  visionModel: "qwen-vl-plus",

  // Laisse vide ("") pour saisir la clé dans l'UI à chaque ouverture.
  // Si tu mets la clé ici, elle reste dans le fichier local (pas en
// Git : la clé reste toujours hors des JSON du stockage runtime).
  apiKey: "",
};
