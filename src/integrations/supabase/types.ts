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
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          account_name: string
          account_owner: string | null
          company_type: string | null
          country: string | null
          created_by: string | null
          created_time: string | null
          currency: string | null
          description: string | null
          id: string
          industry: string | null
          last_activity_time: string | null
          modified_by: string | null
          modified_time: string | null
          phone: string | null
          region: string | null
          status: string | null
          tags: string[] | null
          website: string | null
        }
        Insert: {
          account_name: string
          account_owner?: string | null
          company_type?: string | null
          country?: string | null
          created_by?: string | null
          created_time?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          industry?: string | null
          last_activity_time?: string | null
          modified_by?: string | null
          modified_time?: string | null
          phone?: string | null
          region?: string | null
          status?: string | null
          tags?: string[] | null
          website?: string | null
        }
        Update: {
          account_name?: string
          account_owner?: string | null
          company_type?: string | null
          country?: string | null
          created_by?: string | null
          created_time?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          industry?: string | null
          last_activity_time?: string | null
          modified_by?: string | null
          modified_time?: string | null
          phone?: string | null
          region?: string | null
          status?: string | null
          tags?: string[] | null
          website?: string | null
        }
        Relationships: []
      }
      action_items: {
        Row: {
          archived_at: string | null
          assigned_to: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          due_time: string | null
          id: string
          module_id: string | null
          module_type: string
          priority: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assigned_to?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          id?: string
          module_id?: string | null
          module_type: string
          priority?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          id?: string
          module_id?: string | null
          module_type?: string
          priority?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      backup_schedules: {
        Row: {
          backup_module: string | null
          backup_scope: string
          created_at: string
          created_by: string | null
          frequency: string
          id: string
          is_enabled: boolean
          last_run_at: string | null
          next_run_at: string | null
          time_of_day: string
          updated_at: string
        }
        Insert: {
          backup_module?: string | null
          backup_scope?: string
          created_at?: string
          created_by?: string | null
          frequency?: string
          id?: string
          is_enabled?: boolean
          last_run_at?: string | null
          next_run_at?: string | null
          time_of_day?: string
          updated_at?: string
        }
        Update: {
          backup_module?: string | null
          backup_scope?: string
          created_at?: string
          created_by?: string | null
          frequency?: string
          id?: string
          is_enabled?: boolean
          last_run_at?: string | null
          next_run_at?: string | null
          time_of_day?: string
          updated_at?: string
        }
        Relationships: []
      }
      backups: {
        Row: {
          backup_type: string
          created_at: string
          created_by: string | null
          file_name: string
          file_path: string
          id: string
          manifest: Json | null
          module_name: string | null
          records_count: number | null
          size_bytes: number | null
          status: string
          tables_count: number | null
        }
        Insert: {
          backup_type?: string
          created_at?: string
          created_by?: string | null
          file_name: string
          file_path: string
          id?: string
          manifest?: Json | null
          module_name?: string | null
          records_count?: number | null
          size_bytes?: number | null
          status?: string
          tables_count?: number | null
        }
        Update: {
          backup_type?: string
          created_at?: string
          created_by?: string | null
          file_name?: string
          file_path?: string
          id?: string
          manifest?: Json | null
          module_name?: string | null
          records_count?: number | null
          size_bytes?: number | null
          status?: string
          tables_count?: number | null
        }
        Relationships: []
      }
      campaign_accounts: {
        Row: {
          account_id: string
          campaign_id: string
          created_at: string | null
          created_by: string | null
          id: string
          status: string | null
        }
        Insert: {
          account_id: string
          campaign_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          status?: string | null
        }
        Update: {
          account_id?: string
          campaign_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_accounts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_audience_personas: {
        Row: {
          created_at: string | null
          created_by: string | null
          criteria: Json
          id: string
          persona_name: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          criteria?: Json
          id?: string
          persona_name: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          criteria?: Json
          id?: string
          persona_name?: string
        }
        Relationships: []
      }
      campaign_audience_segments: {
        Row: {
          campaign_id: string
          created_at: string
          created_by: string | null
          filters: Json
          id: string
          segment_name: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          created_by?: string | null
          filters?: Json
          id?: string
          segment_name: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          created_by?: string | null
          filters?: Json
          id?: string
          segment_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      campaign_communications: {
        Row: {
          account_id: string | null
          body: string | null
          bounce_reason: string | null
          bounce_type: string | null
          bounced_at: string | null
          call_outcome: string | null
          campaign_id: string
          communication_date: string | null
          communication_type: string
          contact_id: string | null
          conversation_id: string | null
          created_at: string | null
          created_by: string | null
          delivery_status: string | null
          email_status: string | null
          email_type: string | null
          follow_up_attempt: number
          follow_up_parent_id: string | null
          graph_message_id: string | null
          id: string
          internet_message_id: string | null
          last_opened_at: string | null
          linkedin_status: string | null
          message_id: string | null
          notes: string | null
          open_count: number
          opened_at: string | null
          outcome: string | null
          owner: string | null
          parent_id: string | null
          sent_via: string | null
          subject: string | null
          template_id: string | null
          thread_id: string | null
          tracking_id: string | null
          variant_id: string | null
        }
        Insert: {
          account_id?: string | null
          body?: string | null
          bounce_reason?: string | null
          bounce_type?: string | null
          bounced_at?: string | null
          call_outcome?: string | null
          campaign_id: string
          communication_date?: string | null
          communication_type: string
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string | null
          created_by?: string | null
          delivery_status?: string | null
          email_status?: string | null
          email_type?: string | null
          follow_up_attempt?: number
          follow_up_parent_id?: string | null
          graph_message_id?: string | null
          id?: string
          internet_message_id?: string | null
          last_opened_at?: string | null
          linkedin_status?: string | null
          message_id?: string | null
          notes?: string | null
          open_count?: number
          opened_at?: string | null
          outcome?: string | null
          owner?: string | null
          parent_id?: string | null
          sent_via?: string | null
          subject?: string | null
          template_id?: string | null
          thread_id?: string | null
          tracking_id?: string | null
          variant_id?: string | null
        }
        Update: {
          account_id?: string | null
          body?: string | null
          bounce_reason?: string | null
          bounce_type?: string | null
          bounced_at?: string | null
          call_outcome?: string | null
          campaign_id?: string
          communication_date?: string | null
          communication_type?: string
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string | null
          created_by?: string | null
          delivery_status?: string | null
          email_status?: string | null
          email_type?: string | null
          follow_up_attempt?: number
          follow_up_parent_id?: string | null
          graph_message_id?: string | null
          id?: string
          internet_message_id?: string | null
          last_opened_at?: string | null
          linkedin_status?: string | null
          message_id?: string | null
          notes?: string | null
          open_count?: number
          opened_at?: string | null
          outcome?: string | null
          owner?: string | null
          parent_id?: string | null
          sent_via?: string | null
          subject?: string | null
          template_id?: string | null
          thread_id?: string | null
          tracking_id?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_communications_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_communications_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_communications_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_communications_follow_up_parent_id_fkey"
            columns: ["follow_up_parent_id"]
            isOneToOne: false
            referencedRelation: "campaign_communications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_communications_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "campaign_communications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_communications_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "campaign_email_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_communications_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "campaign_email_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_contacts: {
        Row: {
          account_id: string | null
          campaign_id: string
          contact_id: string
          created_at: string | null
          created_by: string | null
          id: string
          linkedin_status: string | null
          stage: string | null
        }
        Insert: {
          account_id?: string | null
          campaign_id: string
          contact_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          linkedin_status?: string | null
          stage?: string | null
        }
        Update: {
          account_id?: string | null
          campaign_id?: string
          contact_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          linkedin_status?: string | null
          stage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_contacts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_email_templates: {
        Row: {
          audience_segment: string | null
          body: string | null
          campaign_id: string | null
          created_at: string | null
          created_by: string | null
          email_type: string | null
          id: string
          region: string | null
          segment_id: string | null
          subject: string | null
          template_name: string
        }
        Insert: {
          audience_segment?: string | null
          body?: string | null
          campaign_id?: string | null
          created_at?: string | null
          created_by?: string | null
          email_type?: string | null
          id?: string
          region?: string | null
          segment_id?: string | null
          subject?: string | null
          template_name: string
        }
        Update: {
          audience_segment?: string | null
          body?: string | null
          campaign_id?: string | null
          created_at?: string | null
          created_by?: string | null
          email_type?: string | null
          id?: string
          region?: string | null
          segment_id?: string | null
          subject?: string | null
          template_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_email_templates_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_email_templates_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "campaign_audience_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_email_variants: {
        Row: {
          body: string
          click_count: number
          created_at: string
          created_by: string | null
          id: string
          is_winner: boolean
          open_count: number
          reply_count: number
          sent_count: number
          subject: string
          template_id: string
          updated_at: string
          variant_label: string
        }
        Insert: {
          body: string
          click_count?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_winner?: boolean
          open_count?: number
          reply_count?: number
          sent_count?: number
          subject: string
          template_id: string
          updated_at?: string
          variant_label: string
        }
        Update: {
          body?: string
          click_count?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_winner?: boolean
          open_count?: number
          reply_count?: number
          sent_count?: number
          subject?: string
          template_id?: string
          updated_at?: string
          variant_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_email_variants_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "campaign_email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_follow_up_rules: {
        Row: {
          campaign_id: string
          created_at: string
          created_by: string | null
          id: string
          is_enabled: boolean
          max_attempts: number
          template_id: string | null
          trigger_event: string
          updated_at: string
          wait_business_days: number
        }
        Insert: {
          campaign_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_enabled?: boolean
          max_attempts?: number
          template_id?: string | null
          trigger_event?: string
          updated_at?: string
          wait_business_days?: number
        }
        Update: {
          campaign_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_enabled?: boolean
          max_attempts?: number
          template_id?: string | null
          trigger_event?: string
          updated_at?: string
          wait_business_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaign_follow_up_rules_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_follow_up_rules_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "campaign_email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_mart: {
        Row: {
          audience_done: boolean
          campaign_id: string
          created_at: string
          message_done: boolean
          region_done: boolean
          timing_done: boolean
          timing_notes: string | null
          updated_at: string
        }
        Insert: {
          audience_done?: boolean
          campaign_id: string
          created_at?: string
          message_done?: boolean
          region_done?: boolean
          timing_done?: boolean
          timing_notes?: string | null
          updated_at?: string
        }
        Update: {
          audience_done?: boolean
          campaign_id?: string
          created_at?: string
          message_done?: boolean
          region_done?: boolean
          timing_done?: boolean
          timing_notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_mart_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_materials: {
        Row: {
          campaign_id: string
          created_at: string | null
          created_by: string | null
          file_name: string
          file_path: string
          file_type: string | null
          id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string | null
          created_by?: string | null
          file_name: string
          file_path: string
          file_type?: string | null
          id?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string | null
          created_by?: string | null
          file_name?: string
          file_path?: string
          file_type?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_materials_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_phone_scripts: {
        Row: {
          audience_segment: string | null
          campaign_id: string | null
          created_at: string | null
          created_by: string | null
          discovery_questions: string | null
          id: string
          key_talking_points: string | null
          objection_handling: string | null
          opening_script: string | null
          script_name: string | null
        }
        Insert: {
          audience_segment?: string | null
          campaign_id?: string | null
          created_at?: string | null
          created_by?: string | null
          discovery_questions?: string | null
          id?: string
          key_talking_points?: string | null
          objection_handling?: string | null
          opening_script?: string | null
          script_name?: string | null
        }
        Update: {
          audience_segment?: string | null
          campaign_id?: string | null
          created_at?: string | null
          created_by?: string | null
          discovery_questions?: string | null
          id?: string
          key_talking_points?: string | null
          objection_handling?: string | null
          opening_script?: string | null
          script_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_phone_scripts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_settings: {
        Row: {
          id: string
          setting_key: string
          setting_value: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          setting_key: string
          setting_value: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          setting_key?: string
          setting_value?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      campaign_timing_windows: {
        Row: {
          campaign_id: string
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          notes: string | null
          priority: string
          start_date: string
          window_name: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          notes?: string | null
          priority?: string
          start_date: string
          window_name: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          notes?: string | null
          priority?: string
          start_date?: string
          window_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_timing_windows_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          campaign_name: string
          campaign_type: string | null
          country: string | null
          created_at: string | null
          created_by: string
          description: string | null
          enabled_channels: string[] | null
          end_date: string | null
          goal: string | null
          id: string
          mart_complete: boolean
          message_strategy: string | null
          modified_at: string | null
          modified_by: string | null
          notes: string | null
          owner: string | null
          primary_channel: string | null
          priority: string | null
          region: string | null
          slug: string | null
          start_date: string | null
          status: string | null
          tags: string[] | null
          target_audience: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          campaign_name: string
          campaign_type?: string | null
          country?: string | null
          created_at?: string | null
          created_by: string
          description?: string | null
          enabled_channels?: string[] | null
          end_date?: string | null
          goal?: string | null
          id?: string
          mart_complete?: boolean
          message_strategy?: string | null
          modified_at?: string | null
          modified_by?: string | null
          notes?: string | null
          owner?: string | null
          primary_channel?: string | null
          priority?: string | null
          region?: string | null
          slug?: string | null
          start_date?: string | null
          status?: string | null
          tags?: string[] | null
          target_audience?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          campaign_name?: string
          campaign_type?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string
          description?: string | null
          enabled_channels?: string[] | null
          end_date?: string | null
          goal?: string | null
          id?: string
          mart_complete?: boolean
          message_strategy?: string | null
          modified_at?: string | null
          modified_by?: string | null
          notes?: string | null
          owner?: string | null
          primary_channel?: string | null
          priority?: string | null
          region?: string | null
          slug?: string | null
          start_date?: string | null
          status?: string | null
          tags?: string[] | null
          target_audience?: string | null
        }
        Relationships: []
      }
      column_preferences: {
        Row: {
          column_widths: Json
          created_at: string
          id: string
          module: string
          updated_at: string
          user_id: string
        }
        Insert: {
          column_widths?: Json
          created_at?: string
          id?: string
          module: string
          updated_at?: string
          user_id: string
        }
        Update: {
          column_widths?: Json
          created_at?: string
          id?: string
          module?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          company_name: string | null
          contact_name: string
          contact_owner: string | null
          contact_source: string | null
          created_by: string | null
          created_time: string | null
          description: string | null
          email: string | null
          id: string
          industry: string | null
          last_activity_time: string | null
          linkedin: string | null
          modified_by: string | null
          modified_time: string | null
          phone_no: string | null
          position: string | null
          region: string | null
          website: string | null
        }
        Insert: {
          company_name?: string | null
          contact_name: string
          contact_owner?: string | null
          contact_source?: string | null
          created_by?: string | null
          created_time?: string | null
          description?: string | null
          email?: string | null
          id?: string
          industry?: string | null
          last_activity_time?: string | null
          linkedin?: string | null
          modified_by?: string | null
          modified_time?: string | null
          phone_no?: string | null
          position?: string | null
          region?: string | null
          website?: string | null
        }
        Update: {
          company_name?: string | null
          contact_name?: string
          contact_owner?: string | null
          contact_source?: string | null
          created_by?: string | null
          created_time?: string | null
          description?: string | null
          email?: string | null
          id?: string
          industry?: string | null
          last_activity_time?: string | null
          linkedin?: string | null
          modified_by?: string | null
          modified_time?: string | null
          phone_no?: string | null
          position?: string | null
          region?: string | null
          website?: string | null
        }
        Relationships: []
      }
      dashboard_preferences: {
        Row: {
          card_order: Json | null
          created_at: string | null
          id: string
          layout_view: string | null
          updated_at: string | null
          user_id: string
          visible_widgets: Json | null
        }
        Insert: {
          card_order?: Json | null
          created_at?: string | null
          id?: string
          layout_view?: string | null
          updated_at?: string | null
          user_id: string
          visible_widgets?: Json | null
        }
        Update: {
          card_order?: Json | null
          created_at?: string | null
          id?: string
          layout_view?: string | null
          updated_at?: string | null
          user_id?: string
          visible_widgets?: Json | null
        }
        Relationships: []
      }
      deal_action_items: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string | null
          deal_id: string
          due_date: string | null
          id: string
          next_action: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          deal_id: string
          due_date?: string | null
          id?: string
          next_action: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string
          due_date?: string | null
          id?: string
          next_action?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_action_items_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_stakeholders: {
        Row: {
          contact_id: string
          created_at: string | null
          created_by: string | null
          deal_id: string
          id: string
          note: string | null
          role: string
        }
        Insert: {
          contact_id: string
          created_at?: string | null
          created_by?: string | null
          deal_id: string
          id?: string
          note?: string | null
          role: string
        }
        Update: {
          contact_id?: string
          created_at?: string | null
          created_by?: string | null
          deal_id?: string
          id?: string
          note?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_stakeholders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_stakeholders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          account_id: string | null
          action_items: string | null
          budget: string | null
          budget_owner_contact_id: string | null
          business_value: string | null
          campaign_id: string | null
          champion_contact_id: string | null
          closing: string | null
          created_at: string | null
          created_by: string
          currency_type: string | null
          current_status: string | null
          customer_challenges: string | null
          customer_name: string | null
          customer_need: string | null
          deal_name: string
          decision_maker_level: string | null
          drop_reason: string | null
          end_date: string | null
          expected_closing_date: string | null
          handoff_status: string | null
          id: string
          implementation_start_date: string | null
          influencer_contact_id: string | null
          internal_comment: string | null
          is_recurring: string | null
          lead_name: string | null
          lead_owner: string | null
          lost_reason: string | null
          modified_at: string | null
          modified_by: string | null
          need_improvement: string | null
          objector_contact_id: string | null
          priority: number | null
          probability: number | null
          project_duration: number | null
          project_name: string | null
          proposal_due_date: string | null
          quarterly_revenue_q1: number | null
          quarterly_revenue_q2: number | null
          quarterly_revenue_q3: number | null
          quarterly_revenue_q4: number | null
          region: string | null
          relationship_strength: string | null
          rfq_received_date: string | null
          rfq_status: string | null
          signed_contract_date: string | null
          source_campaign_contact_id: string | null
          stage: string
          start_date: string | null
          total_contract_value: number | null
          total_revenue: number | null
          won_reason: string | null
        }
        Insert: {
          account_id?: string | null
          action_items?: string | null
          budget?: string | null
          budget_owner_contact_id?: string | null
          business_value?: string | null
          campaign_id?: string | null
          champion_contact_id?: string | null
          closing?: string | null
          created_at?: string | null
          created_by: string
          currency_type?: string | null
          current_status?: string | null
          customer_challenges?: string | null
          customer_name?: string | null
          customer_need?: string | null
          deal_name: string
          decision_maker_level?: string | null
          drop_reason?: string | null
          end_date?: string | null
          expected_closing_date?: string | null
          handoff_status?: string | null
          id?: string
          implementation_start_date?: string | null
          influencer_contact_id?: string | null
          internal_comment?: string | null
          is_recurring?: string | null
          lead_name?: string | null
          lead_owner?: string | null
          lost_reason?: string | null
          modified_at?: string | null
          modified_by?: string | null
          need_improvement?: string | null
          objector_contact_id?: string | null
          priority?: number | null
          probability?: number | null
          project_duration?: number | null
          project_name?: string | null
          proposal_due_date?: string | null
          quarterly_revenue_q1?: number | null
          quarterly_revenue_q2?: number | null
          quarterly_revenue_q3?: number | null
          quarterly_revenue_q4?: number | null
          region?: string | null
          relationship_strength?: string | null
          rfq_received_date?: string | null
          rfq_status?: string | null
          signed_contract_date?: string | null
          source_campaign_contact_id?: string | null
          stage?: string
          start_date?: string | null
          total_contract_value?: number | null
          total_revenue?: number | null
          won_reason?: string | null
        }
        Update: {
          account_id?: string | null
          action_items?: string | null
          budget?: string | null
          budget_owner_contact_id?: string | null
          business_value?: string | null
          campaign_id?: string | null
          champion_contact_id?: string | null
          closing?: string | null
          created_at?: string | null
          created_by?: string
          currency_type?: string | null
          current_status?: string | null
          customer_challenges?: string | null
          customer_name?: string | null
          customer_need?: string | null
          deal_name?: string
          decision_maker_level?: string | null
          drop_reason?: string | null
          end_date?: string | null
          expected_closing_date?: string | null
          handoff_status?: string | null
          id?: string
          implementation_start_date?: string | null
          influencer_contact_id?: string | null
          internal_comment?: string | null
          is_recurring?: string | null
          lead_name?: string | null
          lead_owner?: string | null
          lost_reason?: string | null
          modified_at?: string | null
          modified_by?: string | null
          need_improvement?: string | null
          objector_contact_id?: string | null
          priority?: number | null
          probability?: number | null
          project_duration?: number | null
          project_name?: string | null
          proposal_due_date?: string | null
          quarterly_revenue_q1?: number | null
          quarterly_revenue_q2?: number | null
          quarterly_revenue_q3?: number | null
          quarterly_revenue_q4?: number | null
          region?: string | null
          relationship_strength?: string | null
          rfq_received_date?: string | null
          rfq_status?: string | null
          signed_contract_date?: string | null
          source_campaign_contact_id?: string | null
          stage?: string
          start_date?: string | null
          total_contract_value?: number | null
          total_revenue?: number | null
          won_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_source_campaign_contact_id_fkey"
            columns: ["source_campaign_contact_id"]
            isOneToOne: false
            referencedRelation: "campaign_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      email_history: {
        Row: {
          account_id: string | null
          body: string | null
          bounce_reason: string | null
          bounce_type: string | null
          bounced_at: string | null
          click_count: number | null
          clicked_at: string | null
          contact_id: string | null
          created_at: string | null
          delivered_at: string | null
          id: string
          internet_message_id: string | null
          is_valid_open: boolean | null
          last_reply_at: string | null
          lead_id: string | null
          open_count: number | null
          opened_at: string | null
          recipient_email: string
          recipient_name: string | null
          replied_at: string | null
          reply_count: number | null
          sender_email: string
          sent_at: string
          sent_by: string | null
          status: string
          subject: string
          unique_opens: number | null
        }
        Insert: {
          account_id?: string | null
          body?: string | null
          bounce_reason?: string | null
          bounce_type?: string | null
          bounced_at?: string | null
          click_count?: number | null
          clicked_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          delivered_at?: string | null
          id?: string
          internet_message_id?: string | null
          is_valid_open?: boolean | null
          last_reply_at?: string | null
          lead_id?: string | null
          open_count?: number | null
          opened_at?: string | null
          recipient_email: string
          recipient_name?: string | null
          replied_at?: string | null
          reply_count?: number | null
          sender_email: string
          sent_at?: string
          sent_by?: string | null
          status?: string
          subject: string
          unique_opens?: number | null
        }
        Update: {
          account_id?: string | null
          body?: string | null
          bounce_reason?: string | null
          bounce_type?: string | null
          bounced_at?: string | null
          click_count?: number | null
          clicked_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          delivered_at?: string | null
          id?: string
          internet_message_id?: string | null
          is_valid_open?: boolean | null
          last_reply_at?: string | null
          lead_id?: string | null
          open_count?: number | null
          opened_at?: string | null
          recipient_email?: string
          recipient_name?: string | null
          replied_at?: string | null
          reply_count?: number | null
          sender_email?: string
          sent_at?: string
          sent_by?: string | null
          status?: string
          subject?: string
          unique_opens?: number | null
        }
        Relationships: []
      }
      email_reply_skip_log: {
        Row: {
          campaign_id: string | null
          contact_email: string | null
          contact_id: string | null
          conversation_id: string | null
          correlation_id: string | null
          created_at: string
          details: Json
          id: string
          parent_communication_id: string | null
          parent_sent_at: string | null
          parent_subject: string | null
          received_at: string | null
          sender_email: string | null
          skip_reason: string
          subject: string | null
        }
        Insert: {
          campaign_id?: string | null
          contact_email?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          correlation_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          parent_communication_id?: string | null
          parent_sent_at?: string | null
          parent_subject?: string | null
          received_at?: string | null
          sender_email?: string | null
          skip_reason: string
          subject?: string | null
        }
        Update: {
          campaign_id?: string | null
          contact_email?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          correlation_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          parent_communication_id?: string | null
          parent_sent_at?: string | null
          parent_subject?: string | null
          received_at?: string | null
          sender_email?: string | null
          skip_reason?: string
          subject?: string | null
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          body: string
          created_at: string | null
          created_by: string | null
          id: string
          name: string
          subject: string
          updated_at: string | null
        }
        Insert: {
          body: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          name: string
          subject: string
          updated_at?: string | null
        }
        Update: {
          body?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string
          subject?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      keep_alive: {
        Row: {
          "Able to read DB": string | null
          created_at: string
          id: number
          last_ping: string | null
        }
        Insert: {
          "Able to read DB"?: string | null
          created_at?: string
          id?: number
          last_ping?: string | null
        }
        Update: {
          "Able to read DB"?: string | null
          created_at?: string
          id?: number
          last_ping?: string | null
        }
        Relationships: []
      }
      lead_action_items: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          lead_id: string
          next_action: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          lead_id: string
          next_action: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          lead_id?: string
          next_action?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          account_id: string | null
          company_name: string | null
          contact_owner: string | null
          contact_source: string | null
          country: string | null
          created_by: string | null
          created_time: string | null
          description: string | null
          email: string | null
          id: string
          industry: string | null
          lead_name: string
          lead_status: string | null
          linkedin: string | null
          modified_by: string | null
          modified_time: string | null
          phone_no: string | null
          position: string | null
          website: string | null
        }
        Insert: {
          account_id?: string | null
          company_name?: string | null
          contact_owner?: string | null
          contact_source?: string | null
          country?: string | null
          created_by?: string | null
          created_time?: string | null
          description?: string | null
          email?: string | null
          id?: string
          industry?: string | null
          lead_name: string
          lead_status?: string | null
          linkedin?: string | null
          modified_by?: string | null
          modified_time?: string | null
          phone_no?: string | null
          position?: string | null
          website?: string | null
        }
        Update: {
          account_id?: string | null
          company_name?: string | null
          contact_owner?: string | null
          contact_source?: string | null
          country?: string | null
          created_by?: string | null
          created_time?: string | null
          description?: string | null
          email?: string | null
          id?: string
          industry?: string | null
          lead_name?: string
          lead_status?: string | null
          linkedin?: string | null
          modified_by?: string | null
          modified_time?: string | null
          phone_no?: string | null
          position?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          accounts_notifications: boolean | null
          contacts_notifications: boolean | null
          created_at: string | null
          daily_reminder_time: string | null
          deal_updates: boolean | null
          email_notifications: boolean | null
          id: string
          in_app_notifications: boolean | null
          last_reminder_sent_at: string | null
          lead_assigned: boolean | null
          leads_notifications: boolean | null
          meeting_reminders: boolean | null
          notification_frequency: string | null
          push_notifications: boolean | null
          task_reminders: boolean | null
          updated_at: string | null
          user_id: string
          weekly_digest: boolean | null
        }
        Insert: {
          accounts_notifications?: boolean | null
          contacts_notifications?: boolean | null
          created_at?: string | null
          daily_reminder_time?: string | null
          deal_updates?: boolean | null
          email_notifications?: boolean | null
          id?: string
          in_app_notifications?: boolean | null
          last_reminder_sent_at?: string | null
          lead_assigned?: boolean | null
          leads_notifications?: boolean | null
          meeting_reminders?: boolean | null
          notification_frequency?: string | null
          push_notifications?: boolean | null
          task_reminders?: boolean | null
          updated_at?: string | null
          user_id: string
          weekly_digest?: boolean | null
        }
        Update: {
          accounts_notifications?: boolean | null
          contacts_notifications?: boolean | null
          created_at?: string | null
          daily_reminder_time?: string | null
          deal_updates?: boolean | null
          email_notifications?: boolean | null
          id?: string
          in_app_notifications?: boolean | null
          last_reminder_sent_at?: string | null
          lead_assigned?: boolean | null
          leads_notifications?: boolean | null
          meeting_reminders?: boolean | null
          notification_frequency?: string | null
          push_notifications?: boolean | null
          task_reminders?: boolean | null
          updated_at?: string | null
          user_id?: string
          weekly_digest?: boolean | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          action_item_id: string | null
          created_at: string
          id: string
          lead_id: string | null
          message: string
          module_id: string | null
          module_type: string | null
          notification_type: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_item_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          message: string
          module_id?: string | null
          module_type?: string | null
          notification_type?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_item_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          message?: string
          module_id?: string | null
          module_type?: string | null
          notification_type?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      page_permissions: {
        Row: {
          admin_access: boolean | null
          created_at: string | null
          description: string | null
          field_sales_access: boolean | null
          id: string
          inside_sales_access: boolean | null
          manager_access: boolean | null
          page_name: string
          route: string
          sales_head_access: boolean | null
          super_admin_access: boolean | null
          updated_at: string | null
          user_access: boolean | null
        }
        Insert: {
          admin_access?: boolean | null
          created_at?: string | null
          description?: string | null
          field_sales_access?: boolean | null
          id?: string
          inside_sales_access?: boolean | null
          manager_access?: boolean | null
          page_name: string
          route: string
          sales_head_access?: boolean | null
          super_admin_access?: boolean | null
          updated_at?: string | null
          user_access?: boolean | null
        }
        Update: {
          admin_access?: boolean | null
          created_at?: string | null
          description?: string | null
          field_sales_access?: boolean | null
          id?: string
          inside_sales_access?: boolean | null
          manager_access?: boolean | null
          page_name?: string
          route?: string
          sales_head_access?: boolean | null
          super_admin_access?: boolean | null
          updated_at?: string | null
          user_access?: boolean | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          "Email ID": string | null
          full_name: string | null
          id: string
          phone: string | null
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          "Email ID"?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          "Email ID"?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      saved_filters: {
        Row: {
          created_at: string
          filter_type: string
          filters: Json
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filter_type?: string
          filters: Json
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          filter_type?: string
          filters?: Json
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      security_audit_log: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          id: string
          ip_address: unknown
          resource_id: string | null
          resource_type: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: unknown
          resource_id?: string | null
          resource_type: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: unknown
          resource_id?: string | null
          resource_type?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          created_at: string | null
          currency: string | null
          date_format: string | null
          default_module: string | null
          id: string
          theme: string | null
          time_format: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          date_format?: string | null
          default_module?: string | null
          id?: string
          theme?: string | null
          time_format?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          date_format?: string | null
          default_module?: string | null
          id?: string
          theme?: string | null
          time_format?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          id: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          created_at: string | null
          device_info: Json | null
          id: string
          is_active: boolean | null
          last_active_at: string | null
          session_token: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          device_info?: Json | null
          id?: string
          is_active?: boolean | null
          last_active_at?: string | null
          session_token: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          device_info?: Json | null
          id?: string
          is_active?: boolean | null
          last_active_at?: string | null
          session_token?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      yearly_revenue_targets: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          total_target: number
          updated_at: string
          year: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          total_target?: number
          updated_at?: string
          year: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          total_target?: number
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      archive_completed_action_items: { Args: never; Returns: number }
      auto_complete_campaigns: { Args: never; Returns: number }
      can_manage_campaign: { Args: { _campaign_id: string }; Returns: boolean }
      can_view_campaign: { Args: { _campaign_id: string }; Returns: boolean }
      can_view_deal: { Args: { _deal_id: string }; Returns: boolean }
      can_view_lead: { Args: { _lead_id: string }; Returns: boolean }
      cleanup_campaign_action_items_on_delete: {
        Args: { _campaign_id: string }
        Returns: undefined
      }
      delete_campaign_cascade: { Args: { _id: string }; Returns: string }
      delete_campaigns_cascade: { Args: { _ids: string[] }; Returns: string[] }
      generate_campaign_slug: {
        Args: { _id: string; _name: string }
        Returns: string
      }
      get_campaign_aggregates: {
        Args: never
        Returns: {
          accounts_count: number
          call_count: number
          campaign_id: string
          communications_count: number
          contacts_count: number
          email_count: number
          email_failed: number
          email_replied: number
          email_sent: number
          linkedin_count: number
          phone_count: number
          replies_count: number
        }[]
      }
      get_campaign_aggregates_v2: {
        Args: never
        Returns: {
          accounts_count: number
          call_touched_contacts: number
          campaign_id: string
          contacts_count: number
          email_failed_threads: number
          email_replied_threads: number
          email_threads: number
          email_touched_contacts: number
          linkedin_touched_contacts: number
          total_touched_contacts: number
        }[]
      }
      get_campaign_widget_stats: { Args: never; Returns: Json }
      get_user_role: { Args: { p_user_id: string }; Returns: string }
      is_current_user_admin: { Args: never; Returns: boolean }
      is_user_admin: { Args: { user_id?: string }; Returns: boolean }
      log_data_access: {
        Args: {
          p_operation: string
          p_record_id?: string
          p_table_name: string
        }
        Returns: undefined
      }
      log_security_event: {
        Args: {
          p_action: string
          p_details?: Json
          p_resource_id?: string
          p_resource_type: string
        }
        Returns: undefined
      }
      promote_contact_on_reply: {
        Args: { _campaign_id: string; _contact_id: string }
        Returns: undefined
      }
      update_user_role: {
        Args: { p_role: string; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      user_role:
        | "admin"
        | "manager"
        | "user"
        | "super_admin"
        | "sales_head"
        | "field_sales"
        | "inside_sales"
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
    Enums: {
      user_role: [
        "admin",
        "manager",
        "user",
        "super_admin",
        "sales_head",
        "field_sales",
        "inside_sales",
      ],
    },
  },
} as const
