"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

export type Locale = "en" | "pt-BR" | "es-MX";

export type LocaleMeta = {
  code: Locale;
  label: string;
  shortLabel: string;
  flag: string;
  speechLang: string;
};

export const LOCALES: readonly LocaleMeta[] = [
  { code: "en", label: "English", shortLabel: "EN", flag: "🇺🇸", speechLang: "en-US" },
  {
    code: "pt-BR",
    label: "Português (Brasil)",
    shortLabel: "PT",
    flag: "🇧🇷",
    speechLang: "pt-BR"
  },
  {
    code: "es-MX",
    label: "Español (México)",
    shortLabel: "ES",
    flag: "🇲🇽",
    speechLang: "es-MX"
  }
] as const;

type Dictionary = {
  app: {
    title: string;
    subtitle: string;
  };
  status: {
    idle: string;
    connecting: string;
    live: string;
  };
  stage: {
    assistant: string;
    pressStart: string;
    connecting: string;
  };
  chat: {
    title: string;
    description: string;
    empty: string;
    messageCount: (n: number) => string;
    composerPlaceholder: string;
    composerPlaceholderIdle: string;
    send: string;
  };
  controls: {
    start: string;
    connecting: string;
    end: string;
    mute: string;
    unmute: string;
    settings: string;
    microphone: string;
    microphoneDefault: string;
    microphonePermissionNeeded: string;
    showChat: string;
    hideChat: string;
    showCaptions: string;
    hideCaptions: string;
  };
  settings: {
    title: string;
    description: string;
    credentials: string;
    credentialsHint: string;
    appId: string;
    appIdPlaceholder: string;
    appCertificate: string;
    appCertificatePlaceholder: string;
    clearCredentials: string;
    credentialsRequired: string;
    systemPrompt: string;
    systemPromptHint: string;
    systemPromptPlaceholder: string;
    greeting: string;
    greetingHint: string;
    greetingPlaceholder: string;
    language: string;
    languageHint: string;
    voiceSpeed: string;
    voiceSpeedHint: string;
    voiceSpeedSlower: string;
    voiceSpeedFaster: string;
    mcp: string;
    mcpHint: string;
    mcpEnable: string;
    mcpServerUrl: string;
    mcpServerUrlPlaceholder: string;
    close: string;
    restoreDefaults: string;
    restoreDefaultsHint: string;
    restoreDefaultsConfirm: string;
  };
  errors: {
    rtmNotReady: string;
    sendFailed: string;
    startFailed: string;
  };
  systemPromptDefault: string;
  greetingDefault: string;
  fillerPhrases: string[];
};

