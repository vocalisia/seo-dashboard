import { z } from "zod";

export type PromptLanguage = "fr" | "en" | "de" | "es" | "it";
export type PromptIntent = "info" | "transac" | "comm" | "nav";

export interface GeneratedPrompt {
  prompt: string;
  intent: PromptIntent;
  reasoning: string;
}

const PromptSchema = z.object({
  prompt: z.string().trim().min(8).max(500),
  intent: z.enum(["info", "transac", "comm", "nav"]),
  reasoning: z.string().trim().max(500),
}).strict();

const PromptListSchema = z.array(PromptSchema).length(30);

const LANGUAGE: Record<PromptLanguage, {
  contexts: string[];
  templates: Array<{ intent: PromptIntent; text: string }>;
  reasoning: Record<PromptIntent, string>;
}> = {
  fr: {
    contexts: ["pour une PME", "en Suisse", "pour débuter", "pour une équipe experte", "avec des contraintes réglementaires", "pour un projet à long terme"],
    templates: [
      { intent: "info", text: "Comment fonctionne {topic} {context} ?" },
      { intent: "info", text: "Quels problèmes {topic} permet-il de résoudre {context} ?" },
      { intent: "comm", text: "Quelles sont les meilleures approches de {topic} {context} ?" },
      { intent: "transac", text: "Comment choisir une solution de {topic} {context} ?" },
      { intent: "nav", text: "Quelles marques ou ressources fiables consulter sur {topic} {context} ?" },
    ],
    reasoning: { info: "Répond à une recherche de compréhension.", comm: "Compare les options avant décision.", transac: "Prépare un choix concret.", nav: "Recherche des acteurs ou ressources identifiables." },
  },
  en: {
    contexts: ["for a small business", "in Switzerland", "for beginners", "for an expert team", "with regulatory constraints", "for a long-term project"],
    templates: [
      { intent: "info", text: "How does {topic} work {context}?" },
      { intent: "info", text: "Which problems can {topic} solve {context}?" },
      { intent: "comm", text: "What are the best approaches to {topic} {context}?" },
      { intent: "transac", text: "How should I choose a {topic} solution {context}?" },
      { intent: "nav", text: "Which trusted brands or resources cover {topic} {context}?" },
    ],
    reasoning: { info: "Targets understanding intent.", comm: "Compares options before a decision.", transac: "Supports a concrete choice.", nav: "Looks for identifiable providers or resources." },
  },
  de: {
    contexts: ["für ein KMU", "in der Schweiz", "für Einsteiger", "für ein Expertenteam", "mit regulatorischen Anforderungen", "für ein langfristiges Projekt"],
    templates: [
      { intent: "info", text: "Wie funktioniert {topic} {context}?" },
      { intent: "info", text: "Welche Probleme löst {topic} {context}?" },
      { intent: "comm", text: "Was sind die besten Ansätze für {topic} {context}?" },
      { intent: "transac", text: "Wie wählt man eine Lösung für {topic} {context}?" },
      { intent: "nav", text: "Welche vertrauenswürdigen Marken oder Quellen gibt es zu {topic} {context}?" },
    ],
    reasoning: { info: "Deckt Informationsbedarf ab.", comm: "Vergleicht Optionen vor einer Entscheidung.", transac: "Unterstützt eine konkrete Auswahl.", nav: "Sucht erkennbare Anbieter oder Quellen." },
  },
  es: {
    contexts: ["para una pyme", "en Suiza", "para principiantes", "para un equipo experto", "con requisitos regulatorios", "para un proyecto a largo plazo"],
    templates: [
      { intent: "info", text: "¿Cómo funciona {topic} {context}?" },
      { intent: "info", text: "¿Qué problemas resuelve {topic} {context}?" },
      { intent: "comm", text: "¿Cuáles son los mejores enfoques de {topic} {context}?" },
      { intent: "transac", text: "¿Cómo elegir una solución de {topic} {context}?" },
      { intent: "nav", text: "¿Qué marcas o recursos fiables consultar sobre {topic} {context}?" },
    ],
    reasoning: { info: "Responde a una intención informativa.", comm: "Compara opciones antes de decidir.", transac: "Prepara una elección concreta.", nav: "Busca proveedores o recursos identificables." },
  },
  it: {
    contexts: ["per una PMI", "in Svizzera", "per principianti", "per un team esperto", "con vincoli normativi", "per un progetto a lungo termine"],
    templates: [
      { intent: "info", text: "Come funziona {topic} {context}?" },
      { intent: "info", text: "Quali problemi risolve {topic} {context}?" },
      { intent: "comm", text: "Quali sono i migliori approcci a {topic} {context}?" },
      { intent: "transac", text: "Come scegliere una soluzione di {topic} {context}?" },
      { intent: "nav", text: "Quali marchi o risorse affidabili consultare su {topic} {context}?" },
    ],
    reasoning: { info: "Risponde a un intento informativo.", comm: "Confronta le opzioni prima della decisione.", transac: "Prepara una scelta concreta.", nav: "Cerca fornitori o risorse identificabili." },
  },
};

export function buildLocalAIPrompts(topic: string, language: PromptLanguage): GeneratedPrompt[] {
  const cleanTopic = topic.trim().replace(/\s+/g, " ");
  const config = LANGUAGE[language];
  return config.contexts.flatMap((context) => config.templates.map((template) => ({
    prompt: template.text.replaceAll("{topic}", cleanTopic).replaceAll("{context}", context),
    intent: template.intent,
    reasoning: config.reasoning[template.intent],
  })));
}

export function parseGeneratedAIPrompts(text: string): GeneratedPrompt[] | null {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = PromptListSchema.safeParse(JSON.parse(cleaned));
    if (!parsed.success) return null;
    const unique = new Set(parsed.data.map((item) => item.prompt.toLocaleLowerCase()));
    return unique.size === 30 ? parsed.data : null;
  } catch {
    return null;
  }
}
