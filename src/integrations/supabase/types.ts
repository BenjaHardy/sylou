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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      ai_editor_actions: {
        Row: {
          action_type: string
          ai_response_full: string | null
          ai_response_preview: string | null
          char_count_original: number | null
          char_count_result: number | null
          created_at: string
          id: string
          instruction_text: string | null
          outcome: string
          project_id: string
          proposed_summary: string | null
          selected_text_preview: string | null
        }
        Insert: {
          action_type: string
          ai_response_full?: string | null
          ai_response_preview?: string | null
          char_count_original?: number | null
          char_count_result?: number | null
          created_at?: string
          id?: string
          instruction_text?: string | null
          outcome: string
          project_id: string
          proposed_summary?: string | null
          selected_text_preview?: string | null
        }
        Update: {
          action_type?: string
          ai_response_full?: string | null
          ai_response_preview?: string | null
          char_count_original?: number | null
          char_count_result?: number | null
          created_at?: string
          id?: string
          instruction_text?: string | null
          outcome?: string
          project_id?: string
          proposed_summary?: string | null
          selected_text_preview?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_editor_actions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_bookmarks: {
        Row: {
          annotation: string | null
          char_offset: number | null
          color: string | null
          created_at: string
          id: string
          message_id: string
          project_id: string
          thread_id: string
        }
        Insert: {
          annotation?: string | null
          char_offset?: number | null
          color?: string | null
          created_at?: string
          id?: string
          message_id: string
          project_id: string
          thread_id: string
        }
        Update: {
          annotation?: string | null
          char_offset?: number | null
          color?: string | null
          created_at?: string
          id?: string
          message_id?: string
          project_id?: string
          thread_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          concise_mode: boolean | null
          content: string
          created_at: string
          documents_referenced: Json | null
          flow_flag: string | null
          id: string
          model_used: string | null
          role: string
          source_type: string | null
          thread_id: string
          tutor_mode: boolean | null
          web_searches_performed: Json | null
        }
        Insert: {
          concise_mode?: boolean | null
          content: string
          created_at?: string
          documents_referenced?: Json | null
          flow_flag?: string | null
          id?: string
          model_used?: string | null
          role: string
          source_type?: string | null
          thread_id: string
          tutor_mode?: boolean | null
          web_searches_performed?: Json | null
        }
        Update: {
          concise_mode?: boolean | null
          content?: string
          created_at?: string
          documents_referenced?: Json | null
          flow_flag?: string | null
          id?: string
          model_used?: string | null
          role?: string
          source_type?: string | null
          thread_id?: string
          tutor_mode?: boolean | null
          web_searches_performed?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          created_at: string
          id: string
          name: string
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_threads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_reports: {
        Row: {
          ai_editor_summary: Json | null
          ai_find: Json
          ai_lead: Json
          ai_organize: Json
          ai_summary: string
          ai_write: Json
          certificate_id: string | null
          created_at: string
          flow_meta: Json | null
          generator_info: Json | null
          id: string
          key_user_contributions: Json | null
          metrics_snapshot: Json | null
          model_used: string
          project_id: string
          project_name: string | null
          provenance_snapshot: Json | null
          replay_snapshot: Json | null
          share_enabled: boolean | null
          share_include_feedback: boolean
          share_include_profile: boolean
          share_include_replay: boolean
          share_include_report: boolean
          share_token: string | null
          share_visibility: string | null
          user_feedback_post: Json | null
          user_feedback_post_at: string | null
          user_feedback_pre: Json | null
          user_feedback_pre_at: string | null
          writing_snapshot: string
        }
        Insert: {
          ai_editor_summary?: Json | null
          ai_find: Json
          ai_lead: Json
          ai_organize: Json
          ai_summary: string
          ai_write: Json
          certificate_id?: string | null
          created_at?: string
          flow_meta?: Json | null
          generator_info?: Json | null
          id?: string
          key_user_contributions?: Json | null
          metrics_snapshot?: Json | null
          model_used: string
          project_id: string
          project_name?: string | null
          provenance_snapshot?: Json | null
          replay_snapshot?: Json | null
          share_enabled?: boolean | null
          share_include_feedback?: boolean
          share_include_profile?: boolean
          share_include_replay?: boolean
          share_include_report?: boolean
          share_token?: string | null
          share_visibility?: string | null
          user_feedback_post?: Json | null
          user_feedback_post_at?: string | null
          user_feedback_pre?: Json | null
          user_feedback_pre_at?: string | null
          writing_snapshot?: string
        }
        Update: {
          ai_editor_summary?: Json | null
          ai_find?: Json
          ai_lead?: Json
          ai_organize?: Json
          ai_summary?: string
          ai_write?: Json
          certificate_id?: string | null
          created_at?: string
          flow_meta?: Json | null
          generator_info?: Json | null
          id?: string
          key_user_contributions?: Json | null
          metrics_snapshot?: Json | null
          model_used?: string
          project_id?: string
          project_name?: string | null
          provenance_snapshot?: Json | null
          replay_snapshot?: Json | null
          share_enabled?: boolean | null
          share_include_feedback?: boolean
          share_include_profile?: boolean
          share_include_replay?: boolean
          share_include_report?: boolean
          share_token?: string | null
          share_visibility?: string | null
          user_feedback_post?: Json | null
          user_feedback_post_at?: string | null
          user_feedback_pre?: Json | null
          user_feedback_pre_at?: string | null
          writing_snapshot?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      imported_documents: {
        Row: {
          extracted_text: string | null
          file_name: string
          file_path: string
          file_size_bytes: number | null
          id: string
          is_favourite: boolean
          project_id: string
          summary: string | null
          uploaded_at: string
        }
        Insert: {
          extracted_text?: string | null
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          id?: string
          is_favourite?: boolean
          project_id: string
          summary?: string | null
          uploaded_at?: string
        }
        Update: {
          extracted_text?: string | null
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          is_favourite?: boolean
          project_id?: string
          summary?: string | null
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "imported_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      post_its: {
        Row: {
          color: string
          content: string
          created_at: string
          id: string
          position_x: number
          position_y: number
          project_id: string
        }
        Insert: {
          color?: string
          content?: string
          created_at?: string
          id?: string
          position_x?: number
          position_y?: number
          project_id: string
        }
        Update: {
          color?: string
          content?: string
          created_at?: string
          id?: string
          position_x?: number
          position_y?: number
          project_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          default_concise_mode: boolean
          display_name: string | null
          email: string
          flow_nudges_enabled: boolean | null
          id: string
          monthly_token_budget: number | null
          preferred_chat_model: string | null
          preferred_flow_model: string
          preferred_language: string | null
          token_period_start: string
          tokens_used_this_period: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_concise_mode?: boolean
          display_name?: string | null
          email: string
          flow_nudges_enabled?: boolean | null
          id: string
          monthly_token_budget?: number | null
          preferred_chat_model?: string | null
          preferred_flow_model?: string
          preferred_language?: string | null
          token_period_start?: string
          tokens_used_this_period?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_concise_mode?: boolean
          display_name?: string | null
          email?: string
          flow_nudges_enabled?: boolean | null
          id?: string
          monthly_token_budget?: number | null
          preferred_chat_model?: string | null
          preferred_flow_model?: string
          preferred_language?: string | null
          token_period_start?: string
          tokens_used_this_period?: number
          updated_at?: string
        }
        Relationships: []
      }
      project_creative_data: {
        Row: {
          data: Json
          id: string
          project_id: string
          tool_type: string
          updated_at: string
        }
        Insert: {
          data?: Json
          id?: string
          project_id: string
          tool_type: string
          updated_at?: string
        }
        Update: {
          data?: Json
          id?: string
          project_id?: string
          tool_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_creative_data_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_stats: {
        Row: {
          chat_prompt_count_normal: number
          chat_prompt_count_tutor: number
          clock_anomaly_count: number
          created_at: string
          first_activity_at: string | null
          id: string
          last_activity_at: string | null
          project_id: string
          sanity_check_count: number
          total_active_time_seconds: number
          total_writing_time_seconds: number
        }
        Insert: {
          chat_prompt_count_normal?: number
          chat_prompt_count_tutor?: number
          clock_anomaly_count?: number
          created_at?: string
          first_activity_at?: string | null
          id?: string
          last_activity_at?: string | null
          project_id: string
          sanity_check_count?: number
          total_active_time_seconds?: number
          total_writing_time_seconds?: number
        }
        Update: {
          chat_prompt_count_normal?: number
          chat_prompt_count_tutor?: number
          clock_anomaly_count?: number
          created_at?: string
          first_activity_at?: string | null
          id?: string
          last_activity_at?: string | null
          project_id?: string
          sanity_check_count?: number
          total_active_time_seconds?: number
          total_writing_time_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_stats_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          id: string
          language: string
          name: string
          template: string | null
          tutor_mode: boolean
          tutor_mode_locked: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          language?: string
          name: string
          template?: string | null
          tutor_mode?: boolean
          tutor_mode_locked?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          language?: string
          name?: string
          template?: string | null
          tutor_mode?: boolean
          tutor_mode_locked?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      provenance_events: {
        Row: {
          id: string
          project_id: string
          segment_map: Json
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          segment_map?: Json
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          segment_map?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provenance_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      token_usage: {
        Row: {
          created_at: string
          function_name: string
          id: string
          input_tokens: number
          model_used: string
          output_tokens: number
          project_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          function_name: string
          id?: string
          input_tokens?: number
          model_used: string
          output_tokens?: number
          project_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          function_name?: string
          id?: string
          input_tokens?: number
          model_used?: string
          output_tokens?: number
          project_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "token_usage_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "token_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      writing_content: {
        Row: {
          content: string
          id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          content?: string
          id?: string
          project_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "writing_content_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      writing_summary_log: {
        Row: {
          id: string
          last_updated_at: string
          project_id: string
          summary_text: string
        }
        Insert: {
          id?: string
          last_updated_at?: string
          project_id: string
          summary_text: string
        }
        Update: {
          id?: string
          last_updated_at?: string
          project_id?: string
          summary_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "writing_summary_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      writing_versions: {
        Row: {
          content: string
          id: string
          project_id: string
          saved_at: string
        }
        Insert: {
          content: string
          id?: string
          project_id: string
          saved_at?: string
        }
        Update: {
          content?: string
          id?: string
          project_id?: string
          saved_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "writing_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      flow_reports_public: {
        Row: {
          ai_find: Json | null
          ai_lead: Json | null
          ai_organize: Json | null
          ai_summary: string | null
          ai_write: Json | null
          certificate_id: string | null
          created_at: string | null
          flow_meta: Json | null
          generator_info: Json | null
          id: string | null
          key_user_contributions: Json | null
          metrics_snapshot: Json | null
          model_used: string | null
          project_id: string | null
          project_name: string | null
          replay_snapshot: Json | null
          share_enabled: boolean | null
          share_include_feedback: boolean | null
          share_include_profile: boolean | null
          share_include_replay: boolean | null
          share_include_report: boolean | null
          share_token: string | null
          share_visibility: string | null
          user_feedback_post: Json | null
          user_feedback_post_at: string | null
          user_feedback_pre: Json | null
          user_feedback_pre_at: string | null
          writing_snapshot: string | null
        }
        Insert: {
          ai_find?: Json | null
          ai_lead?: Json | null
          ai_organize?: Json | null
          ai_summary?: string | null
          ai_write?: Json | null
          certificate_id?: string | null
          created_at?: string | null
          flow_meta?: Json | null
          generator_info?: Json | null
          id?: string | null
          key_user_contributions?: Json | null
          metrics_snapshot?: Json | null
          model_used?: string | null
          project_id?: string | null
          project_name?: string | null
          replay_snapshot?: never
          share_enabled?: boolean | null
          share_include_feedback?: boolean | null
          share_include_profile?: boolean | null
          share_include_replay?: boolean | null
          share_include_report?: boolean | null
          share_token?: string | null
          share_visibility?: string | null
          user_feedback_post?: never
          user_feedback_post_at?: never
          user_feedback_pre?: never
          user_feedback_pre_at?: never
          writing_snapshot?: string | null
        }
        Update: {
          ai_find?: Json | null
          ai_lead?: Json | null
          ai_organize?: Json | null
          ai_summary?: string | null
          ai_write?: Json | null
          certificate_id?: string | null
          created_at?: string | null
          flow_meta?: Json | null
          generator_info?: Json | null
          id?: string | null
          key_user_contributions?: Json | null
          metrics_snapshot?: Json | null
          model_used?: string | null
          project_id?: string | null
          project_name?: string | null
          replay_snapshot?: never
          share_enabled?: boolean | null
          share_include_feedback?: boolean | null
          share_include_profile?: boolean | null
          share_include_replay?: boolean | null
          share_include_report?: boolean | null
          share_token?: string | null
          share_visibility?: string | null
          user_feedback_post?: never
          user_feedback_post_at?: never
          user_feedback_pre?: never
          user_feedback_pre_at?: never
          writing_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flow_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      get_shared_report: {
        Args: { _token: string }
        Returns: Database["public"]["Views"]["flow_reports_public"]["Row"][]
      }
      increment_tokens_used: {
        Args: { amount: number; user_uuid: string }
        Returns: undefined
      }
      owns_project: { Args: { _project_id: string }; Returns: boolean }
      owns_thread: { Args: { _thread_id: string }; Returns: boolean }
      reset_tokens_if_stale: { Args: { user_uuid: string }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