const en: Dictionary = {
  app: {
    title: "Agora Conversational AI",
    subtitle: "Voice + Avatar live session"
  },
  status: {
    idle: "Idle",
    connecting: "Connecting",
    live: "Live"
  },
  stage: {
    assistant: "Assistant",
    pressStart: "Press Start to begin the call",
    connecting: "Connecting to agent..."
  },
  chat: {
    title: "Conversation",
    description: "Live transcript from the user and the assistant.",
    empty: "Transcript will appear here once you start the call.",
    messageCount: (n) => `${n} msgs`,
    composerPlaceholder: "Message the assistant...",
    composerPlaceholderIdle: "Start a call to chat",
    send: "Send message"
  },
  controls: {
    start: "Start call",
    connecting: "Connecting",
    end: "End call",
    mute: "Mute microphone",
    unmute: "Unmute microphone",
    settings: "Session settings",
    microphone: "Microphone",
    microphoneDefault: "System default",
    microphonePermissionNeeded: "Allow microphone access to see devices",
    showChat: "Show chat",
    hideChat: "Hide chat",
    showCaptions: "Show captions",
    hideCaptions: "Hide captions"
  },
  settings: {
    title: "Session settings",
    description: "Tune the assistant for the next call.",
    credentials: "Agora credentials",
    credentialsHint:
      "Bring your own Agora account. Values are stored only in this browser and sent per call to start the session. Get them at console.agora.io.",
    appId: "App ID",
    appIdPlaceholder: "Your Agora App ID",
    appCertificate: "App Certificate",
    appCertificatePlaceholder: "Your Agora App Certificate",
    clearCredentials: "Clear credentials",
    credentialsRequired: "Add your Agora App ID and Certificate in settings to start a call.",
    systemPrompt: "System prompt",
    systemPromptHint: "Applied on the next call. Restart the session to pick up changes.",
    systemPromptPlaceholder: "Define tone, language, persona, etc.",
    greeting: "Greeting",
    greetingHint: "The assistant speaks this line as soon as the call connects.",
    greetingPlaceholder: "e.g. Hi! I'm your assistant. How can I help today?",
    language: "Language",
    languageHint: "Controls the UI and the assistant's response language.",
    voiceSpeed: "Voice speed",
    voiceSpeedHint: "How fast the assistant speaks. 1.0 is normal.",
    voiceSpeedSlower: "Slower",
    voiceSpeedFaster: "Faster",
    mcp: "MCP tools",
    mcpHint: "Connect the assistant to an MCP server so it can call tools.",
    mcpEnable: "Enable MCP",
    mcpServerUrl: "MCP server URL",
    mcpServerUrlPlaceholder: "https://example.com/mcp/sse",
    close: "Close settings",
    restoreDefaults: "Restore defaults",
    restoreDefaultsHint: "Resets every field on this page to its original value.",
    restoreDefaultsConfirm: "Reset all settings to their defaults?"
  },
  errors: {
    rtmNotReady: "RTM messaging is not ready yet. Wait for the agent to become active.",
    sendFailed: "Could not send the message over RTM.",
    startFailed: "Failed to start session."
  },
  systemPromptDefault: [
    "You are a digital twin of Yan, Agora's developer relations representative in Brazil.",
    "You are speaking live to attendees of the Digital Tech Show hosted by IIMA at https://iimainfo.com.br/digital-tech-show/.",
    "Your mission is to showcase Agora's real-time engagement platform — with a strong focus on Conversational AI — and help visitors understand how they can build with it.",
    "This very conversation demonstrates Agora's Conversational AI Agent running with real-time TTS voice and a lifelike avatar; feel free to point that out when relevant.",
    "Cover Agora products when useful: Conversational AI Agent, Real-Time Voice and Video (RTC), Signaling (RTM), Cloud Recording, Interactive Live Streaming, and AI Noise Suppression.",
    "You have access to an MCP tool connected to the official Agora documentation. Use it whenever a question needs specific, up-to-date details — product capabilities, pricing tiers, quickstarts, SDK APIs, parameters, supported vendors, release notes, limits — anything you aren't 100% sure about. Prefer calling the tool over guessing.",
    "When you need to call the tool, briefly say you're looking it up (e.g. \"let me check the docs real quick\"), then answer once you have the result.",
    "SPOKEN OUTPUT RULES — these are strict, your words go straight to a text-to-speech engine:",
    "• Never output URLs, links, file paths, or email addresses. If a resource exists, describe it in words (e.g. say \"the Agora docs\" instead of a URL).",
    "• Never output code, JSON, XML, HTML, or command-line snippets. Describe what they do in plain language.",
    "• Never output markdown syntax: no asterisks (*), underscores (_), backticks (`), hashes (#), pipes (|), angle brackets (<>), square brackets ([]), curly braces ({}), or bullet dashes at the start of lines.",
    "• Never output raw punctuation runs or symbols like /, \\, =, +, ~, ^, &, %, $, @, or ellipsis characters beyond what natural speech needs.",
    "• Never spell out acronyms letter by letter unless asked. Say words naturally (e.g. \"RTC\" → \"R T C\" is fine when abbreviating product names, but avoid reading punctuation).",
    "• Numbers, versions, and identifiers: speak them naturally (e.g. \"version one point two\" not \"v1.2\"). Skip internal IDs, UUIDs, and hashes entirely.",
    "Personality: you are Yan — genuinely charming, warm, and playful, the kind of DevRel who makes every stranger feel like a friend. Be curious about the visitor, drop in a light joke here and there, and sprinkle in easy Brazilian warmth (\"great question!\", \"love that you asked\", \"honestly, my favorite part is...\"). Never fake or over-the-top — just genuinely interested and a little playful.",
    "Use the visitor's name once you learn it. Ask small follow-up questions to keep the conversation flowing (what they're building, what brought them to the show). Celebrate their ideas briefly before answering.",
    "Style: conversational, concise, upbeat. Keep replies short (1–3 sentences) since you are being spoken aloud. Use plain, natural spoken language — contractions, a little personality, never robotic.",
    "Stay on topic about Agora, real-time communication, AI voice agents, and how to get started. If the conversation drifts, steer it back with a friendly segue rather than a hard redirect.",
    "If even the docs tool can't answer, say so honestly, keep it light (\"that one's got me stumped!\"), and suggest the visitor catch Yan after the demo.",
    "Respond in English."
  ].join(" "),
  greetingDefault:
    "Hey there! I'm Yan's digital twin — powered by Agora's Conversational AI, real-time voice, and this avatar you're seeing live. So glad you stopped by the IIMA Digital Tech Show! What's on your mind — anything about Agora you're curious about?",
  fillerPhrases: [
    "One sec...",
    "Hmm, let me think...",
    "Give me a moment...",
    "Just a sec..."
  ]
};

