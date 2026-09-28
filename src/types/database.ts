export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      activities: {
        Row: {
          activity_date: string
          activity_type: string
          created_at: string
          created_by: string | null
          custom_name: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          duration_minutes: number
          estimated_calories: number
          final_calories: number | null
          id: string
          is_deleted: boolean
          is_locked: boolean
          locked_at: string | null
          manual_calories: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_date: string
          activity_type: string
          created_at?: string
          created_by?: string | null
          custom_name?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          duration_minutes: number
          estimated_calories: number
          final_calories?: never
          id?: string
          is_deleted?: boolean
          is_locked?: boolean
          locked_at?: string | null
          manual_calories?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          activity_date?: string
          activity_type?: string
          created_at?: string
          created_by?: string | null
          custom_name?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          duration_minutes?: number
          estimated_calories?: number
          final_calories?: never
          id?: string
          is_deleted?: boolean
          is_locked?: boolean
          locked_at?: string | null
          manual_calories?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'activities_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'activities_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'activities_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'activities_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'activities_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'activities_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      ai_usage_records: {
        Row: {
          actual_cost: number | null
          batch_number: number | null
          created_at: string
          currency: string
          error_message: string | null
          estimated_cost: number | null
          id: string
          input_tokens: number
          model: string
          output_tokens: number
          processing_run_id: string
          processing_user_id: string | null
          prompt_version: string | null
          provider: string
          succeeded: boolean
          total_tokens: number | null
        }
        Insert: {
          actual_cost?: number | null
          batch_number?: number | null
          created_at?: string
          currency?: string
          error_message?: string | null
          estimated_cost?: number | null
          id?: string
          input_tokens?: number
          model: string
          output_tokens?: number
          processing_run_id: string
          processing_user_id?: string | null
          prompt_version?: string | null
          provider: string
          succeeded: boolean
          total_tokens?: never
        }
        Update: {
          actual_cost?: number | null
          batch_number?: number | null
          created_at?: string
          currency?: string
          error_message?: string | null
          estimated_cost?: number | null
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          processing_run_id?: string
          processing_user_id?: string | null
          prompt_version?: string | null
          provider?: string
          succeeded?: boolean
          total_tokens?: never
        }
        Relationships: [
          {
            foreignKeyName: 'ai_usage_records_processing_run_id_fkey'
            columns: ['processing_run_id']
            isOneToOne: false
            referencedRelation: 'recommendation_processing_runs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ai_usage_records_processing_user_id_fkey'
            columns: ['processing_user_id']
            isOneToOne: false
            referencedRelation: 'recommendation_processing_users'
            referencedColumns: ['id']
          },
        ]
      }
      audit_logs: {
        Row: {
          action: Database['public']['Enums']['audit_action']
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          new_values_json: Json | null
          old_values_json: Json | null
          reason: string | null
          target_user_id: string | null
        }
        Insert: {
          action: Database['public']['Enums']['audit_action']
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          new_values_json?: Json | null
          old_values_json?: Json | null
          reason?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: Database['public']['Enums']['audit_action']
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          new_values_json?: Json | null
          old_values_json?: Json | null
          reason?: string | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'audit_logs_actor_user_id_fkey'
            columns: ['actor_user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'audit_logs_actor_user_id_fkey'
            columns: ['actor_user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'audit_logs_target_user_id_fkey'
            columns: ['target_user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'audit_logs_target_user_id_fkey'
            columns: ['target_user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      daily_target_snapshots: {
        Row: {
          calorie_lower_tolerance: number
          calorie_upper_tolerance: number
          calories: number
          carbs_g: number
          created_at: string
          fat_g: number
          fiber_g: number
          id: string
          nutrition_tolerance: number
          protein_g: number
          recommendation_cycle_id: string
          target_date: string
          updated_at: string
          user_id: string
          workouts_per_week: number
        }
        Insert: {
          calorie_lower_tolerance: number
          calorie_upper_tolerance: number
          calories: number
          carbs_g: number
          created_at?: string
          fat_g: number
          fiber_g: number
          id?: string
          nutrition_tolerance: number
          protein_g: number
          recommendation_cycle_id: string
          target_date: string
          updated_at?: string
          user_id: string
          workouts_per_week: number
        }
        Update: {
          calorie_lower_tolerance?: number
          calorie_upper_tolerance?: number
          calories?: number
          carbs_g?: number
          created_at?: string
          fat_g?: number
          fiber_g?: number
          id?: string
          nutrition_tolerance?: number
          protein_g?: number
          recommendation_cycle_id?: string
          target_date?: string
          updated_at?: string
          user_id?: string
          workouts_per_week?: number
        }
        Relationships: [
          {
            foreignKeyName: 'daily_target_snapshots_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'daily_target_snapshots_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'targets_cycle_fk'
            columns: ['recommendation_cycle_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'recommendation_cycles'
            referencedColumns: ['id', 'user_id']
          },
        ]
      }
      food_item_versions: {
        Row: {
          calories: number
          carbs_g: number
          changed_by: string | null
          created_at: string
          fat_g: number
          fiber_g: number
          food_item_id: string
          id: string
          name: string
          protein_g: number
          serving_quantity: number
          serving_unit: string
          version: number
        }
        Insert: {
          calories: number
          carbs_g: number
          changed_by?: string | null
          created_at?: string
          fat_g: number
          fiber_g: number
          food_item_id: string
          id?: string
          name: string
          protein_g: number
          serving_quantity: number
          serving_unit: string
          version: number
        }
        Update: {
          calories?: number
          carbs_g?: number
          changed_by?: string | null
          created_at?: string
          fat_g?: number
          fiber_g?: number
          food_item_id?: string
          id?: string
          name?: string
          protein_g?: number
          serving_quantity?: number
          serving_unit?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'food_item_versions_changed_by_fkey'
            columns: ['changed_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'food_item_versions_changed_by_fkey'
            columns: ['changed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'food_item_versions_food_item_id_fkey'
            columns: ['food_item_id']
            isOneToOne: false
            referencedRelation: 'food_items'
            referencedColumns: ['id']
          },
        ]
      }
      food_items: {
        Row: {
          calories: number
          carbs_g: number
          created_at: string
          created_by: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          fat_g: number
          fiber_g: number
          id: string
          is_approximate: boolean
          is_deleted: boolean
          merged_into_food_id: string | null
          name: string
          name_normalized: string | null
          protein_g: number
          serving_quantity: number
          serving_unit: string
          source_submission_id: string | null
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          calories: number
          carbs_g: number
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          fat_g: number
          fiber_g: number
          id?: string
          is_approximate?: boolean
          is_deleted?: boolean
          merged_into_food_id?: string | null
          name: string
          name_normalized?: never
          protein_g: number
          serving_quantity: number
          serving_unit: string
          source_submission_id?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          calories?: number
          carbs_g?: number
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          fat_g?: number
          fiber_g?: number
          id?: string
          is_approximate?: boolean
          is_deleted?: boolean
          merged_into_food_id?: string | null
          name?: string
          name_normalized?: never
          protein_g?: number
          serving_quantity?: number
          serving_unit?: string
          source_submission_id?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'food_items_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'food_items_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'food_items_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'food_items_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'food_items_merged_into_food_id_fkey'
            columns: ['merged_into_food_id']
            isOneToOne: false
            referencedRelation: 'food_items'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'food_items_source_submission_id_fkey'
            columns: ['source_submission_id']
            isOneToOne: true
            referencedRelation: 'food_submissions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'food_items_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'food_items_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      food_merges: {
        Row: {
          created_at: string
          id: string
          merged_by: string | null
          reason: string | null
          source_food_id: string
          target_food_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          merged_by?: string | null
          reason?: string | null
          source_food_id: string
          target_food_id: string
        }
        Update: {
          created_at?: string
          id?: string
          merged_by?: string | null
          reason?: string | null
          source_food_id?: string
          target_food_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'food_merges_merged_by_fkey'
            columns: ['merged_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'food_merges_merged_by_fkey'
            columns: ['merged_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'food_merges_source_food_id_fkey'
            columns: ['source_food_id']
            isOneToOne: true
            referencedRelation: 'food_items'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'food_merges_target_food_id_fkey'
            columns: ['target_food_id']
            isOneToOne: false
            referencedRelation: 'food_items'
            referencedColumns: ['id']
          },
        ]
      }
      food_submissions: {
        Row: {
          approved_food_item_id: string | null
          calories: number
          carbs_g: number
          created_at: string
          fat_g: number
          fiber_g: number
          id: string
          name: string
          name_normalized: string | null
          protein_g: number
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          serving_quantity: number
          serving_unit: string
          status: Database['public']['Enums']['food_review_status']
          submitted_by: string
          updated_at: string
        }
        Insert: {
          approved_food_item_id?: string | null
          calories: number
          carbs_g: number
          created_at?: string
          fat_g: number
          fiber_g: number
          id?: string
          name: string
          name_normalized?: never
          protein_g: number
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          serving_quantity: number
          serving_unit: string
          status?: Database['public']['Enums']['food_review_status']
          submitted_by?: string
          updated_at?: string
        }
        Update: {
          approved_food_item_id?: string | null
          calories?: number
          carbs_g?: number
          created_at?: string
          fat_g?: number
          fiber_g?: number
          id?: string
          name?: string
          name_normalized?: never
          protein_g?: number
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          serving_quantity?: number
          serving_unit?: string
          status?: Database['public']['Enums']['food_review_status']
          submitted_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'food_submissions_approved_food_fk'
            columns: ['approved_food_item_id']
            isOneToOne: false
            referencedRelation: 'food_items'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'food_submissions_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'food_submissions_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'food_submissions_submitted_by_fkey'
            columns: ['submitted_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'food_submissions_submitted_by_fkey'
            columns: ['submitted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      goal_focuses: {
        Row: {
          created_at: string
          focus_type: string
          goal_id: string
          id: string
          priority: number
          user_id: string
        }
        Insert: {
          created_at?: string
          focus_type: string
          goal_id: string
          id?: string
          priority: number
          user_id: string
        }
        Update: {
          created_at?: string
          focus_type?: string
          goal_id?: string
          id?: string
          priority?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'goal_focuses_goal_fk'
            columns: ['goal_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'goals'
            referencedColumns: ['id', 'user_id']
          },
        ]
      }
      goals: {
        Row: {
          created_at: string
          description: string | null
          effective_from: string
          effective_to: string | null
          id: string
          is_active: boolean
          long_term_goal: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          long_term_goal: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          long_term_goal?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'goals_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'goals_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      group_memberships: {
        Row: {
          group_id: string
          id: string
          is_active: boolean
          joined_at: string
          left_at: string | null
          removed_by: string | null
          role: Database['public']['Enums']['group_role']
          user_id: string
        }
        Insert: {
          group_id: string
          id?: string
          is_active?: boolean
          joined_at?: string
          left_at?: string | null
          removed_by?: string | null
          role?: Database['public']['Enums']['group_role']
          user_id: string
        }
        Update: {
          group_id?: string
          id?: string
          is_active?: boolean
          joined_at?: string
          left_at?: string | null
          removed_by?: string | null
          role?: Database['public']['Enums']['group_role']
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'group_memberships_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'group_memberships_removed_by_fkey'
            columns: ['removed_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'group_memberships_removed_by_fkey'
            columns: ['removed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'group_memberships_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'group_memberships_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      groups: {
        Row: {
          code: string
          created_at: string
          creator_id: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code?: string
          created_at?: string
          creator_id?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          creator_id?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'groups_creator_id_fkey'
            columns: ['creator_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'groups_creator_id_fkey'
            columns: ['creator_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'groups_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'groups_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      inbody_metrics: {
        Row: {
          bmi: number | null
          bmr_kcal: number | null
          body_fat_percent: number | null
          created_at: string
          id: string
          muscle_mass_kg: number | null
          other_metrics_json: NonNullable<Json>
          report_id: string
          updated_at: string
          user_id: string
          weight_kg: number | null
        }
        Insert: {
          bmi?: number | null
          bmr_kcal?: number | null
          body_fat_percent?: number | null
          created_at?: string
          id?: string
          muscle_mass_kg?: number | null
          other_metrics_json?: NonNullable<Json>
          report_id: string
          updated_at?: string
          user_id: string
          weight_kg?: number | null
        }
        Update: {
          bmi?: number | null
          bmr_kcal?: number | null
          body_fat_percent?: number | null
          created_at?: string
          id?: string
          muscle_mass_kg?: number | null
          other_metrics_json?: NonNullable<Json>
          report_id?: string
          updated_at?: string
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'inbody_metrics_report_fk'
            columns: ['report_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'inbody_reports'
            referencedColumns: ['id', 'user_id']
          },
        ]
      }
      inbody_reports: {
        Row: {
          created_at: string
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          extraction_error: string | null
          extraction_status: Database['public']['Enums']['inbody_extraction_status']
          file_path: string
          file_type: string
          id: string
          is_deleted: boolean
          raw_extracted_text: string | null
          report_date: string
          updated_at: string
          uploaded_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          extraction_error?: string | null
          extraction_status?: Database['public']['Enums']['inbody_extraction_status']
          file_path: string
          file_type: string
          id?: string
          is_deleted?: boolean
          raw_extracted_text?: string | null
          report_date: string
          updated_at?: string
          uploaded_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          extraction_error?: string | null
          extraction_status?: Database['public']['Enums']['inbody_extraction_status']
          file_path?: string
          file_type?: string
          id?: string
          is_deleted?: boolean
          raw_extracted_text?: string | null
          report_date?: string
          updated_at?: string
          uploaded_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'inbody_reports_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'inbody_reports_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inbody_reports_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'inbody_reports_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inbody_reports_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'inbody_reports_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      manager_user_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          manager_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          manager_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          manager_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'manager_user_assignments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'manager_user_assignments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manager_user_assignments_manager_id_fkey'
            columns: ['manager_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'manager_user_assignments_manager_id_fkey'
            columns: ['manager_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manager_user_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'manager_user_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      meal_items: {
        Row: {
          created_at: string
          created_by: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          food_item_id: string | null
          food_name_snapshot: string
          food_submission_id: string | null
          id: string
          is_deleted: boolean
          meal_id: string
          quantity: number
          snapshot_calories: number
          snapshot_carbs_g: number
          snapshot_fat_g: number
          snapshot_fiber_g: number
          snapshot_protein_g: number
          unit: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          food_item_id?: string | null
          food_name_snapshot: string
          food_submission_id?: string | null
          id?: string
          is_deleted?: boolean
          meal_id: string
          quantity: number
          snapshot_calories: number
          snapshot_carbs_g: number
          snapshot_fat_g: number
          snapshot_fiber_g: number
          snapshot_protein_g: number
          unit: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          food_item_id?: string | null
          food_name_snapshot?: string
          food_submission_id?: string | null
          id?: string
          is_deleted?: boolean
          meal_id?: string
          quantity?: number
          snapshot_calories?: number
          snapshot_carbs_g?: number
          snapshot_fat_g?: number
          snapshot_fiber_g?: number
          snapshot_protein_g?: number
          unit?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'meal_items_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'meal_items_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'meal_items_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'meal_items_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'meal_items_food_item_id_fkey'
            columns: ['food_item_id']
            isOneToOne: false
            referencedRelation: 'food_items'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'meal_items_meal_fk'
            columns: ['meal_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'active_meals'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'meal_items_meal_fk'
            columns: ['meal_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'meals'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'meal_items_submission_fk'
            columns: ['food_submission_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'food_submissions'
            referencedColumns: ['id', 'submitted_by']
          },
        ]
      }
      meals: {
        Row: {
          copied_from_meal_id: string | null
          created_at: string
          created_by: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          is_deleted: boolean
          is_locked: boolean
          locked_at: string | null
          meal_category: Database['public']['Enums']['meal_category'] | null
          meal_date: string
          meal_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          copied_from_meal_id?: string | null
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_deleted?: boolean
          is_locked?: boolean
          locked_at?: string | null
          meal_category?: Database['public']['Enums']['meal_category'] | null
          meal_date: string
          meal_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          copied_from_meal_id?: string | null
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_deleted?: boolean
          is_locked?: boolean
          locked_at?: string | null
          meal_category?: Database['public']['Enums']['meal_category'] | null
          meal_date?: string
          meal_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'meals_copied_from_fk'
            columns: ['copied_from_meal_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'active_meals'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'meals_copied_from_fk'
            columns: ['copied_from_meal_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'meals'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'meals_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'meals_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'meals_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'meals_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'meals_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'meals_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          activity_level: Database['public']['Enums']['activity_level'] | null
          bmr_kcal: number | null
          created_at: string
          date_of_birth: string | null
          deactivated_by: string | null
          deleted_at: string | null
          gender: Database['public']['Enums']['gender'] | null
          height_cm: number | null
          hobbies: string | null
          id: string
          is_active: boolean
          job: string | null
          name: string | null
          phone: string
          timezone: string
          updated_at: string
          workout_days_per_week: number | null
        }
        Insert: {
          activity_level?: Database['public']['Enums']['activity_level'] | null
          bmr_kcal?: number | null
          created_at?: string
          date_of_birth?: string | null
          deactivated_by?: string | null
          deleted_at?: string | null
          gender?: Database['public']['Enums']['gender'] | null
          height_cm?: number | null
          hobbies?: string | null
          id: string
          is_active?: boolean
          job?: string | null
          name?: string | null
          phone: string
          timezone?: string
          updated_at?: string
          workout_days_per_week?: number | null
        }
        Update: {
          activity_level?: Database['public']['Enums']['activity_level'] | null
          bmr_kcal?: number | null
          created_at?: string
          date_of_birth?: string | null
          deactivated_by?: string | null
          deleted_at?: string | null
          gender?: Database['public']['Enums']['gender'] | null
          height_cm?: number | null
          hobbies?: string | null
          id?: string
          is_active?: boolean
          job?: string | null
          name?: string | null
          phone?: string
          timezone?: string
          updated_at?: string
          workout_days_per_week?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_deactivated_by_fkey'
            columns: ['deactivated_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'profiles_deactivated_by_fkey'
            columns: ['deactivated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      recommendation_cycles: {
        Row: {
          activity_recommendation_json: Json | null
          created_at: string
          final_calories: number
          final_carbs_g: number
          final_fat_g: number
          final_fiber_g: number
          final_protein_g: number
          generated_at: string
          goal_id: string | null
          id: string
          locked_at: string | null
          locked_by: string | null
          model: string
          parsed_output_json: NonNullable<Json>
          period_end: string | null
          period_start: string
          previous_cycle_id: string | null
          processing_month: string
          processing_user_id: string
          prompt_version: string
          provider: string
          recommended_calories: number
          recommended_carbs_g: number
          recommended_fat_g: number
          recommended_fiber_g: number
          recommended_protein_g: number
          review_deadline: string
          status: Database['public']['Enums']['recommendation_cycle_status']
          updated_at: string
          user_id: string
          workout_days_per_week: number
          workout_plan_json: NonNullable<Json>
        }
        Insert: {
          activity_recommendation_json?: Json | null
          created_at?: string
          final_calories: number
          final_carbs_g: number
          final_fat_g: number
          final_fiber_g: number
          final_protein_g: number
          generated_at: string
          goal_id?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          model: string
          parsed_output_json: NonNullable<Json>
          period_end?: string | null
          period_start: string
          previous_cycle_id?: string | null
          processing_month: string
          processing_user_id: string
          prompt_version: string
          provider: string
          recommended_calories: number
          recommended_carbs_g: number
          recommended_fat_g: number
          recommended_fiber_g: number
          recommended_protein_g: number
          review_deadline: string
          status?: Database['public']['Enums']['recommendation_cycle_status']
          updated_at?: string
          user_id: string
          workout_days_per_week: number
          workout_plan_json: NonNullable<Json>
        }
        Update: {
          activity_recommendation_json?: Json | null
          created_at?: string
          final_calories?: number
          final_carbs_g?: number
          final_fat_g?: number
          final_fiber_g?: number
          final_protein_g?: number
          generated_at?: string
          goal_id?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          model?: string
          parsed_output_json?: NonNullable<Json>
          period_end?: string | null
          period_start?: string
          previous_cycle_id?: string | null
          processing_month?: string
          processing_user_id?: string
          prompt_version?: string
          provider?: string
          recommended_calories?: number
          recommended_carbs_g?: number
          recommended_fat_g?: number
          recommended_fiber_g?: number
          recommended_protein_g?: number
          review_deadline?: string
          status?: Database['public']['Enums']['recommendation_cycle_status']
          updated_at?: string
          user_id?: string
          workout_days_per_week?: number
          workout_plan_json?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: 'cycles_goal_fk'
            columns: ['goal_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'goals'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'cycles_previous_fk'
            columns: ['previous_cycle_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'recommendation_cycles'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'cycles_processing_user_fk'
            columns: ['processing_user_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'recommendation_processing_users'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'recommendation_cycles_locked_by_fkey'
            columns: ['locked_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'recommendation_cycles_locked_by_fkey'
            columns: ['locked_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'recommendation_cycles_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'recommendation_cycles_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      recommendation_feedback: {
        Row: {
          created_at: string
          feedback: string
          feedback_month: string
          id: string
          locked_at: string | null
          recommendation_cycle_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          feedback: string
          feedback_month: string
          id?: string
          locked_at?: string | null
          recommendation_cycle_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          feedback?: string
          feedback_month?: string
          id?: string
          locked_at?: string | null
          recommendation_cycle_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'feedback_cycle_fk'
            columns: ['recommendation_cycle_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'recommendation_cycles'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'recommendation_feedback_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'recommendation_feedback_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      recommendation_processing_runs: {
        Row: {
          batch_size: number | null
          budget_limit: number | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          currency: string
          failure_reason: string | null
          id: string
          model: string | null
          processing_month: string
          prompt_version: string | null
          provider: string | null
          started_at: string | null
          status: Database['public']['Enums']['processing_run_status']
          updated_at: string
        }
        Insert: {
          batch_size?: number | null
          budget_limit?: number | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          failure_reason?: string | null
          id?: string
          model?: string | null
          processing_month: string
          prompt_version?: string | null
          provider?: string | null
          started_at?: string | null
          status?: Database['public']['Enums']['processing_run_status']
          updated_at?: string
        }
        Update: {
          batch_size?: number | null
          budget_limit?: number | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          failure_reason?: string | null
          id?: string
          model?: string | null
          processing_month?: string
          prompt_version?: string | null
          provider?: string | null
          started_at?: string | null
          status?: Database['public']['Enums']['processing_run_status']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'recommendation_processing_runs_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'recommendation_processing_runs_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      recommendation_processing_users: {
        Row: {
          actual_cost: number | null
          attempt_number: number
          batch_number: number | null
          created_at: string
          currency: string
          estimated_cost: number | null
          failure_reason: string | null
          generated_at: string | null
          id: string
          input_schema_version: string | null
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          parsed_recommendation_json: Json | null
          processing_run_id: string
          prompt_version: string | null
          provider: string | null
          raw_input_json: Json | null
          raw_output_json: Json | null
          recommended_calories: number | null
          recommended_carbs_g: number | null
          recommended_fat_g: number | null
          recommended_fiber_g: number | null
          recommended_protein_g: number | null
          skip_reason: string | null
          started_at: string | null
          status: Database['public']['Enums']['processing_user_status']
          total_tokens: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          actual_cost?: number | null
          attempt_number?: number
          batch_number?: number | null
          created_at?: string
          currency?: string
          estimated_cost?: number | null
          failure_reason?: string | null
          generated_at?: string | null
          id?: string
          input_schema_version?: string | null
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          parsed_recommendation_json?: Json | null
          processing_run_id: string
          prompt_version?: string | null
          provider?: string | null
          raw_input_json?: Json | null
          raw_output_json?: Json | null
          recommended_calories?: number | null
          recommended_carbs_g?: number | null
          recommended_fat_g?: number | null
          recommended_fiber_g?: number | null
          recommended_protein_g?: number | null
          skip_reason?: string | null
          started_at?: string | null
          status?: Database['public']['Enums']['processing_user_status']
          total_tokens?: never
          updated_at?: string
          user_id: string
        }
        Update: {
          actual_cost?: number | null
          attempt_number?: number
          batch_number?: number | null
          created_at?: string
          currency?: string
          estimated_cost?: number | null
          failure_reason?: string | null
          generated_at?: string | null
          id?: string
          input_schema_version?: string | null
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          parsed_recommendation_json?: Json | null
          processing_run_id?: string
          prompt_version?: string | null
          provider?: string | null
          raw_input_json?: Json | null
          raw_output_json?: Json | null
          recommended_calories?: number | null
          recommended_carbs_g?: number | null
          recommended_fat_g?: number | null
          recommended_fiber_g?: number | null
          recommended_protein_g?: number | null
          skip_reason?: string | null
          started_at?: string | null
          status?: Database['public']['Enums']['processing_user_status']
          total_tokens?: never
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'recommendation_processing_users_processing_run_id_fkey'
            columns: ['processing_run_id']
            isOneToOne: false
            referencedRelation: 'recommendation_processing_runs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'recommendation_processing_users_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'recommendation_processing_users_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      steps_entries: {
        Row: {
          created_at: string
          created_by: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          entry_date: string
          id: string
          is_active: boolean
          is_deleted: boolean
          steps: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          entry_date: string
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          steps: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          entry_date?: string
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          steps?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'steps_entries_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'steps_entries_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'steps_entries_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'steps_entries_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'steps_entries_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'steps_entries_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      system_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value_json: NonNullable<Json>
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value_json: NonNullable<Json>
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value_json?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: 'system_settings_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'system_settings_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          role: Database['public']['Enums']['app_role']
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          role: Database['public']['Enums']['app_role']
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          role?: Database['public']['Enums']['app_role']
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_roles_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'user_roles_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_roles_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'user_roles_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      weight_measurements: {
        Row: {
          created_at: string
          created_by: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          inbody_report_id: string | null
          is_deleted: boolean
          measurement_date: string
          source: Database['public']['Enums']['measurement_source']
          updated_at: string
          user_id: string
          weight_kg: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          inbody_report_id?: string | null
          is_deleted?: boolean
          measurement_date: string
          source?: Database['public']['Enums']['measurement_source']
          updated_at?: string
          user_id: string
          weight_kg: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          inbody_report_id?: string | null
          is_deleted?: boolean
          measurement_date?: string
          source?: Database['public']['Enums']['measurement_source']
          updated_at?: string
          user_id?: string
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: 'weight_inbody_fk'
            columns: ['inbody_report_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'inbody_reports'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'weight_measurements_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'weight_measurements_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'weight_measurements_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'weight_measurements_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'weight_measurements_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'weight_measurements_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      workouts: {
        Row: {
          created_at: string
          created_by: string | null
          custom_name: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          duration_minutes: number
          estimated_calories: number
          final_calories: number | null
          id: string
          is_deleted: boolean
          is_locked: boolean
          locked_at: string | null
          manual_calories: number | null
          updated_at: string
          user_id: string
          workout_date: string
          workout_type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          custom_name?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          duration_minutes: number
          estimated_calories: number
          final_calories?: never
          id?: string
          is_deleted?: boolean
          is_locked?: boolean
          locked_at?: string | null
          manual_calories?: number | null
          updated_at?: string
          user_id: string
          workout_date: string
          workout_type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          custom_name?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          duration_minutes?: number
          estimated_calories?: number
          final_calories?: never
          id?: string
          is_deleted?: boolean
          is_locked?: boolean
          locked_at?: string | null
          manual_calories?: number | null
          updated_at?: string
          user_id?: string
          workout_date?: string
          workout_type?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workouts_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'workouts_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workouts_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'workouts_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workouts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'workouts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      active_activities: {
        Row: {
          activity_date: string | null
          activity_type: string | null
          created_at: string | null
          created_by: string | null
          custom_name: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          duration_minutes: number | null
          estimated_calories: number | null
          final_calories: number | null
          id: string | null
          is_deleted: boolean | null
          is_locked: boolean | null
          locked_at: string | null
          manual_calories: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          activity_date?: string | null
          activity_type?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_name?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          duration_minutes?: number | null
          estimated_calories?: number | null
          final_calories?: number | null
          id?: string | null
          is_deleted?: boolean | null
          is_locked?: boolean | null
          locked_at?: string | null
          manual_calories?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          activity_date?: string | null
          activity_type?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_name?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          duration_minutes?: number | null
          estimated_calories?: number | null
          final_calories?: number | null
          id?: string | null
          is_deleted?: boolean | null
          is_locked?: boolean | null
          locked_at?: string | null
          manual_calories?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'activities_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'activities_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'activities_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'activities_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'activities_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'activities_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      active_meal_items: {
        Row: {
          created_at: string | null
          created_by: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          food_item_id: string | null
          food_name_snapshot: string | null
          food_submission_id: string | null
          id: string | null
          is_deleted: boolean | null
          meal_id: string | null
          quantity: number | null
          snapshot_calories: number | null
          snapshot_carbs_g: number | null
          snapshot_fat_g: number | null
          snapshot_fiber_g: number | null
          snapshot_protein_g: number | null
          unit: string | null
          updated_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'meal_items_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'meal_items_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'meal_items_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'meal_items_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'meal_items_food_item_id_fkey'
            columns: ['food_item_id']
            isOneToOne: false
            referencedRelation: 'food_items'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'meal_items_meal_fk'
            columns: ['meal_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'active_meals'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'meal_items_meal_fk'
            columns: ['meal_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'meals'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'meal_items_submission_fk'
            columns: ['food_submission_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'food_submissions'
            referencedColumns: ['id', 'submitted_by']
          },
        ]
      }
      active_meals: {
        Row: {
          copied_from_meal_id: string | null
          created_at: string | null
          created_by: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string | null
          is_deleted: boolean | null
          is_locked: boolean | null
          locked_at: string | null
          meal_category: Database['public']['Enums']['meal_category'] | null
          meal_date: string | null
          meal_name: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          copied_from_meal_id?: string | null
          created_at?: string | null
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string | null
          is_deleted?: boolean | null
          is_locked?: boolean | null
          locked_at?: string | null
          meal_category?: Database['public']['Enums']['meal_category'] | null
          meal_date?: string | null
          meal_name?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          copied_from_meal_id?: string | null
          created_at?: string | null
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string | null
          is_deleted?: boolean | null
          is_locked?: boolean | null
          locked_at?: string | null
          meal_category?: Database['public']['Enums']['meal_category'] | null
          meal_date?: string | null
          meal_name?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'meals_copied_from_fk'
            columns: ['copied_from_meal_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'active_meals'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'meals_copied_from_fk'
            columns: ['copied_from_meal_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'meals'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'meals_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'meals_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'meals_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'meals_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'meals_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'meals_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      active_weight_measurements: {
        Row: {
          created_at: string | null
          created_by: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string | null
          inbody_report_id: string | null
          is_deleted: boolean | null
          measurement_date: string | null
          source: Database['public']['Enums']['measurement_source'] | null
          updated_at: string | null
          user_id: string | null
          weight_kg: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string | null
          inbody_report_id?: string | null
          is_deleted?: boolean | null
          measurement_date?: string | null
          source?: Database['public']['Enums']['measurement_source'] | null
          updated_at?: string | null
          user_id?: string | null
          weight_kg?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string | null
          inbody_report_id?: string | null
          is_deleted?: boolean | null
          measurement_date?: string | null
          source?: Database['public']['Enums']['measurement_source'] | null
          updated_at?: string | null
          user_id?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'weight_inbody_fk'
            columns: ['inbody_report_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'inbody_reports'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'weight_measurements_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'weight_measurements_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'weight_measurements_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'weight_measurements_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'weight_measurements_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'weight_measurements_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      active_workouts: {
        Row: {
          created_at: string | null
          created_by: string | null
          custom_name: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          duration_minutes: number | null
          estimated_calories: number | null
          final_calories: number | null
          id: string | null
          is_deleted: boolean | null
          is_locked: boolean | null
          locked_at: string | null
          manual_calories: number | null
          updated_at: string | null
          user_id: string | null
          workout_date: string | null
          workout_type: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          custom_name?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          duration_minutes?: number | null
          estimated_calories?: number | null
          final_calories?: number | null
          id?: string | null
          is_deleted?: boolean | null
          is_locked?: boolean | null
          locked_at?: string | null
          manual_calories?: number | null
          updated_at?: string | null
          user_id?: string | null
          workout_date?: string | null
          workout_type?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          custom_name?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          duration_minutes?: number | null
          estimated_calories?: number | null
          final_calories?: number | null
          id?: string | null
          is_deleted?: boolean | null
          is_locked?: boolean | null
          locked_at?: string | null
          manual_calories?: number | null
          updated_at?: string | null
          user_id?: string | null
          workout_date?: string | null
          workout_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'workouts_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'workouts_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workouts_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'workouts_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workouts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'workouts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      current_weights: {
        Row: {
          measurement_date: string | null
          source: Database['public']['Enums']['measurement_source'] | null
          user_id: string | null
          weight_kg: number | null
          weight_measurement_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'weight_measurements_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'weight_measurements_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      daily_steps: {
        Row: {
          created_at: string | null
          entry_date: string | null
          steps: number | null
          steps_entry_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          entry_date?: string | null
          steps?: number | null
          steps_entry_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          entry_date?: string | null
          steps?: number | null
          steps_entry_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'steps_entries_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profile_readiness'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'steps_entries_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profile_readiness: {
        Row: {
          is_profile_complete: boolean | null
          missing_fields: string[] | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_meal_items: { Args: { p_items: Json; p_meal_id: string }; Returns: number }
      auth_set_pin: {
        Args: { p_actor_id?: string; p_pin: string; p_user_id: string }
        Returns: undefined
      }
      auth_verify_pin: {
        Args: { p_phone: string; p_pin: string }
        Returns: {
          status: string
          user_id: string
        }[]
      }
      copy_meal: { Args: { p_source_meal_id: string; p_target_date: string }; Returns: string }
      daily_nutrition: {
        Args: { p_end: string; p_start: string }
        Returns: {
          calories: number
          carbs_g: number
          fat_g: number
          fiber_g: number
          item_count: number
          nutrition_date: string
          protein_g: number
        }[]
      }
      food_usage: {
        Args: { p_limit?: number; p_order?: string }
        Returns: {
          calories: number
          carbs_g: number
          fat_g: number
          fiber_g: number
          id: string
          is_approximate: boolean
          last_used: string
          name: string
          protein_g: number
          review_status: Database['public']['Enums']['food_review_status']
          serving_quantity: number
          serving_unit: string
          source: string
          use_count: number
        }[]
      }
      get_group_member_day: {
        Args: { p_date: string; p_group_id: string }
        Returns: {
          calories: number
          calories_target: number
          group_role: Database['public']['Enums']['group_role']
          name: string
          protein_g: number
          protein_target_g: number
          steps: number
          user_id: string
          workout_logged: boolean
        }[]
      }
      log_activity: {
        Args: {
          p_date: string
          p_duration_minutes: number
          p_manual_calories?: number
          p_name?: string
          p_type: string
        }
        Returns: string
      }
      log_meal: {
        Args: {
          p_copied_from_meal_id?: string
          p_items: Json
          p_meal_category?: Database['public']['Enums']['meal_category']
          p_meal_date: string
          p_meal_name?: string
        }
        Returns: string
      }
      log_workout: {
        Args: {
          p_date: string
          p_duration_minutes: number
          p_manual_calories?: number
          p_name?: string
          p_type: string
        }
        Returns: string
      }
      save_onboarding_measurements: {
        Args: { p_height_cm: number; p_weight_kg: number }
        Returns: undefined
      }
      search_foods: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          calories: number
          carbs_g: number
          fat_g: number
          fiber_g: number
          id: string
          is_approximate: boolean
          last_used: string
          match_rank: number
          name: string
          protein_g: number
          review_status: Database['public']['Enums']['food_review_status']
          serving_quantity: number
          serving_unit: string
          similarity: number
          source: string
          use_count: number
        }[]
      }
      training_calorie_rates: { Args: Record<PropertyKey, never>; Returns: Json }
    }
    Enums: {
      activity_level:
        'SEDENTARY' | 'LIGHTLY_ACTIVE' | 'MODERATELY_ACTIVE' | 'VERY_ACTIVE' | 'EXTREMELY_ACTIVE'
      app_role: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'USER'
      audit_action:
        | 'CREATE'
        | 'UPDATE'
        | 'DELETE'
        | 'RESTORE'
        | 'LOCK'
        | 'UNLOCK'
        | 'PIN_RESET'
        | 'ROLE_CHANGE'
        | 'ADMIN_CORRECTION'
      food_review_status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'
      gender: 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY'
      group_role: 'MEMBER' | 'LEADER' | 'ADMIN'
      inbody_extraction_status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
      meal_category: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACKS'
      measurement_source: 'MANUAL' | 'INBODY'
      processing_run_status:
        'CREATED' | 'RUNNING' | 'PARTIAL' | 'COMPLETED' | 'STOPPED_BUDGET' | 'FAILED'
      processing_user_status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'SKIPPED'
      recommendation_cycle_status: 'IN_REVIEW' | 'LOCKED' | 'REPLACED'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_level: [
        'SEDENTARY',
        'LIGHTLY_ACTIVE',
        'MODERATELY_ACTIVE',
        'VERY_ACTIVE',
        'EXTREMELY_ACTIVE',
      ],
      app_role: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'USER'],
      audit_action: [
        'CREATE',
        'UPDATE',
        'DELETE',
        'RESTORE',
        'LOCK',
        'UNLOCK',
        'PIN_RESET',
        'ROLE_CHANGE',
        'ADMIN_CORRECTION',
      ],
      food_review_status: ['PENDING_REVIEW', 'APPROVED', 'REJECTED'],
      gender: ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'],
      group_role: ['MEMBER', 'LEADER', 'ADMIN'],
      inbody_extraction_status: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
      meal_category: ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS'],
      measurement_source: ['MANUAL', 'INBODY'],
      processing_run_status: [
        'CREATED',
        'RUNNING',
        'PARTIAL',
        'COMPLETED',
        'STOPPED_BUDGET',
        'FAILED',
      ],
      processing_user_status: ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'SKIPPED'],
      recommendation_cycle_status: ['IN_REVIEW', 'LOCKED', 'REPLACED'],
    },
  },
} as const
