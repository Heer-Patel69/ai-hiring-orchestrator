import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://qovwaaczbxyskmkktqlx.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvdndhYWN6Ynh5c2tta2t0cWx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MDMwOTIsImV4cCI6MjA4NTk3OTA5Mn0.IT7hl5iuMY7Dt2ux_0gmYESE6WolRe33am5Y3OPrzp4";

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("=== CHECKING RECENT APPLICATIONS ===");
  const { data: apps, error: appErr } = await supabase
    .from("applications")
    .select("id, candidate_id, job_id, status, current_round, applied_at, overall_score")
    .order("applied_at", { ascending: false })
    .limit(10);
  
  if (appErr) {
    console.error("App error:", appErr);
    return;
  }
  console.log("Applications found:", apps?.length);
  console.log(JSON.stringify(apps, null, 2));

  if (apps && apps.length > 0) {
    const candidateIds = [...new Set(apps.map(a => a.candidate_id))];
    console.log("\n=== CANDIDATE IDS IN APPS ===", candidateIds);

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, user_id, full_name, email")
      .in("user_id", candidateIds);
    console.log("\n=== PROFILES ===", JSON.stringify(profiles, null, 2));

    const { data: candidateProfiles } = await supabase
      .from("candidate_profiles")
      .select("id, user_id, full_name, phone_number, resume_url")
      .in("user_id", candidateIds);
    console.log("\n=== CANDIDATE_PROFILES ===", JSON.stringify(candidateProfiles, null, 2));

    const appIds = apps.map(a => a.id);

    const { data: roundResults } = await supabase
      .from("round_results")
      .select("id, application_id, round_id, score, completed_at")
      .in("application_id", appIds);
    console.log("\n=== ROUND RESULTS ===", JSON.stringify(roundResults, null, 2));

    const { data: roundScores } = await supabase
      .from("round_scores")
      .select("id, application_id, round_number, final_score")
      .in("application_id", appIds);
    console.log("\n=== ROUND SCORES ===", JSON.stringify(roundScores, null, 2));

    const { data: recordings } = await supabase
      .from("interview_recordings")
      .select("id, application_id, candidate_id, recording_url, status, duration_minutes")
      .in("application_id", appIds);
    console.log("\n=== INTERVIEW RECORDINGS ===", JSON.stringify(recordings, null, 2));

    const { data: transcripts } = await supabase
      .from("interview_transcripts")
      .select("id, application_id, role, content, timestamp_ms")
      .in("application_id", appIds)
      .limit(10);
    console.log("\n=== TRANSCRIPTS SAMPLE ===", JSON.stringify(transcripts, null, 2));
  }
}

run().catch(console.error);
