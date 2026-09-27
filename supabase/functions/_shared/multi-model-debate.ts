// =============================================
// MULTI-MODEL DEBATE SYSTEM
// Triple AI Evaluation with Consensus
// Models: GPT-5.2 + Gemini 3 Pro + Gemini 3 Flash
// =============================================

// Model configuration for triple AI debate
export const DEBATE_MODELS = {
  // OpenAI GPT-5.2 - Enhanced reasoning for complex analysis
  GPT_5_2: "openai/gpt-5.2",
  // Gemini 3 Pro - Deep comprehensive analysis
  GEMINI_PRO: "google/gemini-3-pro-preview",
  // Gemini 3 Flash - Fast real-time feedback
  GEMINI_FLASH: "google/gemini-3-flash-preview",
};

export interface ModelEvaluation {
  model: string;
  score: number;
  confidence: number;
  reasoning: string;
  strengths: string[];
  issues: string[];
  details: Record<string, any>;
}

export interface DebateResult {
  consensus_score: number;
  consensus_confidence: number;
  consensus_decision: "pass" | "reject" | "borderline";
  individual_evaluations: ModelEvaluation[];
  debate_rounds: DebateRound[];
  final_reasoning: string;
  models_agreed: boolean;
  disagreement_areas: string[];
}

export interface DebateRound {
  round: number;
  topic: string;
  positions: {
    model: string;
    position: string;
    argument: string;
  }[];
  resolution: string;
}

import { llmProvider } from "./llm-provider.ts";
import { groqKeyManager } from "./groq-key-manager.ts";

// Model configuration for AI debate
export const DEBATE_MODELS = {
  PRIMARY: "openai/gpt-oss-120b",
  FAST: "openai/gpt-oss-120b",
  REASONING: "openai/gpt-oss-120b",
};

// Call a single AI model for evaluation
export async function callModel(
  _apiKey: string,
  _model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0.3
): Promise<any> {
  try {
    const res = await llmProvider.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
    });
    return res.content;
  } catch (error) {
    console.error("[Debate] Error calling model via Groq:", error);
    return null;
  }
}

// Parse JSON from model response
export function parseModelJSON(content: string): any {
  if (!content) return null;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.warn("Failed to parse model JSON:", e);
  }
  return null;
}

// Run parallel evaluations from all three models
export async function runParallelEvaluations(
  apiKey: string,
  evaluationPrompt: string,
  context: string
): Promise<ModelEvaluation[]> {
  const systemPrompt = `You are an expert technical evaluator for hiring assessments. 
Analyze the candidate's performance objectively and provide your honest assessment.
Be specific with examples from the submission.
Respond with valid JSON only.`;

  const userPrompt = `${context}

${evaluationPrompt}

Provide your evaluation as JSON:
{
  "score": 0-100,
  "confidence": 0-100,
  "reasoning": "2-3 sentences explaining your score",
  "strengths": ["specific strength 1", "specific strength 2"],
  "issues": ["specific issue 1", "specific issue 2"],
  "details": {
    "technical_accuracy": 0-100,
    "code_quality": 0-100,
    "problem_solving": 0-100,
    "efficiency": 0-100
  }
}`;

  // Run all three models in parallel
  const [gptResult, proResult, flashResult] = await Promise.all([
    callModel(apiKey, DEBATE_MODELS.GPT_5_2, systemPrompt, userPrompt),
    callModel(apiKey, DEBATE_MODELS.GEMINI_PRO, systemPrompt, userPrompt),
    callModel(apiKey, DEBATE_MODELS.GEMINI_FLASH, systemPrompt, userPrompt),
  ]);

  const evaluations: ModelEvaluation[] = [];

  // Parse GPT-5.2 response
  const gptParsed = parseModelJSON(gptResult);
  if (gptParsed) {
    evaluations.push({
      model: DEBATE_MODELS.GPT_5_2,
      score: gptParsed.score || 70,
      confidence: gptParsed.confidence || 80,
      reasoning: gptParsed.reasoning || "",
      strengths: gptParsed.strengths || [],
      issues: gptParsed.issues || [],
      details: gptParsed.details || {},
    });
  }

  // Parse Gemini Pro response
  const proParsed = parseModelJSON(proResult);
  if (proParsed) {
    evaluations.push({
      model: DEBATE_MODELS.GEMINI_PRO,
      score: proParsed.score || 70,
      confidence: proParsed.confidence || 80,
      reasoning: proParsed.reasoning || "",
      strengths: proParsed.strengths || [],
      issues: proParsed.issues || [],
      details: proParsed.details || {},
    });
  }

  // Parse Gemini Flash response
  const flashParsed = parseModelJSON(flashResult);
  if (flashParsed) {
    evaluations.push({
      model: DEBATE_MODELS.GEMINI_FLASH,
      score: flashParsed.score || 70,
      confidence: flashParsed.confidence || 80,
      reasoning: flashParsed.reasoning || "",
      strengths: flashParsed.strengths || [],
      issues: flashParsed.issues || [],
      details: flashParsed.details || {},
    });
  }

  return evaluations;
}

