import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { llmProvider } from "../_shared/llm-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GitHubRepo {
  name: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  description: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  topics: string[];
}

interface GitHubUser {
  public_repos: number;
  followers: number;
  following: number;
  bio: string | null;
  company: string | null;
  location: string | null;
  created_at: string;
  name: string | null;
  email: string | null;
  blog: string | null;
}

interface ProfileAnalysis {
  github_score: number;
  linkedin_score: number;
  profile_score: number;
  skills: string[];
  github_analysis: {
    repos_count: number;
    total_stars: number;
    total_forks: number;
    top_languages: string[];
    followers: number;
    account_age_years: number;
    activity_level: string;
    top_repos: Array<{
      name: string;
      description: string | null;
      stars: number;
      language: string | null;
      url: string;
    }>;
    recent_activity: string;
    contribution_score: number;
  } | null;
  linkedin_analysis: {
    profile_strength: string;
    estimated_experience: string;
    profile_url: string;
  } | null;
  suggested_job_preferences: {
    fields: string[];
    experience_level: string;
    suggested_roles: string[];
  } | null;
}

// Retry helper with exponential backoff
async function fetchWithRetry(
  url: string, 
  options: RequestInit, 
  maxRetries: number = 3
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      // Handle rate limiting
      if (response.status === 403 || response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt) * 1000;
        console.log(`Rate limited, waiting ${waitTime}ms before retry ${attempt + 1}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      return response;
    } catch (error) {
      lastError = error as Error;
      console.error(`Fetch attempt ${attempt + 1} failed:`, error);
      
      // Wait before retry
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500));
      }
    }
  }
  
  throw lastError || new Error("Failed after max retries");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { github_url, linkedin_url, candidate_id } = await req.json();

    if (!candidate_id) {
      return new Response(
        JSON.stringify({ error: "Candidate ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Starting profile analysis for candidate ${candidate_id}`);
    console.log(`GitHub URL: ${github_url || "not provided"}`);
    console.log(`LinkedIn URL: ${linkedin_url || "not provided"}`);

    const analysis: ProfileAnalysis = {
      github_score: 0,
      linkedin_score: 0,
      profile_score: 0,
      skills: [],
      github_analysis: null,
      linkedin_analysis: null,
      suggested_job_preferences: null,
    };

    // Analyze GitHub profile with comprehensive data extraction
    if (github_url) {
      try {
        const githubData = await analyzeGitHubProfile(github_url);
        if (githubData) {
          analysis.github_score = githubData.score;
          analysis.skills.push(...githubData.languages);
          analysis.github_analysis = githubData.analysis;
          console.log(`GitHub analysis completed: score=${githubData.score}, repos=${githubData.analysis.repos_count}`);
        }
      } catch (githubError) {
        console.error("GitHub analysis failed:", githubError);
        // Don't fail the entire analysis, just log the error
      }
    }

    // Analyze LinkedIn profile
    if (linkedin_url) {
      try {
        const linkedinData = await analyzeLinkedInProfile(linkedin_url);
        analysis.linkedin_score = linkedinData.score;
        analysis.linkedin_analysis = linkedinData.analysis;
        console.log(`LinkedIn analysis completed: score=${linkedinData.score}`);
      } catch (linkedinError) {
        console.error("LinkedIn analysis failed:", linkedinError);
      }
    }

    // Calculate overall profile score
    const githubWeight = 0.6;
    const linkedinWeight = 0.4;
    
    if (github_url && linkedin_url) {
      analysis.profile_score = Math.round(
        analysis.github_score * githubWeight + analysis.linkedin_score * linkedinWeight
      );
    } else if (github_url) {
      analysis.profile_score = analysis.github_score;
    } else if (linkedin_url) {
      analysis.profile_score = analysis.linkedin_score;
    }

    // Use AI to enhance skills extraction and get job suggestions
    try {
      const aiAnalysis = await getAIEnhancedAnalysis(analysis, github_url, linkedin_url);
      if (aiAnalysis.skills.length > 0) {
        analysis.skills = [...new Set([...analysis.skills, ...aiAnalysis.skills])];
      }
      if (aiAnalysis.suggested_job_preferences) {
        analysis.suggested_job_preferences = aiAnalysis.suggested_job_preferences;
      }
      console.log(`AI enhancement completed: ${analysis.skills.length} skills extracted`);
    } catch (aiError) {
      console.error("AI enhancement failed:", aiError);
    }

    // Update candidate profile with all analyzed data
    const { error: updateError } = await supabase
      .from("candidate_profiles")
      .update({
        github_score: analysis.github_score,
        linkedin_score: analysis.linkedin_score,
        profile_score: analysis.profile_score,
        skills: analysis.skills,
        github_analysis: analysis.github_analysis,
        linkedin_analysis: analysis.linkedin_analysis,
        suggested_job_preferences: analysis.suggested_job_preferences,
        profile_analyzed_at: new Date().toISOString(),
      })
      .eq("user_id", candidate_id);

    if (updateError) {
      console.error("Error updating profile:", updateError);
      throw updateError;
    }

    console.log(`Profile analysis completed for candidate ${candidate_id}:`, {
      github_score: analysis.github_score,
      linkedin_score: analysis.linkedin_score,
      profile_score: analysis.profile_score,
      skills_count: analysis.skills.length,
    });

    return new Response(
      JSON.stringify({ success: true, analysis }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Profile analysis error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function analyzeGitHubProfile(github_url: string): Promise<{
  score: number;
  languages: string[];
  analysis: ProfileAnalysis["github_analysis"];
} | null> {
  try {
    // Extract username from URL - handle various URL formats
    const cleanUrl = github_url.replace(/\/$/, "").replace(/\?.*$/, "");
    const urlParts = cleanUrl.split("/");
    const username = urlParts[urlParts.length - 1];

    if (!username || username.length < 1) {
      console.log("Could not extract GitHub username from URL:", github_url);
      return null;
    }

    console.log(`Fetching GitHub data for user: ${username}`);

    // Fetch user data with retry
    const userResponse = await fetchWithRetry(
      `https://api.github.com/users/${username}`,
      { headers: { "User-Agent": "HireMinds-AI/1.0" } }
    );

    if (!userResponse.ok) {
      console.log(`GitHub user not found: ${username}, status: ${userResponse.status}`);
      return null;
    }

    const user: GitHubUser = await userResponse.json();
    console.log(`GitHub user found: ${user.name || username}, public_repos: ${user.public_repos}`);

    // Fetch all repositories (up to 100 most recently updated)
    const reposResponse = await fetchWithRetry(
      `https://api.github.com/users/${username}/repos?per_page=100&sort=updated&direction=desc`,
      { headers: { "User-Agent": "HireMinds-AI/1.0" } }
    );

    const repos: GitHubRepo[] = reposResponse.ok ? await reposResponse.json() : [];
    console.log(`Fetched ${repos.length} repositories`);

    // Calculate comprehensive metrics
    const totalStars = repos.reduce((sum, repo) => sum + repo.stargazers_count, 0);
    const totalForks = repos.reduce((sum, repo) => sum + repo.forks_count, 0);
    
    // Extract languages with counts
    const languageCounts: Record<string, number> = {};
    repos.forEach((repo) => {
      if (repo.language) {
        languageCounts[repo.language] = (languageCounts[repo.language] || 0) + 1;
      }
    });
    
    const topLanguages = Object.entries(languageCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([lang]) => lang);

    // Get top repositories by stars
    const topRepos = repos
      .filter(repo => !repo.name.includes(username)) // Exclude profile repos
      .sort((a, b) => b.stargazers_count - a.stargazers_count)
      .slice(0, 5)
      .map(repo => ({
        name: repo.name,
        description: repo.description,
        stars: repo.stargazers_count,
        language: repo.language,
        url: repo.html_url,
      }));

    // Calculate account age
    const accountAge = (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24 * 365);

    // Determine recent activity based on last repo update
    const recentRepos = repos.filter(repo => {
      const updatedAt = new Date(repo.updated_at);
      const monthsAgo = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24 * 30);
      return monthsAgo < 3;
    });
    
    let recentActivity = "low";
    if (recentRepos.length >= 10) {
      recentActivity = "very_high";
    } else if (recentRepos.length >= 5) {
      recentActivity = "high";
    } else if (recentRepos.length >= 2) {
      recentActivity = "medium";
    }

    // Calculate comprehensive score
    let score = 0;
    
    // Repos count (max 20 points)
    score += Math.min(user.public_repos * 1.5, 20);
    
    // Stars (max 25 points) - logarithmic scale for fairness
    score += Math.min(Math.log10(totalStars + 1) * 8, 25);
    
    // Followers (max 15 points) - logarithmic scale
    score += Math.min(Math.log10(user.followers + 1) * 5, 15);
    
    // Forks (max 10 points)
    score += Math.min(totalForks * 0.5, 10);
    
    // Language diversity (max 10 points)
    score += Math.min(Object.keys(languageCounts).length * 2, 10);
    
    // Account age bonus (max 10 points)
    score += Math.min(accountAge * 2, 10);
    
    // Recent activity bonus (max 10 points)
    score += recentRepos.length >= 5 ? 10 : recentRepos.length * 2;

    // Determine activity level
    let activityLevel = "low";
    if (user.public_repos > 30 && totalStars > 50) {
      activityLevel = "very_high";
    } else if (user.public_repos > 20 && totalStars > 20) {
      activityLevel = "high";
    } else if (user.public_repos > 10 || totalStars > 5) {
      activityLevel = "medium";
    }

    // Calculate contribution score (simplified)
    const contributionScore = Math.min(
      Math.round((totalStars + totalForks * 2 + user.followers) / 10),
      100
    );

    return {
      score: Math.min(Math.round(score), 100),
      languages: topLanguages,
      analysis: {
        repos_count: user.public_repos,
        total_stars: totalStars,
        total_forks: totalForks,
        top_languages: topLanguages,
        followers: user.followers,
        account_age_years: Math.round(accountAge * 10) / 10,
        activity_level: activityLevel,
        top_repos: topRepos,
        recent_activity: recentActivity,
        contribution_score: contributionScore,
      },
    };
  } catch (error) {
    console.error("GitHub profile analysis error:", error);
    return null;
  }
}

async function analyzeLinkedInProfile(linkedin_url: string): Promise<{
  score: number;
  analysis: ProfileAnalysis["linkedin_analysis"];
}> {
  // LinkedIn doesn't allow public API access without OAuth
  // We perform URL validation and provide a baseline score
  
  // Check if URL looks valid and complete
  const isValidUrl = linkedin_url.includes("linkedin.com/in/");
  const cleanUrl = linkedin_url.replace(/\/$/, "").replace(/\?.*$/, "");
  
  if (!isValidUrl) {
    console.log("Invalid LinkedIn URL format:", linkedin_url);
    return {
      score: 20,
      analysis: {
        profile_strength: "unknown",
        estimated_experience: "unknown",
        profile_url: linkedin_url,
      },
    };
  }

  // Extract username for validation
  const urlParts = cleanUrl.split("/in/");
  const username = urlParts.length > 1 ? urlParts[1].split("/")[0] : null;
  const hasValidUsername = username && username.length >= 3 && !username.includes("?");

  // Determine profile strength based on URL structure
  let profileStrength = "weak";
  let estimatedScore = 30;

  if (hasValidUsername) {
    // Check if it's a custom URL (no random characters)
    const isCustomUrl = !/^\d+$/.test(username) && !/^[a-f0-9-]{20,}$/i.test(username);
    
    if (isCustomUrl) {
      profileStrength = "established";
      estimatedScore = 60;
    } else {
      profileStrength = "present";
      estimatedScore = 45;
    }
  }

  console.log(`LinkedIn analysis: username=${username}, strength=${profileStrength}`);

  return {
    score: estimatedScore,
    analysis: {
      profile_strength: profileStrength,
      estimated_experience: "to_be_verified_in_interview",
      profile_url: cleanUrl,
    },
  };
}

async function getAIEnhancedAnalysis(
  currentAnalysis: ProfileAnalysis,
  _github_url: string | null,
  _linkedin_url: string | null
): Promise<{ skills: string[]; suggested_job_preferences: ProfileAnalysis['suggested_job_preferences'] }> {
  try {
    // Build context about the candidate
    const topReposInfo = currentAnalysis.github_analysis?.top_repos
      ?.map(r => `${r.name} (${r.language || 'unknown'}, ${r.stars} stars): ${r.description || 'no description'}`)
      .join('\n') || 'No repositories analyzed';

    const prompt = `You are an expert technical recruiter analyzing a developer's profile. Based on the following data, provide:
1. A comprehensive list of technical skills (programming languages, frameworks, tools, databases, cloud platforms, methodologies)
2. Suggested job preferences including fields, experience level, and specific roles

GitHub Profile Analysis:
- Top Languages: ${currentAnalysis.github_analysis?.top_languages?.join(", ") || "None detected"}
- Repository Count: ${currentAnalysis.github_analysis?.repos_count || 0}
- Total Stars: ${currentAnalysis.github_analysis?.total_stars || 0}
- Total Forks: ${currentAnalysis.github_analysis?.total_forks || 0}
- Activity Level: ${currentAnalysis.github_analysis?.activity_level || "unknown"}
- Recent Activity: ${currentAnalysis.github_analysis?.recent_activity || "unknown"}
- Account Age: ${currentAnalysis.github_analysis?.account_age_years || 0} years
- Followers: ${currentAnalysis.github_analysis?.followers || 0}
- Contribution Score: ${currentAnalysis.github_analysis?.contribution_score || 0}

Top Repositories:
${topReposInfo}

Scores:
- GitHub Score: ${currentAnalysis.github_score}/100
- LinkedIn Score: ${currentAnalysis.linkedin_score}/100
- Overall Profile Score: ${currentAnalysis.profile_score}/100

Return a JSON object with this exact structure:
{
  "skills": ["Array of 15-25 technical skills based on the languages and common frameworks/tools used with them. Include the main languages AND their ecosystems."],
  "suggested_job_preferences": {
    "fields": ["Top 2-3 job fields like 'Frontend Development', 'Backend Development', 'Full Stack', 'DevOps', 'AI/ML', 'Data Science', 'Mobile Development', 'Cloud Engineering'],
    "experience_level": "One of: 'entry', 'mid', 'senior', 'lead' based on account age, repo count, and activity",
    "suggested_roles": ["4-6 specific job titles that match their skills, like 'React Developer', 'Node.js Engineer', 'Python Developer', 'DevOps Engineer']
  }
}`;

    const res = await llmProvider.chat({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      responseFormat: { type: "json_object" },
    });

    const parsed = llmProvider.parseJSON(res.content);
    if (parsed) {
      return {
        skills: Array.isArray(parsed.skills) ? parsed.skills : [],
        suggested_job_preferences: parsed.suggested_job_preferences || null,
      };
    }

    return { skills: [], suggested_job_preferences: null };
  } catch (error) {
    console.error("AI analysis error:", error);
    return { skills: [], suggested_job_preferences: null };
  }
}
