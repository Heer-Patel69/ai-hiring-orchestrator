export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_results: {
        Row: {
          agent_name: string
          agent_number: number
          application_id: string
          created_at: string
          decision: string
          detailed_scores: Json | null
          id: string
          raw_data: Json | null
          reasoning: string | null
          score: number | null
          updated_at: string
        }
        Insert: {
          agent_name: string
          agent_number: number
          application_id: string
          created_at?: string
          decision: string
          detailed_scores?: Json | null
          id?: string
          raw_data?: Json | null
          reasoning?: string | null
          score?: number | null
          updated_at?: string
        }
        Update: {
          agent_name?: string
          agent_number?: number
          application_id?: string
          created_at?: string
          decision?: string
          detailed_scores?: Json | null
          id?: string
          raw_data?: Json | null
          reasoning?: string | null
          score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_results_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_learning_metrics: {
        Row: {
          created_at: string
          id: string
          improvement_rate: number | null
          job_field: string | null
          metric_name: string
          metric_type: string
          metric_value: number | null
          notes: string | null
          sample_count: number | null
          time_period: string
        }
        Insert: {
          created_at?: string
          id?: string
          improvement_rate?: number | null
          job_field?: string | null
          metric_name: string
          metric_type: string
          metric_value?: number | null
          notes?: string | null
          sample_count?: number | null
          time_period: string
        }
        Update: {
          created_at?: string
          id?: string
          improvement_rate?: number | null
          job_field?: string | null
          metric_name?: string
          metric_type?: string
          metric_value?: number | null
          notes?: string | null
          sample_count?: number | null
          time_period?: string
        }
        Relationships: []
      }
      alternative_role_suggestions: {
        Row: {
          candidate_id: string
          created_at: string
          id: string
          match_score: number | null
          matching_skills: Json | null
          original_job_id: string
          outcome: string | null
          reason: string | null
          suggested_job_id: string | null
          suggested_role_type: string
          was_pursued: boolean | null
        }
        Insert: {
          candidate_id: string
          created_at?: string
          id?: string
          match_score?: number | null
          matching_skills?: Json | null
          original_job_id: string
          outcome?: string | null
          reason?: string | null
          suggested_job_id?: string | null
          suggested_role_type: string
          was_pursued?: boolean | null
        }
        Update: {
          candidate_id?: string
          created_at?: string
          id?: string
          match_score?: number | null
          matching_skills?: Json | null
          original_job_id?: string
          outcome?: string | null
          reason?: string | null
          suggested_job_id?: string | null
          suggested_role_type?: string
          was_pursued?: boolean | null
        }
        Relationships: []
      }
      applications: {
        Row: {
          agent_started_at: string | null
          ai_confidence: number | null
          applied_at: string
          candidate_id: string
          current_agent: number | null
          current_round: number | null
          fraud_flags: Json | null
          fraud_risk_score: number | null
          id: string
          job_id: string
          notes: string | null
          overall_score: number | null
          status: Database["public"]["Enums"]["application_status"] | null
          updated_at: string
        }
        Insert: {
          agent_started_at?: string | null
          ai_confidence?: number | null
          applied_at?: string
          candidate_id: string
          current_agent?: number | null
          current_round?: number | null
          fraud_flags?: Json | null
          fraud_risk_score?: number | null
          id?: string
          job_id: string
          notes?: string | null
          overall_score?: number | null
          status?: Database["public"]["Enums"]["application_status"] | null
          updated_at?: string
        }
        Update: {
          agent_started_at?: string | null
          ai_confidence?: number | null
          applied_at?: string
          candidate_id?: string
          current_agent?: number | null
          current_round?: number | null
          fraud_flags?: Json | null
          fraud_risk_score?: number | null
          id?: string
          job_id?: string
          notes?: string | null
          overall_score?: number | null
          status?: Database["public"]["Enums"]["application_status"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      behavioral_responses: {
        Row: {
          ai_evaluation: Json | null
          application_id: string
          created_at: string
          id: string
          question: string
          response_audio_url: string | null
          response_text: string | null
          scores: Json | null
        }
        Insert: {
          ai_evaluation?: Json | null
          application_id: string
          created_at?: string
          id?: string
          question: string
          response_audio_url?: string | null
          response_text?: string | null
          scores?: Json | null
        }
        Update: {
          ai_evaluation?: Json | null
          application_id?: string
          created_at?: string
          id?: string
          question?: string
          response_audio_url?: string | null
          response_text?: string | null
          scores?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "behavioral_responses_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_demographics: {
        Row: {
          age_group: string | null
          candidate_id: string
          created_at: string
          educational_institution: string | null
          gender: string | null
          geographic_region: string | null
          id: string
          updated_at: string
          years_of_experience: number | null
        }
        Insert: {
          age_group?: string | null
          candidate_id: string
          created_at?: string
          educational_institution?: string | null
          gender?: string | null
          geographic_region?: string | null
          id?: string
          updated_at?: string
          years_of_experience?: number | null
        }
        Update: {
          age_group?: string | null
          candidate_id?: string
          created_at?: string
          educational_institution?: string | null
          gender?: string | null
          geographic_region?: string | null
          id?: string
          updated_at?: string
          years_of_experience?: number | null
        }
        Relationships: []
      }
      candidate_profiles: {
        Row: {
          aadhaar_back_url: string | null
          aadhaar_front_url: string | null
          aadhaar_number: string | null
          certifications: Json | null
          created_at: string
          education: Json | null
          experience_years: number | null
          github_analysis: Json | null
          github_score: number | null
          github_url: string | null
          id: string
          linkedin_analysis: Json | null
          linkedin_score: number | null
          linkedin_url: string | null
          live_photo_url: string | null
          phone_number: string
          profile_analyzed_at: string | null
          profile_score: number | null
          projects: Json | null
          resume_url: string | null
          skills: string[] | null
          suggested_job_preferences: Json | null
          updated_at: string
          user_id: string
          verification_confidence: number | null
          verification_status:
            | Database["public"]["Enums"]["verification_status"]
            | null
        }
        Insert: {
          aadhaar_back_url?: string | null
          aadhaar_front_url?: string | null
          aadhaar_number?: string | null
          certifications?: Json | null
          created_at?: string
          education?: Json | null
          experience_years?: number | null
          github_analysis?: Json | null
          github_score?: number | null
          github_url?: string | null
          id?: string
          linkedin_analysis?: Json | null
          linkedin_score?: number | null
          linkedin_url?: string | null
          live_photo_url?: string | null
          phone_number: string
          profile_analyzed_at?: string | null
          profile_score?: number | null
          projects?: Json | null
          resume_url?: string | null
          skills?: string[] | null
          suggested_job_preferences?: Json | null
          updated_at?: string
          user_id: string
          verification_confidence?: number | null
          verification_status?:
            | Database["public"]["Enums"]["verification_status"]
            | null
        }
        Update: {
          aadhaar_back_url?: string | null
          aadhaar_front_url?: string | null
          aadhaar_number?: string | null
          certifications?: Json | null
          created_at?: string
          education?: Json | null
          experience_years?: number | null
          github_analysis?: Json | null
          github_score?: number | null
          github_url?: string | null
          id?: string
          linkedin_analysis?: Json | null
          linkedin_score?: number | null
          linkedin_url?: string | null
          live_photo_url?: string | null
          phone_number?: string
          profile_analyzed_at?: string | null
          profile_score?: number | null
          projects?: Json | null
          resume_url?: string | null
          skills?: string[] | null
          suggested_job_preferences?: Json | null
          updated_at?: string
          user_id?: string
          verification_confidence?: number | null
          verification_status?:
            | Database["public"]["Enums"]["verification_status"]
            | null
        }
        Relationships: []
      }
      candidate_rankings: {
        Row: {
          ai_recommendation: string | null
          application_id: string
          created_at: string
          final_score: number
          hire_status: string | null
          id: string
          job_id: string
          rank: number | null
          strengths: Json | null
          updated_at: string
          weaknesses: Json | null
        }
        Insert: {
          ai_recommendation?: string | null
          application_id: string
          created_at?: string
          final_score: number
          hire_status?: string | null
          id?: string
          job_id: string
          rank?: number | null
          strengths?: Json | null
          updated_at?: string
          weaknesses?: Json | null
        }
        Update: {
          ai_recommendation?: string | null
          application_id?: string
          created_at?: string
          final_score?: number
          hire_status?: string | null
          id?: string
          job_id?: string
          rank?: number | null
          strengths?: Json | null
          updated_at?: string
          weaknesses?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_rankings_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_rankings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_scores: {
        Row: {
          application_id: string
          candidate_id: string
          communication_score: number | null
          created_at: string
          final_score: number | null
          id: string
          improvement_suggestions: string[] | null
          job_id: string
          overall_summary: string | null
          percentile_rank: number | null
          problem_solving_score: number | null
          rank_among_applicants: number | null
          recommendation:
            | Database["public"]["Enums"]["decision_recommendation"]
            | null
          recommendation_confidence: number | null
          recommendation_reason: string | null
          risk_explanations: string[] | null
          risk_flags: string[] | null
          strengths: string[] | null
          technical_score: number | null
          total_applicants: number | null
          updated_at: string
          weaknesses: string[] | null
        }
        Insert: {
          application_id: string
          candidate_id: string
          communication_score?: number | null
          created_at?: string
          final_score?: number | null
          id?: string
          improvement_suggestions?: string[] | null
          job_id: string
          overall_summary?: string | null
          percentile_rank?: number | null
          problem_solving_score?: number | null
          rank_among_applicants?: number | null
          recommendation?:
            | Database["public"]["Enums"]["decision_recommendation"]
            | null
          recommendation_confidence?: number | null
          recommendation_reason?: string | null
          risk_explanations?: string[] | null
          risk_flags?: string[] | null
          strengths?: string[] | null
          technical_score?: number | null
          total_applicants?: number | null
          updated_at?: string
          weaknesses?: string[] | null
        }
        Update: {
          application_id?: string
          candidate_id?: string
          communication_score?: number | null
          created_at?: string
          final_score?: number | null
          id?: string
          improvement_suggestions?: string[] | null
          job_id?: string
          overall_summary?: string | null
          percentile_rank?: number | null
          problem_solving_score?: number | null
          rank_among_applicants?: number | null
          recommendation?:
            | Database["public"]["Enums"]["decision_recommendation"]
            | null
          recommendation_confidence?: number | null
          recommendation_reason?: string | null
          risk_explanations?: string[] | null
          risk_flags?: string[] | null
          strengths?: string[] | null
          technical_score?: number | null
          total_applicants?: number | null
          updated_at?: string
          weaknesses?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_scores_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_scores_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      code_submissions: {
        Row: {
          ai_review: Json | null
          application_id: string
          code: string
          code_quality_score: number | null
          execution_time_ms: number | null
          id: string
          keystroke_data: Json | null
          language: string
          memory_used_kb: number | null
          paste_events: number | null
          problem_id: string
          space_complexity: string | null
          submitted_at: string
          tests_passed: number | null
          tests_total: number | null
          time_complexity: string | null
        }
        Insert: {
          ai_review?: Json | null
          application_id: string
          code: string
          code_quality_score?: number | null
          execution_time_ms?: number | null
          id?: string
          keystroke_data?: Json | null
          language: string
          memory_used_kb?: number | null
          paste_events?: number | null
          problem_id: string
          space_complexity?: string | null
          submitted_at?: string
          tests_passed?: number | null
          tests_total?: number | null
          time_complexity?: string | null
        }
        Update: {
          ai_review?: Json | null
          application_id?: string
          code?: string
          code_quality_score?: number | null
          execution_time_ms?: number | null
          id?: string
          keystroke_data?: Json | null
          language?: string
          memory_used_kb?: number | null
          paste_events?: number | null
          problem_id?: string
          space_complexity?: string | null
          submitted_at?: string
          tests_passed?: number | null
          tests_total?: number | null
          time_complexity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "code_submissions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      coding_problems: {
        Row: {
          constraints: string | null
          created_at: string
          description: string
          difficulty: string
          examples: Json | null
          expected_space_complexity: string | null
          expected_time_complexity: string | null
          hidden_test_cases: Json
          hints: Json | null
          id: string
          input_format: string | null
          job_id: string | null
          output_format: string | null
          test_cases: Json
          time_limit_minutes: number | null
          title: string
        }
        Insert: {
          constraints?: string | null
          created_at?: string
          description: string
          difficulty: string
          examples?: Json | null
          expected_space_complexity?: string | null
          expected_time_complexity?: string | null
          hidden_test_cases?: Json
          hints?: Json | null
          id?: string
          input_format?: string | null
          job_id?: string | null
          output_format?: string | null
          test_cases?: Json
          time_limit_minutes?: number | null
          title: string
        }
        Update: {
          constraints?: string | null
          created_at?: string
          description?: string
          difficulty?: string
          examples?: Json | null
          expected_space_complexity?: string | null
          expected_time_complexity?: string | null
          hidden_test_cases?: Json
          hints?: Json | null
          id?: string
          input_format?: string | null
          job_id?: string | null
          output_format?: string | null
          test_cases?: Json
          time_limit_minutes?: number | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "coding_problems_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_overrides: {
        Row: {
          application_id: string
          created_at: string
          id: string
          interviewer_id: string
          new_status: Database["public"]["Enums"]["application_status"]
          original_status: Database["public"]["Enums"]["application_status"]
          reason: string
        }
        Insert: {
          application_id: string
          created_at?: string
          id?: string
          interviewer_id: string
          new_status: Database["public"]["Enums"]["application_status"]
          original_status: Database["public"]["Enums"]["application_status"]
          reason: string
        }
        Update: {
          application_id?: string
          created_at?: string
          id?: string
          interviewer_id?: string
          new_status?: Database["public"]["Enums"]["application_status"]
          original_status?: Database["public"]["Enums"]["application_status"]
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_overrides_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      fairness_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_type: string
          category: Database["public"]["Enums"]["demographic_category"]
          created_at: string
          description: string
          deviation_percentage: number | null
          group_name: string
          id: string
          job_id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: Database["public"]["Enums"]["alert_status"]
          suggested_actions: Json | null
          threshold_percentage: number | null
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type: string
          category: Database["public"]["Enums"]["demographic_category"]
          created_at?: string
          description: string
          deviation_percentage?: number | null
          group_name: string
          id?: string
          job_id: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: Database["public"]["Enums"]["alert_status"]
          suggested_actions?: Json | null
          threshold_percentage?: number | null
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: string
          category?: Database["public"]["Enums"]["demographic_category"]
          created_at?: string
          description?: string
          deviation_percentage?: number | null
          group_name?: string
          id?: string
          job_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: Database["public"]["Enums"]["alert_status"]
          suggested_actions?: Json | null
          threshold_percentage?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      fairness_audit_reports: {
        Row: {
          compliance_status: string
          created_at: string
          findings: Json | null
          generated_at: string
          id: string
          interviewer_id: string
          job_id: string | null
          metrics_snapshot: Json | null
          overall_fairness_score: number | null
          recommendations: Json | null
          report_period_end: string
          report_period_start: string
          report_type: string
          total_candidates_analyzed: number
        }
        Insert: {
          compliance_status?: string
          created_at?: string
          findings?: Json | null
          generated_at?: string
          id?: string
          interviewer_id: string
          job_id?: string | null
          metrics_snapshot?: Json | null
          overall_fairness_score?: number | null
          recommendations?: Json | null
          report_period_end: string
          report_period_start: string
          report_type: string
          total_candidates_analyzed?: number
        }
        Update: {
          compliance_status?: string
          created_at?: string
          findings?: Json | null
          generated_at?: string
          id?: string
          interviewer_id?: string
          job_id?: string | null
          metrics_snapshot?: Json | null
          overall_fairness_score?: number | null
          recommendations?: Json | null
          report_period_end?: string
          report_period_start?: string
          report_type?: string
          total_candidates_analyzed?: number
        }
        Relationships: []
      }
      fairness_metrics: {
        Row: {
          analysis_date: string
          average_score: number | null
          category: Database["public"]["Enums"]["demographic_category"]
          chi_squared_value: number | null
          created_at: string
          disparate_impact_ratio: number | null
          group_name: string
          id: string
          is_statistically_significant: boolean | null
          job_id: string
          p_value: number | null
          pass_rate: number | null
          passed_candidates: number
          score_std_deviation: number | null
          total_candidates: number
          updated_at: string
        }
        Insert: {
          analysis_date?: string
          average_score?: number | null
          category: Database["public"]["Enums"]["demographic_category"]
          chi_squared_value?: number | null
          created_at?: string
          disparate_impact_ratio?: number | null
          group_name: string
          id?: string
          is_statistically_significant?: boolean | null
          job_id: string
          p_value?: number | null
          pass_rate?: number | null
          passed_candidates?: number
          score_std_deviation?: number | null
          total_candidates?: number
          updated_at?: string
        }
        Update: {
          analysis_date?: string
          average_score?: number | null
          category?: Database["public"]["Enums"]["demographic_category"]
          chi_squared_value?: number | null
          created_at?: string
          disparate_impact_ratio?: number | null
          group_name?: string
          id?: string
          is_statistically_significant?: boolean | null
          job_id?: string
          p_value?: number | null
          pass_rate?: number | null
          passed_candidates?: number
          score_std_deviation?: number | null
          total_candidates?: number
          updated_at?: string
        }
        Relationships: []
      }
      fairness_settings: {
        Row: {
          alert_dashboard_enabled: boolean
          alert_email_enabled: boolean
          auto_monthly_audit: boolean
          created_at: string
          disparate_impact_threshold: number
          enable_blind_evaluation: boolean
          enable_score_reweighting: boolean
          id: string
          interviewer_id: string
          job_id: string | null
          pass_rate_deviation_threshold: number
          reweighting_factors: Json | null
          updated_at: string
        }
        Insert: {
          alert_dashboard_enabled?: boolean
          alert_email_enabled?: boolean
          auto_monthly_audit?: boolean
          created_at?: string
          disparate_impact_threshold?: number
          enable_blind_evaluation?: boolean
          enable_score_reweighting?: boolean
          id?: string
          interviewer_id: string
          job_id?: string | null
          pass_rate_deviation_threshold?: number
          reweighting_factors?: Json | null
          updated_at?: string
        }
        Update: {
          alert_dashboard_enabled?: boolean
          alert_email_enabled?: boolean
          auto_monthly_audit?: boolean
          created_at?: string
          disparate_impact_threshold?: number
          enable_blind_evaluation?: boolean
          enable_score_reweighting?: boolean
          id?: string
          interviewer_id?: string
          job_id?: string | null
          pass_rate_deviation_threshold?: number
          reweighting_factors?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      final_reports: {
        Row: {
          generated_at: string
          id: string
          job_id: string
          report_data: Json
          report_type: string
        }
        Insert: {
          generated_at?: string
          id?: string
          job_id: string
          report_data?: Json
          report_type: string
        }
        Update: {
          generated_at?: string
          id?: string
          job_id?: string
          report_data?: Json
          report_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "final_reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      fraud_logs: {
        Row: {
          agent_number: number | null
          application_id: string
          created_at: string
          evidence: Json | null
          flag_type: string
          id: string
          severity: string
        }
        Insert: {
          agent_number?: number | null
          application_id: string
          created_at?: string
          evidence?: Json | null
          flag_type: string
          id?: string
          severity: string
        }
        Update: {
          agent_number?: number | null
          application_id?: string
          created_at?: string
          evidence?: Json | null
          flag_type?: string
          id?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "fraud_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_recordings: {
        Row: {
          application_id: string
          archived_at: string | null
          audio_url: string | null
          code_submissions: Json | null
          created_at: string
          downloaded_at: string | null
          downloaded_by: string | null
          duration_minutes: number | null
          fraud_flags: Json | null
          id: string
          interviewer_id: string | null
          status: string | null
          transcript: Json | null
          video_url: string | null
          viewed_at: string | null
          viewed_by: string | null
        }
        Insert: {
          application_id: string
          archived_at?: string | null
          audio_url?: string | null
          code_submissions?: Json | null
          created_at?: string
          downloaded_at?: string | null
          downloaded_by?: string | null
          duration_minutes?: number | null
          fraud_flags?: Json | null
          id?: string
          interviewer_id?: string | null
          status?: string | null
          transcript?: Json | null
          video_url?: string | null
          viewed_at?: string | null
          viewed_by?: string | null
        }
        Update: {
          application_id?: string
          archived_at?: string | null
          audio_url?: string | null
          code_submissions?: Json | null
          created_at?: string
          downloaded_at?: string | null
          downloaded_by?: string | null
          duration_minutes?: number | null
          fraud_flags?: Json | null
          id?: string
          interviewer_id?: string | null
          status?: string | null
          transcript?: Json | null
          video_url?: string | null
          viewed_at?: string | null
          viewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_recordings_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_transcripts: {
        Row: {
          application_id: string
          audio_url: string | null
          content: string
          created_at: string
          id: string
          phase: string | null
          role: string
          timestamp_ms: number | null
        }
        Insert: {
          application_id: string
          audio_url?: string | null
          content: string
          created_at?: string
          id?: string
          phase?: string | null
          role: string
          timestamp_ms?: number | null
        }
        Update: {
          application_id?: string
          audio_url?: string | null
          content?: string
          created_at?: string
          id?: string
          phase?: string | null
          role?: string
          timestamp_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_transcripts_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      interviewer_profiles: {
        Row: {
          budget_currency: string | null
          company_age: Database["public"]["Enums"]["company_age"]
          company_city: string
          company_country: string
          company_gst: string | null
          company_logo_url: string | null
          company_name: string
          company_state: string
          created_at: string
          hiring_reason: string | null
          id: string
          industry: Database["public"]["Enums"]["industry"]
          per_candidate_budget: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          budget_currency?: string | null
          company_age: Database["public"]["Enums"]["company_age"]
          company_city: string
          company_country: string
          company_gst?: string | null
          company_logo_url?: string | null
          company_name: string
          company_state: string
          created_at?: string
          hiring_reason?: string | null
          id?: string
          industry: Database["public"]["Enums"]["industry"]
          per_candidate_budget?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          budget_currency?: string | null
          company_age?: Database["public"]["Enums"]["company_age"]
          company_city?: string
          company_country?: string
          company_gst?: string | null
          company_logo_url?: string | null
          company_name?: string
          company_state?: string
          created_at?: string
          hiring_reason?: string | null
          id?: string
          industry?: Database["public"]["Enums"]["industry"]
          per_candidate_budget?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      job_priorities: {
        Row: {
          candidate_id: string
          created_at: string
          id: string
          is_favorited: boolean | null
          job_id: string
          match_score: number | null
          matching_skills: string[] | null
          notes: string | null
          priority_level: number | null
          updated_at: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          id?: string
          is_favorited?: boolean | null
          job_id: string
          match_score?: number | null
          matching_skills?: string[] | null
          notes?: string | null
          priority_level?: number | null
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          id?: string
          is_favorited?: boolean | null
          job_id?: string
          match_score?: number | null
          matching_skills?: string[] | null
          notes?: string | null
          priority_level?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_priorities_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_rounds: {
        Row: {
          ai_generate_questions: boolean | null
          created_at: string
          custom_questions: Json | null
          duration_minutes: number | null
          id: string
          job_id: string
          round_number: number
          round_type: Database["public"]["Enums"]["round_type"]
        }
        Insert: {
          ai_generate_questions?: boolean | null
          created_at?: string
          custom_questions?: Json | null
          duration_minutes?: number | null
          id?: string
          job_id: string
          round_number: number
          round_type: Database["public"]["Enums"]["round_type"]
        }
        Update: {
          ai_generate_questions?: boolean | null
          created_at?: string
          custom_questions?: Json | null
          duration_minutes?: number | null
          id?: string
          job_id?: string
          round_number?: number
          round_type?: Database["public"]["Enums"]["round_type"]
        }
        Relationships: [
          {
            foreignKeyName: "job_rounds_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          application_deadline: string | null
          auto_shortlist_count: number | null
          auto_shortlist_enabled: boolean | null
          created_at: string
          custom_questions: Json | null
          description: string | null
          experience_level: Database["public"]["Enums"]["experience_level"]
          field: string
          id: string
          interviewer_id: string
          location_city: string | null
          location_type: Database["public"]["Enums"]["location_type"] | null
          num_rounds: number | null
          required_skills: string[] | null
          round_config: Json | null
          salary_currency: string | null
          salary_max: number | null
          salary_min: number | null
          score_weights: Json | null
          status: Database["public"]["Enums"]["job_status"] | null
          title: string
          toughness_level: Database["public"]["Enums"]["toughness_level"] | null
          updated_at: string
        }
        Insert: {
          application_deadline?: string | null
          auto_shortlist_count?: number | null
          auto_shortlist_enabled?: boolean | null
          created_at?: string
          custom_questions?: Json | null
          description?: string | null
          experience_level: Database["public"]["Enums"]["experience_level"]
          field: string
          id?: string
          interviewer_id: string
          location_city?: string | null
          location_type?: Database["public"]["Enums"]["location_type"] | null
          num_rounds?: number | null
          required_skills?: string[] | null
          round_config?: Json | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          score_weights?: Json | null
          status?: Database["public"]["Enums"]["job_status"] | null
          title: string
          toughness_level?:
            | Database["public"]["Enums"]["toughness_level"]
            | null
          updated_at?: string
        }
        Update: {
          application_deadline?: string | null
          auto_shortlist_count?: number | null
          auto_shortlist_enabled?: boolean | null
          created_at?: string
          custom_questions?: Json | null
          description?: string | null
          experience_level?: Database["public"]["Enums"]["experience_level"]
          field?: string
          id?: string
          interviewer_id?: string
          location_city?: string | null
          location_type?: Database["public"]["Enums"]["location_type"] | null
          num_rounds?: number | null
          required_skills?: string[] | null
          round_config?: Json | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          score_weights?: Json | null
          status?: Database["public"]["Enums"]["job_status"] | null
          title?: string
          toughness_level?:
            | Database["public"]["Enums"]["toughness_level"]
            | null
          updated_at?: string
        }
        Relationships: []
      }
      learning_outcomes: {
        Row: {
          actual_performance:
            | Database["public"]["Enums"]["performance_rating"]
            | null
          ai_score: number | null
          created_at: string
          experience_level: string
          follow_up_effectiveness: number | null
          hire_success: boolean | null
          id: string
          interview_duration_minutes: number | null
          job_field: string
          questions_asked: number | null
          skills_gap: Json | null
          skills_matched: Json | null
          toughness_level: string
        }
        Insert: {
          actual_performance?:
            | Database["public"]["Enums"]["performance_rating"]
            | null
          ai_score?: number | null
          created_at?: string
          experience_level: string
          follow_up_effectiveness?: number | null
          hire_success?: boolean | null
          id?: string
          interview_duration_minutes?: number | null
          job_field: string
          questions_asked?: number | null
          skills_gap?: Json | null
          skills_matched?: Json | null
          toughness_level: string
        }
        Update: {
          actual_performance?:
            | Database["public"]["Enums"]["performance_rating"]
            | null
          ai_score?: number | null
          created_at?: string
          experience_level?: string
          follow_up_effectiveness?: number | null
          hire_success?: boolean | null
          id?: string
          interview_duration_minutes?: number | null
          job_field?: string
          questions_asked?: number | null
          skills_gap?: Json | null
          skills_matched?: Json | null
          toughness_level?: string
        }
        Relationships: []
      }
      mcq_questions: {
        Row: {
          correct_answers: Json
          created_at: string
          difficulty: string
          explanation: string | null
          id: string
          job_id: string | null
          options: Json
          points: number | null
          question_text: string
          question_type: string
          time_limit_seconds: number | null
          topic: string | null
        }
        Insert: {
          correct_answers?: Json
          created_at?: string
          difficulty: string
          explanation?: string | null
          id?: string
          job_id?: string | null
          options?: Json
          points?: number | null
          question_text: string
          question_type: string
          time_limit_seconds?: number | null
          topic?: string | null
        }
        Update: {
          correct_answers?: Json
          created_at?: string
          difficulty?: string
          explanation?: string | null
          id?: string
          job_id?: string | null
          options?: Json
          points?: number | null
          question_text?: string
          question_type?: string
          time_limit_seconds?: number | null
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcq_questions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcq_responses: {
        Row: {
          answered_at: string
          application_id: string
          id: string
          is_correct: boolean | null
          question_id: string
          selected_answers: Json
          time_taken_seconds: number | null
        }
        Insert: {
          answered_at?: string
          application_id: string
          id?: string
          is_correct?: boolean | null
          question_id: string
          selected_answers?: Json
          time_taken_seconds?: number | null
        }
        Update: {
          answered_at?: string
          application_id?: string
          id?: string
          is_correct?: boolean | null
          question_id?: string
          selected_answers?: Json
          time_taken_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mcq_responses_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      proctoring_logs: {
        Row: {
          application_id: string | null
          candidate_id: string
          created_at: string
          description: string | null
          event_type: string
          id: string
          metadata: Json | null
          recording_id: string | null
          severity: string
          timestamp_in_video: number | null
          trust_score_impact: number | null
        }
        Insert: {
          application_id?: string | null
          candidate_id: string
          created_at?: string
          description?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          recording_id?: string | null
          severity?: string
          timestamp_in_video?: number | null
          trust_score_impact?: number | null
        }
        Update: {
          application_id?: string | null
          candidate_id?: string
          created_at?: string
          description?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          recording_id?: string | null
          severity?: string
          timestamp_in_video?: number | null
          trust_score_impact?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "proctoring_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proctoring_logs_recording_id_fkey"
            columns: ["recording_id"]
            isOneToOne: false
            referencedRelation: "interview_recordings"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      question_effectiveness: {
        Row: {
          avg_time_spent_seconds: number | null
          created_at: string
          differentiation_score: number | null
          follow_up_count: number | null
          id: string
          job_field: string
          positive_outcomes: number | null
          prediction_accuracy: number | null
          question_text: string
          question_type: string
          times_asked: number | null
          updated_at: string
        }
        Insert: {
          avg_time_spent_seconds?: number | null
          created_at?: string
          differentiation_score?: number | null
          follow_up_count?: number | null
          id?: string
          job_field: string
          positive_outcomes?: number | null
          prediction_accuracy?: number | null
          question_text: string
          question_type: string
          times_asked?: number | null
          updated_at?: string
        }
        Update: {
          avg_time_spent_seconds?: number | null
          created_at?: string
          differentiation_score?: number | null
          follow_up_count?: number | null
          id?: string
          job_field?: string
          positive_outcomes?: number | null
          prediction_accuracy?: number | null
          question_text?: string
          question_type?: string
          times_asked?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      question_scores: {
        Row: {
          ai_evaluation: string | null
          ai_reasoning: string | null
          candidate_answer: string | null
          code_quality: number | null
          communication_clarity: number | null
          created_at: string
          hints_used: number | null
          id: string
          problem_solving: number | null
          question_number: number
          question_text: string
          round_result_id: string
          score_justification: string | null
          technical_accuracy: number | null
          time_efficiency: number | null
          time_taken_seconds: number | null
          weighted_score: number | null
        }
        Insert: {
          ai_evaluation?: string | null
          ai_reasoning?: string | null
          candidate_answer?: string | null
          code_quality?: number | null
          communication_clarity?: number | null
          created_at?: string
          hints_used?: number | null
          id?: string
          problem_solving?: number | null
          question_number: number
          question_text: string
          round_result_id: string
          score_justification?: string | null
          technical_accuracy?: number | null
          time_efficiency?: number | null
          time_taken_seconds?: number | null
          weighted_score?: number | null
        }
        Update: {
          ai_evaluation?: string | null
          ai_reasoning?: string | null
          candidate_answer?: string | null
          code_quality?: number | null
          communication_clarity?: number | null
          created_at?: string
          hints_used?: number | null
          id?: string
          problem_solving?: number | null
          question_number?: number
          question_text?: string
          round_result_id?: string
          score_justification?: string | null
          technical_accuracy?: number | null
          time_efficiency?: number | null
          time_taken_seconds?: number | null
          weighted_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "question_scores_round_result_id_fkey"
            columns: ["round_result_id"]
            isOneToOne: false
            referencedRelation: "round_results"
            referencedColumns: ["id"]
          },
        ]
      }
      recruiter_feedback: {
        Row: {
          actual_decision: string
          ai_recommendation: string
          application_id: string
          candidate_id: string
          created_at: string
          feedback_date: string
          id: string
          interviewer_id: string
          job_id: string
          performance_notes: string | null
          performance_rating:
            | Database["public"]["Enums"]["performance_rating"]
            | null
          probation_completed: boolean | null
          probation_end_date: string | null
          recommendation_accuracy: Database["public"]["Enums"]["feedback_accuracy"]
          updated_at: string
        }
        Insert: {
          actual_decision: string
          ai_recommendation: string
          application_id: string
          candidate_id: string
          created_at?: string
          feedback_date?: string
          id?: string
          interviewer_id: string
          job_id: string
          performance_notes?: string | null
          performance_rating?:
            | Database["public"]["Enums"]["performance_rating"]
            | null
          probation_completed?: boolean | null
          probation_end_date?: string | null
          recommendation_accuracy: Database["public"]["Enums"]["feedback_accuracy"]
          updated_at?: string
        }
        Update: {
          actual_decision?: string
          ai_recommendation?: string
          application_id?: string
          candidate_id?: string
          created_at?: string
          feedback_date?: string
          id?: string
          interviewer_id?: string
          job_id?: string
          performance_notes?: string | null
          performance_rating?:
            | Database["public"]["Enums"]["performance_rating"]
            | null
          probation_completed?: boolean | null
          probation_end_date?: string | null
          recommendation_accuracy?: Database["public"]["Enums"]["feedback_accuracy"]
          updated_at?: string
        }
        Relationships: []
      }
      role_patterns: {
        Row: {
          confidence_level: number | null
          created_at: string
          id: string
          last_updated: string
          sample_size: number | null
          source_role: string
          success_rate: number | null
          target_role: string
          transferable_skills: Json | null
        }
        Insert: {
          confidence_level?: number | null
          created_at?: string
          id?: string
          last_updated?: string
          sample_size?: number | null
          source_role: string
          success_rate?: number | null
          target_role: string
          transferable_skills?: Json | null
        }
        Update: {
          confidence_level?: number | null
          created_at?: string
          id?: string
          last_updated?: string
          sample_size?: number | null
          source_role?: string
          success_rate?: number | null
          target_role?: string
          transferable_skills?: Json | null
        }
        Relationships: []
      }
      round_results: {
        Row: {
          ai_explanation: string | null
          ai_feedback: string | null
          application_id: string
          code_submissions: Json | null
          completed_at: string | null
          created_at: string
          fraud_details: Json | null
          fraud_detected: boolean | null
          id: string
          recording_url: string | null
          round_id: string
          score: number | null
        }
        Insert: {
          ai_explanation?: string | null
          ai_feedback?: string | null
          application_id: string
          code_submissions?: Json | null
          completed_at?: string | null
          created_at?: string
          fraud_details?: Json | null
          fraud_detected?: boolean | null
          id?: string
          recording_url?: string | null
          round_id: string
          score?: number | null
        }
        Update: {
          ai_explanation?: string | null
          ai_feedback?: string | null
          application_id?: string
          code_submissions?: Json | null
          completed_at?: string | null
          created_at?: string
          fraud_details?: Json | null
          fraud_detected?: boolean | null
          id?: string
          recording_url?: string | null
          round_id?: string
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "round_results_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_results_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "job_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      round_scores: {
        Row: {
          application_id: string
          base_score: number | null
          clarifying_questions_bonus: number | null
          created_at: string
          edge_cases_bonus: number | null
          final_score: number | null
          fraud_penalty: number | null
          hints_penalty: number | null
          id: string
          improvement_suggestions: string[] | null
          optimization_bonus: number | null
          round_number: number
          round_result_id: string
          strengths: string[] | null
          updated_at: string
          weaknesses: string[] | null
          weight: number | null
        }
        Insert: {
          application_id: string
          base_score?: number | null
          clarifying_questions_bonus?: number | null
          created_at?: string
          edge_cases_bonus?: number | null
          final_score?: number | null
          fraud_penalty?: number | null
          hints_penalty?: number | null
          id?: string
          improvement_suggestions?: string[] | null
          optimization_bonus?: number | null
          round_number: number
          round_result_id: string
          strengths?: string[] | null
          updated_at?: string
          weaknesses?: string[] | null
          weight?: number | null
        }
        Update: {
          application_id?: string
          base_score?: number | null
          clarifying_questions_bonus?: number | null
          created_at?: string
          edge_cases_bonus?: number | null
          final_score?: number | null
          fraud_penalty?: number | null
          hints_penalty?: number | null
          id?: string
          improvement_suggestions?: string[] | null
          optimization_bonus?: number | null
          round_number?: number
          round_result_id?: string
          strengths?: string[] | null
          updated_at?: string
          weaknesses?: string[] | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "round_scores_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_scores_round_result_id_fkey"
            columns: ["round_result_id"]
            isOneToOne: true
            referencedRelation: "round_results"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_audit_logs: {
        Row: {
          action_description: string
          action_type: string
          application_id: string | null
          candidate_id: string | null
          confidence_score: number | null
          created_at: string
          decision_made: string | null
          factors_considered: Json | null
          id: string
          job_id: string | null
          model_version: string | null
          triggered_by: string | null
        }
        Insert: {
          action_description: string
          action_type: string
          application_id?: string | null
          candidate_id?: string | null
          confidence_score?: number | null
          created_at?: string
          decision_made?: string | null
          factors_considered?: Json | null
          id?: string
          job_id?: string | null
          model_version?: string | null
          triggered_by?: string | null
        }
        Update: {
          action_description?: string
          action_type?: string
          application_id?: string | null
          candidate_id?: string | null
          confidence_score?: number | null
          created_at?: string
          decision_made?: string | null
          factors_considered?: Json | null
          id?: string
          job_id?: string | null
          model_version?: string | null
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scoring_audit_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_audit_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      alert_status: "active" | "acknowledged" | "resolved" | "dismissed"
      app_role: "interviewer" | "candidate"
      application_status:
        | "applied"
        | "screening"
        | "interviewing"
        | "shortlisted"
        | "rejected"
        | "hired"
        | "withdrawn"
      company_age: "less_than_1" | "1_to_5" | "5_to_10" | "more_than_10"
      decision_recommendation: "shortlist" | "maybe" | "reject"
      demographic_category:
        | "gender"
        | "region"
        | "institution"
        | "experience"
        | "age_group"
      experience_level: "fresher" | "junior" | "mid" | "senior" | "architect"
      feedback_accuracy: "correct" | "incorrect" | "partially_correct"
      industry:
        | "it"
        | "finance"
        | "healthcare"
        | "education"
        | "manufacturing"
        | "retail"
        | "real_estate"
        | "consulting"
        | "legal"
        | "other"
      job_status: "draft" | "active" | "closed" | "paused"
      location_type: "remote" | "hybrid" | "onsite"
      performance_rating: "1" | "2" | "3" | "4" | "5"
      round_type:
        | "mcq"
        | "coding"
        | "system_design"
        | "behavioral"
        | "live_ai_interview"
      toughness_level: "easy" | "medium" | "hard" | "expert"
      verification_status: "pending" | "verified" | "rejected" | "manual_review"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alert_status: ["active", "acknowledged", "resolved", "dismissed"],
      app_role: ["interviewer", "candidate"],
      application_status: [
        "applied",
        "screening",
        "interviewing",
        "shortlisted",
        "rejected",
        "hired",
        "withdrawn",
      ],
      company_age: ["less_than_1", "1_to_5", "5_to_10", "more_than_10"],
      decision_recommendation: ["shortlist", "maybe", "reject"],
      demographic_category: [
        "gender",
        "region",
        "institution",
        "experience",
        "age_group",
      ],
      experience_level: ["fresher", "junior", "mid", "senior", "architect"],
      feedback_accuracy: ["correct", "incorrect", "partially_correct"],
      industry: [
        "it",
        "finance",
        "healthcare",
        "education",
        "manufacturing",
        "retail",
        "real_estate",
        "consulting",
        "legal",
        "other",
      ],
      job_status: ["draft", "active", "closed", "paused"],
      location_type: ["remote", "hybrid", "onsite"],
      performance_rating: ["1", "2", "3", "4", "5"],
      round_type: [
        "mcq",
        "coding",
        "system_design",
        "behavioral",
        "live_ai_interview",
      ],
      toughness_level: ["easy", "medium", "hard", "expert"],
      verification_status: ["pending", "verified", "rejected", "manual_review"],
    },
  },
} as const