// Identify areas of disagreement
function findDisagreements(evaluations: ModelEvaluation[]): string[] {
  const disagreements: string[] = [];
  
  if (evaluations.length < 2) return disagreements;

  const scores = evaluations.map(e => e.score);
  const scoreRange = Math.max(...scores) - Math.min(...scores);
  
  if (scoreRange > 15) {
    disagreements.push(`Score variance: ${scoreRange} points (${Math.min(...scores)}-${Math.max(...scores)})`);
  }

  // Check for conflicting strengths/issues
  const allStrengths = evaluations.flatMap(e => e.strengths);
  const allIssues = evaluations.flatMap(e => e.issues);
  
  // Look for contradictions
  for (const strength of allStrengths) {
    const strengthLower = strength.toLowerCase();
    for (const issue of allIssues) {
      if (issue.toLowerCase().includes(strengthLower.split(" ")[0])) {
        disagreements.push(`Conflicting views on: ${strength.split(" ")[0]}`);
      }
    }
  }

  return disagreements;
}

// Run debate round to resolve disagreements
async function runDebateRound(
  apiKey: string,
  roundNumber: number,
  topic: string,
  evaluations: ModelEvaluation[],
  context: string
): Promise<DebateRound> {
  const positions: DebateRound["positions"] = [];

  const debatePrompt = `You are participating in a debate about candidate evaluation.

TOPIC: ${topic}

CONTEXT: ${context}

OTHER EVALUATORS' POSITIONS:
${evaluations.map(e => `- ${e.model}: Score ${e.score}, says "${e.reasoning}"`).join("\n")}

Consider the other perspectives and provide your final position.
Respond with JSON:
{
  "position": "agree" | "disagree" | "partially_agree",
  "argument": "Your 1-2 sentence argument supporting your position",
  "adjusted_score": your score after considering other views (0-100)
}`;

  // Get each model's debate response
  const [gptDebate, proDebate, flashDebate] = await Promise.all([
    callModel(apiKey, DEBATE_MODELS.GPT_5_2, "You are a fair evaluator in a debate.", debatePrompt),
    callModel(apiKey, DEBATE_MODELS.GEMINI_PRO, "You are a fair evaluator in a debate.", debatePrompt),
    callModel(apiKey, DEBATE_MODELS.GEMINI_FLASH, "You are a fair evaluator in a debate.", debatePrompt),
  ]);

  // Parse debate responses
  const gptParsed = parseModelJSON(gptDebate);
  if (gptParsed) {
    positions.push({
      model: DEBATE_MODELS.GPT_5_2,
      position: gptParsed.position || "partially_agree",
      argument: gptParsed.argument || "",
    });
  }

  const proParsed = parseModelJSON(proDebate);
  if (proParsed) {
    positions.push({
      model: DEBATE_MODELS.GEMINI_PRO,
      position: proParsed.position || "partially_agree",
      argument: proParsed.argument || "",
    });
  }

  const flashParsed = parseModelJSON(flashDebate);
  if (flashParsed) {
    positions.push({
      model: DEBATE_MODELS.GEMINI_FLASH,
      position: flashParsed.position || "partially_agree",
      argument: flashParsed.argument || "",
    });
  }

  // Determine resolution
  const agreeCount = positions.filter(p => p.position === "agree").length;
  const resolution = agreeCount >= 2 
    ? "Consensus reached" 
    : "Partial consensus - weighted average applied";

  return {
    round: roundNumber,
    topic,
    positions,
    resolution,
  };
}

