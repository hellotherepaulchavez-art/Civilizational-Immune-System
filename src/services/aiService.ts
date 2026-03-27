import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface EcoScore {
  point: number;
  title: string;
  evidence: string;
  isIdentified: boolean;
}

export interface EcoAnalysisResponse {
  overallThreshold: "Yellow" | "Orange" | "Red" | "None";
  totalWeightedScore: number;
  confidence: number;
  scores: EcoScore[];
  summary: string;
  backend: "Gemini" | "Anthropic";
}

const ECO_POINTS = [
  "Cult of tradition",
  "Rejection of modernism",
  "Cult of action for action's sake",
  "Disagreement is treason",
  "Fear of difference",
  "Appeal to social frustration",
  "Obsession with a plot",
  "The enemy is both strong and weak",
  "Pacifism is trafficking with the enemy",
  "Contempt for the weak",
  "Everybody is educated to become a hero",
  "Machismo and weaponry",
  "Selective populism",
  "Enforced Action (State force/violence)"
];

export async function analyzeEcoClustering(text: string, backend: "Gemini" | "Anthropic" = "Gemini"): Promise<EcoAnalysisResponse> {
  let rawData: any;

  if (backend === "Gemini") {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze the following text against the CIS Eco Clustering framework (based on Umberto Eco's points + Enforced Action). 
      Identify which of the 14 points are present in the text. For each point, provide a boolean 'isIdentified' and specific 'evidence' from the text.
      
      Points to check:
      ${ECO_POINTS.map((p, i) => `${i + 1}. ${p}`).join("\n")}

      Text to analyze:
      ${text}
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            confidence: { type: Type.NUMBER },
            summary: { type: Type.STRING },
            identifiedPoints: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  point: { type: Type.NUMBER },
                  title: { type: Type.STRING },
                  isIdentified: { type: Type.BOOLEAN },
                  evidence: { type: Type.STRING }
                },
                required: ["point", "title", "isIdentified", "evidence"]
              }
            }
          },
          required: ["confidence", "identifiedPoints", "summary"]
        }
      }
    });
    rawData = JSON.parse(response.text || "{}");
  } else {
    // Anthropic via Server Proxy
    const systemInstruction = `Analyze the following text against the CIS Eco Clustering framework (based on Umberto Eco's points + Enforced Action). 
    Identify which of the 14 points are present in the text. For each point, provide a boolean 'isIdentified' and specific 'evidence' from the text.
    
    Points to check:
    ${ECO_POINTS.map((p, i) => `${i + 1}. ${p}`).join("\n")}

    Return the result as a JSON object with the following structure:
    {
      "confidence": number,
      "summary": string,
      "identifiedPoints": [
        {
          "point": number,
          "title": string,
          "isIdentified": boolean,
          "evidence": string
        }
      ]
    }
    `;

    const response = await fetch("/api/anthropic/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: text, systemInstruction }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Anthropic analysis failed.");
    }

    const data = await response.json();
    rawData = JSON.parse(data.text || "{}");
  }
  
  // Apply PRD Weighted Binary Count Logic
  let totalWeightedScore = 0;
  const scores: EcoScore[] = rawData.identifiedPoints.map((p: any) => {
    if (p.isIdentified) {
      // Point 14 (Enforced Action) has a 1.5x weight
      const weight = p.point === 14 ? 1.5 : 1.0;
      totalWeightedScore += weight;
    }
    return {
      point: p.point,
      title: p.title,
      evidence: p.evidence,
      isIdentified: p.isIdentified
    };
  });

  // Determine Threshold
  let overallThreshold: "Yellow" | "Orange" | "Red" | "None" = "None";
  if (totalWeightedScore >= 9) overallThreshold = "Red";
  else if (totalWeightedScore >= 6) overallThreshold = "Orange";
  else if (totalWeightedScore >= 3) overallThreshold = "Yellow";

  return {
    overallThreshold,
    totalWeightedScore,
    confidence: rawData.confidence,
    scores,
    summary: rawData.summary,
    backend
  };
}