const ptBR: Dictionary = {
  app: {
    title: "IA Conversacional Agora",
    subtitle: "Sessão ao vivo de voz + avatar"
  },
  status: {
    idle: "Inativo",
    connecting: "Conectando",
    live: "Ao vivo"
  },
  stage: {
    assistant: "Assistente",
    pressStart: "Pressione Iniciar para começar a chamada",
    connecting: "Conectando ao agente..."
  },
  chat: {
    title: "Conversa",
    description: "Transcrição ao vivo do usuário e do assistente.",
    empty: "A transcrição aparecerá aqui quando você iniciar a chamada.",
    messageCount: (n) => `${n} msgs`,
    composerPlaceholder: "Envie uma mensagem ao assistente...",
    composerPlaceholderIdle: "Inicie uma chamada para conversar",
    send: "Enviar mensagem"
  },
  controls: {
    start: "Iniciar chamada",
    connecting: "Conectando",
    end: "Encerrar chamada",
    mute: "Silenciar microfone",
    unmute: "Ativar microfone",
    settings: "Configurações da sessão",
    microphone: "Microfone",
    microphoneDefault: "Padrão do sistema",
    microphonePermissionNeeded: "Permita o acesso ao microfone para ver os dispositivos",
    showChat: "Mostrar chat",
    hideChat: "Ocultar chat",
    showCaptions: "Mostrar legendas",
    hideCaptions: "Ocultar legendas"
  },
  settings: {
    title: "Configurações da sessão",
    description: "Ajuste o assistente para a próxima chamada.",
    credentials: "Credenciais da Agora",
    credentialsHint:
      "Use sua própria conta Agora. Os valores ficam salvos apenas neste navegador e são enviados a cada chamada para iniciar a sessão. Pegue os seus em console.agora.io.",
    appId: "App ID",
    appIdPlaceholder: "Seu App ID da Agora",
    appCertificate: "App Certificate",
    appCertificatePlaceholder: "Seu App Certificate da Agora",
    clearCredentials: "Limpar credenciais",
    credentialsRequired:
      "Adicione o seu App ID e App Certificate da Agora nas configurações para iniciar uma chamada.",
    systemPrompt: "Prompt do sistema",
    systemPromptHint: "Aplicado na próxima chamada. Reinicie a sessão para aplicar as mudanças.",
    systemPromptPlaceholder: "Defina tom, idioma, persona etc.",
    greeting: "Saudação",
    greetingHint: "O assistente fala essa frase assim que a chamada conecta.",
    greetingPlaceholder: "ex.: Olá! Sou seu assistente. Como posso ajudar hoje?",
    language: "Idioma",
    languageHint: "Controla a interface e o idioma das respostas do assistente.",
    voiceSpeed: "Velocidade da voz",
    voiceSpeedHint: "O quão rápido o assistente fala. 1.0 é o normal.",
    voiceSpeedSlower: "Mais devagar",
    voiceSpeedFaster: "Mais rápido",
    mcp: "Ferramentas MCP",
    mcpHint: "Conecte o assistente a um servidor MCP para permitir chamadas de ferramentas.",
    mcpEnable: "Ativar MCP",
    mcpServerUrl: "URL do servidor MCP",
    mcpServerUrlPlaceholder: "https://exemplo.com/mcp/sse",
    close: "Fechar configurações",
    restoreDefaults: "Restaurar padrões",
    restoreDefaultsHint: "Redefine todos os campos desta página para o valor original.",
    restoreDefaultsConfirm: "Restaurar todas as configurações para os padrões?"
  },
  errors: {
    rtmNotReady:
      "O RTM ainda não está pronto. Aguarde o agente ficar ativo para enviar mensagens.",
    sendFailed: "Não foi possível enviar a mensagem pelo RTM.",
    startFailed: "Falha ao iniciar a sessão."
  },
  systemPromptDefault: [
    "Você é o gêmeo digital do Yan, representante de Developer Relations da Agora no Brasil.",
    "Você está falando ao vivo com visitantes do Digital Tech Show realizado pela IIMA em https://iimainfo.com.br/digital-tech-show/.",
    "Sua missão é apresentar a plataforma de engajamento em tempo real da Agora — com foco especial em IA Conversacional — e ajudar os visitantes a entender como podem construir com ela.",
    "Esta conversa em si é uma demonstração do Conversational AI Agent da Agora rodando com TTS em tempo real e um avatar realista; sinta-se à vontade para mencionar isso quando for relevante.",
    "Fale sobre os produtos da Agora quando fizer sentido: Conversational AI Agent, Voz e Vídeo em Tempo Real (RTC), Signaling (RTM), Cloud Recording, Interactive Live Streaming e AI Noise Suppression.",
    "Você tem acesso a uma ferramenta MCP conectada à documentação oficial da Agora. Use-a sempre que a pergunta exigir detalhes específicos e atualizados — recursos de produtos, planos e preços, quickstarts, APIs dos SDKs, parâmetros, fornecedores suportados, release notes, limites — qualquer coisa sobre a qual você não tenha 100% de certeza. Prefira chamar a ferramenta em vez de adivinhar.",
    "Quando precisar chamar a ferramenta, diga brevemente que vai consultar (por exemplo, \"deixa eu dar uma olhada rápida na documentação\") e responda assim que tiver o resultado.",
    "REGRAS DE SAÍDA FALADA — são estritas; suas palavras vão direto para um mecanismo de text-to-speech:",
    "• Nunca diga URLs, links, caminhos de arquivo ou e-mails. Se um recurso existir, descreva-o em palavras (por exemplo, diga \"a documentação da Agora\" em vez de uma URL).",
    "• Nunca diga código, JSON, XML, HTML ou comandos de terminal. Descreva o que fazem em linguagem natural.",
    "• Nunca use sintaxe markdown: sem asteriscos (*), sublinhados (_), crases (`), cerquilhas (#), pipes (|), sinais de maior/menor (<>), colchetes ([]), chaves ({}) ou traços iniciais de listas.",
    "• Nunca produza sequências de pontuação ou símbolos como /, \\, =, +, ~, ^, &, %, $, @, nem reticências além do que a fala natural precisa.",
    "• Números, versões e identificadores: fale de forma natural (por exemplo, \"versão um ponto dois\" em vez de \"v1.2\"). Ignore IDs internos, UUIDs e hashes.",
    "Personalidade: você é o Yan — genuinamente carismático, caloroso e brincalhão, aquele DevRel que faz qualquer desconhecido se sentir amigo em segundos. Seja curioso sobre o visitante, solte uma piadinha leve de vez em quando e tempere tudo com aquele jeitinho brasileiro acolhedor (\"que pergunta boa!\", \"adorei que você perguntou isso\", \"olha, minha parte favorita é...\"). Nunca forçado nem exagerado — apenas genuinamente interessado e um pouquinho brincalhão.",
    "Use o nome do visitante assim que ele se apresentar. Faça pequenas perguntas de acompanhamento pra manter a conversa fluindo (o que ele está construindo, o que o trouxe até o evento). Celebre brevemente as ideias dele antes de responder.",
    "Estilo: conversacional, conciso, animado. Mantenha as respostas curtas (1 a 3 frases), já que você está sendo falado em voz alta. Linguagem natural de fala — com contrações, personalidade leve, nunca robótico.",
    "Permaneça no tema sobre Agora, comunicação em tempo real, agentes de IA por voz e como começar. Se a conversa desviar, traga de volta com uma ponte amigável em vez de cortar o assunto.",
    "Se nem a ferramenta de documentação souber responder, diga isso com honestidade, leve na brincadeira (\"essa aí me pegou!\") e sugira que o visitante fale com o Yan depois da demo.",
    "Responda em português do Brasil."
  ].join(" "),
  greetingDefault:
    "Oi, tudo bem? Sou o gêmeo digital do Yan — criado com a IA Conversacional da Agora, com voz em tempo real e esse avatar que você está vendo aqui ao vivo. Que bom que você passou no Digital Tech Show da IIMA! Me conta — o que você tá curioso pra saber sobre a Agora?",
  fillerPhrases: [
    "Só um segundo...",
    "Hmm, deixa eu pensar...",
    "Um instante...",
    "Só um momento..."
  ]
};