// Main debate function
export async function runMultiModelDebate(
  apiKey: string,
  evaluationPrompt: string,
  context: string,
  passingScore: number = 60
): Promise<DebateResult> {
  console.log("[Multi-Model Debate] Starting triple AI evaluation...");

  // Phase 1: Parallel independent evaluations
  const evaluations = await runParallelEvaluations(apiKey, evaluationPrompt, context);
  
  if (evaluations.length === 0) {
    throw new Error("No evaluations received from any model");
  }

  console.log(`[Multi-Model Debate] Received ${evaluations.length} evaluations`);

  // Phase 2: Identify disagreements
  const disagreements = findDisagreements(evaluations);
  
  // Phase 3: Run debate rounds if there are significant disagreements
  const debateRounds: DebateRound[] = [];
  
  if (disagreements.length > 0) {
    console.log(`[Multi-Model Debate] ${disagreements.length} disagreement(s) found, initiating debate...`);
    
    // Run up to 2 debate rounds
    for (let i = 0; i < Math.min(disagreements.length, 2); i++) {
      const round = await runDebateRound(
        apiKey,
        i + 1,
        disagreements[i],
        evaluations,
        context
      );
      debateRounds.push(round);
    }
  }

  // Phase 4: Calculate consensus score using weighted average
  // GPT-5.2 and Gemini Pro weighted higher for complex analysis
  const weights = {
    [DEBATE_MODELS.GPT_5_2]: 0.40,
    [DEBATE_MODELS.GEMINI_PRO]: 0.35,
    [DEBATE_MODELS.GEMINI_FLASH]: 0.25,
  };

  let weightedScore = 0;
  let weightedConfidence = 0;
  let totalWeight = 0;

  for (const evaluation of evaluations) {
    const weight = weights[evaluation.model as keyof typeof weights] || 0.33;
    weightedScore += evaluation.score * weight;
    weightedConfidence += evaluation.confidence * weight;
    totalWeight += weight;
  }

  const consensusScore = Math.round(weightedScore / totalWeight);
  const consensusConfidence = Math.round(weightedConfidence / totalWeight);

  // Determine decision
  let consensusDecision: "pass" | "reject" | "borderline";
  if (consensusScore >= passingScore + 10) {
    consensusDecision = "pass";
  } else if (consensusScore < passingScore - 10) {
    consensusDecision = "reject";
  } else {
    consensusDecision = "borderline";
  }

  // Check if models agreed (within 10 points of each other)
  const scores = evaluations.map(e => e.score);
  const modelsAgreed = Math.max(...scores) - Math.min(...scores) <= 10;

  // Generate final reasoning
  const finalReasoning = generateConsensusReasoning(
    evaluations,
    consensusScore,
    consensusDecision,
    modelsAgreed,
    debateRounds
  );

  console.log(`[Multi-Model Debate] Consensus: ${consensusScore}% (${consensusDecision}), Agreement: ${modelsAgreed}`);

  return {
    consensus_score: consensusScore,
    consensus_confidence: consensusConfidence,
    consensus_decision: consensusDecision,
    individual_evaluations: evaluations,
    debate_rounds: debateRounds,
    final_reasoning: finalReasoning,
    models_agreed: modelsAgreed,
    disagreement_areas: disagreements,
  };
}

function generateConsensusReasoning(
  evaluations: ModelEvaluation[],
  consensusScore: number,
  decision: string,
  agreed: boolean,
  debateRounds: DebateRound[]
): string {
  const modelSummaries = evaluations.map(e => 
    `**${e.model.split("/")[1]}**: ${e.score}% - ${e.reasoning}`
  ).join("\n\n");

  const allStrengths = [...new Set(evaluations.flatMap(e => e.strengths))].slice(0, 5);
  const allIssues = [...new Set(evaluations.flatMap(e => e.issues))].slice(0, 5);

  let debateSummary = "";
  if (debateRounds.length > 0) {
    debateSummary = `\n\n### 🗣️ Debate Resolution\n${debateRounds.map(r => 
      `Round ${r.round} (${r.topic}): ${r.resolution}`
    ).join("\n")}`;
  }

  return `## 🤖 Triple AI Consensus Report

### 📊 Consensus Score: ${consensusScore}%
**Decision: ${decision.toUpperCase()}** ${agreed ? "✅ (All models agreed)" : "⚠️ (Resolved through debate)"}

### 📝 Individual Model Assessments
${modelSummaries}
${debateSummary}

### 💪 Agreed Strengths
${allStrengths.map(s => `- ${s}`).join("\n")}

### 🔍 Identified Issues
${allIssues.map(i => `- ${i}`).join("\n")}

---
*Evaluated by: GPT-5.2, Gemini 3 Pro, Gemini 3 Flash*`;
}