const esMX: Dictionary = {
  app: {
    title: "IA Conversacional Agora",
    subtitle: "Sesión en vivo de voz + avatar"
  },
  status: {
    idle: "Inactivo",
    connecting: "Conectando",
    live: "En vivo"
  },
  stage: {
    assistant: "Asistente",
    pressStart: "Presiona Iniciar para comenzar la llamada",
    connecting: "Conectando con el agente..."
  },
  chat: {
    title: "Conversación",
    description: "Transcripción en vivo del usuario y del asistente.",
    empty: "La transcripción aparecerá aquí cuando inicies la llamada.",
    messageCount: (n) => `${n} msjs`,
    composerPlaceholder: "Envía un mensaje al asistente...",
    composerPlaceholderIdle: "Inicia una llamada para chatear",
    send: "Enviar mensaje"
  },
  controls: {
    start: "Iniciar llamada",
    connecting: "Conectando",
    end: "Finalizar llamada",
    mute: "Silenciar micrófono",
    unmute: "Activar micrófono",
    settings: "Ajustes de la sesión",
    microphone: "Micrófono",
    microphoneDefault: "Predeterminado del sistema",
    microphonePermissionNeeded: "Da acceso al micrófono para ver los dispositivos",
    showChat: "Mostrar chat",
    hideChat: "Ocultar chat",
    showCaptions: "Mostrar subtítulos",
    hideCaptions: "Ocultar subtítulos"
  },
  settings: {
    title: "Ajustes de la sesión",
    description: "Ajusta el asistente para la próxima llamada.",
    credentials: "Credenciales de Agora",
    credentialsHint:
      "Usa tu propia cuenta de Agora. Los valores se guardan solo en este navegador y se envían en cada llamada para iniciar la sesión. Obtén los tuyos en console.agora.io.",
    appId: "App ID",
    appIdPlaceholder: "Tu App ID de Agora",
    appCertificate: "App Certificate",
    appCertificatePlaceholder: "Tu App Certificate de Agora",
    clearCredentials: "Borrar credenciales",
    credentialsRequired:
      "Agrega tu App ID y App Certificate de Agora en los ajustes para iniciar una llamada.",
    systemPrompt: "Prompt del sistema",
    systemPromptHint:
      "Se aplica en la próxima llamada. Reinicia la sesión para tomar los cambios.",
    systemPromptPlaceholder: "Define tono, idioma, personalidad, etc.",
    greeting: "Saludo",
    greetingHint: "El asistente dice esta frase en cuanto se conecta la llamada.",
    greetingPlaceholder: "ej.: ¡Hola! Soy tu asistente. ¿En qué te puedo ayudar?",
    language: "Idioma",
    languageHint: "Controla la interfaz y el idioma de las respuestas del asistente.",
    voiceSpeed: "Velocidad de la voz",
    voiceSpeedHint: "Qué tan rápido habla el asistente. 1.0 es lo normal.",
    voiceSpeedSlower: "Más lento",
    voiceSpeedFaster: "Más rápido",
    mcp: "Herramientas MCP",
    mcpHint: "Conecta el asistente a un servidor MCP para que pueda llamar herramientas.",
    mcpEnable: "Activar MCP",
    mcpServerUrl: "URL del servidor MCP",
    mcpServerUrlPlaceholder: "https://ejemplo.com/mcp/sse",
    close: "Cerrar ajustes",
    restoreDefaults: "Restaurar valores predeterminados",
    restoreDefaultsHint:
      "Restablece todos los campos de esta página a su valor original.",
    restoreDefaultsConfirm: "¿Restablecer todos los ajustes a los valores predeterminados?"
  },
  errors: {
    rtmNotReady:
      "El RTM aún no está listo. Espera a que el agente se active para mandar mensajes.",
    sendFailed: "No se pudo enviar el mensaje por RTM.",
    startFailed: "No se pudo iniciar la sesión."
  },
  systemPromptDefault: [
    "Eres el gemelo digital de Yan, representante de Developer Relations de Agora en Brasil.",
    "Estás hablando en vivo con visitantes del Digital Tech Show organizado por IIMA en https://iimainfo.com.br/digital-tech-show/.",
    "Tu misión es mostrar la plataforma de engagement en tiempo real de Agora — con foco especial en IA Conversacional — y ayudar a los visitantes a entender cómo pueden construir con ella.",
    "Esta misma conversación es una demo del Conversational AI Agent de Agora corriendo con TTS en tiempo real y un avatar realista; siéntete libre de mencionarlo cuando venga al caso.",
    "Habla de los productos de Agora cuando sea útil: Conversational AI Agent, Voz y Video en Tiempo Real (RTC), Signaling (RTM), Cloud Recording, Interactive Live Streaming y AI Noise Suppression.",
    "Tienes acceso a una herramienta MCP conectada a la documentación oficial de Agora. Úsala siempre que la pregunta requiera detalles específicos y actualizados — capacidades de producto, planes y precios, quickstarts, APIs de los SDK, parámetros, proveedores soportados, release notes, límites — cualquier cosa de la que no estés 100% seguro. Prefiere llamar a la herramienta antes que adivinar.",
    "Cuando necesites llamar a la herramienta, di brevemente que vas a consultar (por ejemplo, \"déjame revisar rápido la documentación\") y responde cuando tengas el resultado.",
    "REGLAS DE SALIDA HABLADA — son estrictas; tus palabras van directo a un motor de text-to-speech:",
    "• Nunca digas URLs, ligas, rutas de archivos ni correos. Si existe un recurso, descríbelo con palabras (por ejemplo, di \"la documentación de Agora\" en lugar de una URL).",
    "• Nunca digas código, JSON, XML, HTML ni comandos de terminal. Explica en lenguaje natural qué hacen.",
    "• Nunca uses sintaxis markdown: sin asteriscos (*), guiones bajos (_), comillas invertidas (`), numerales (#), pipes (|), signos de mayor/menor (<>), corchetes ([]), llaves ({}) ni guiones iniciales de listas.",
    "• Nunca produzcas cadenas de puntuación ni símbolos como /, \\, =, +, ~, ^, &, %, $, @, ni puntos suspensivos más allá de lo que pida el habla natural.",
    "• Números, versiones e identificadores: dilos de forma natural (por ejemplo, \"versión uno punto dos\" en lugar de \"v1.2\"). Omite IDs internos, UUIDs y hashes.",
    "Personalidad: eres Yan — genuinamente carismático, cálido y platicador, ese DevRel que hace que cualquier desconocido se sienta en confianza en dos minutos. Sé curioso con el visitante, suelta alguna broma ligera de vez en cuando y mantén un tono relajado y cercano (\"¡qué buena pregunta!\", \"me encanta que me preguntes eso\", \"mira, mi parte favorita es...\"). Nunca forzado ni exagerado — sinceramente interesado y con buena vibra.",
    "Usa el nombre del visitante en cuanto lo sepas. Haz pequeñas preguntas de seguimiento para que la plática fluya (qué está construyendo, qué lo trajo al evento). Celebra brevemente sus ideas antes de responder.",
    "Estilo: conversacional, conciso, con buena vibra. Mantén las respuestas cortas (1 a 3 oraciones), ya que se dirán en voz alta. Lenguaje natural hablado — con contracciones, con personalidad, nunca robótico.",
    "Mantente en el tema de Agora, comunicación en tiempo real, agentes de IA por voz y cómo empezar. Si la plática se desvía, regrésala con un puente amable, no con un corte seco.",
    "Si ni la herramienta de documentación puede responder, dilo con honestidad, tómalo con ligereza (\"¡esa me dejó pensando!\") y sugiere al visitante que platique con Yan después de la demo.",
    "Responde en español de México, usando \"tú\" (por ejemplo: \"¿qué quieres saber?\", \"cuéntame\", \"tienes\"). Evita el \"vos\"."
  ].join(" "),
  greetingDefault:
    "¡Hola, qué tal! Soy el gemelo digital de Yan — corriendo sobre la IA Conversacional de Agora, con voz en tiempo real y este avatar que estás viendo en vivo. ¡Qué padre que pasaste por el Digital Tech Show de IIMA! Cuéntame, ¿qué te gustaría saber sobre Agora?",
  fillerPhrases: [
    "Dame un segundo...",
    "Mmm, déjame pensar...",
    "Un momentito...",
    "Espera tantito..."
  ]
};

const DICTIONARIES: Record<Locale, Dictionary> = {
  en,
  "pt-BR": ptBR,
  "es-MX": esMX
};

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dictionary;
  localeMeta: LocaleMeta;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "yan.locale";

function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "pt-BR" || stored === "es-MX") return stored;
  const nav = (window.navigator?.language ?? "").toLowerCase();
  if (nav.startsWith("pt")) return "pt-BR";
  if (nav.startsWith("es")) return "es-MX";
  return "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    setLocaleState(detectInitialLocale());
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage errors (private mode, etc.)
    }
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const localeMeta =
      LOCALES.find((candidate) => candidate.code === locale) ?? LOCALES[0];
    return {
      locale,
      setLocale,
      t: DICTIONARIES[locale],
      localeMeta
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}
