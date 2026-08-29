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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          new_values: Json | null
          old_values: Json | null
          organization_id: string
          record_id: string | null
          table_name: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          organization_id: string
          record_id?: string | null
          table_name?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          organization_id?: string
          record_id?: string | null
          table_name?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      backups: {
        Row: {
          counts: Json
          created_at: string
          created_by: string | null
          created_by_email: string | null
          id: string
          kind: string
          label: string
          organization_id: string
          payload: Json
          size_bytes: number
        }
        Insert: {
          counts?: Json
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          kind?: string
          label: string
          organization_id: string
          payload: Json
          size_bytes?: number
        }
        Update: {
          counts?: Json
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          kind?: string
          label?: string
          organization_id?: string
          payload?: Json
          size_bytes?: number
        }
        Relationships: [
          {
            foreignKeyName: "backups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account: string | null
          active: boolean
          bank: string | null
          branch: string | null
          color: string
          created_at: string
          created_by: string | null
          id: string
          initial_balance: number
          initial_balance_date: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          account?: string | null
          active?: boolean
          bank?: string | null
          branch?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          initial_balance?: number
          initial_balance_date?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          account?: string | null
          active?: boolean
          bank?: string | null
          branch?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          initial_balance?: number
          initial_balance_date?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          action_group: string | null
          action_type: string | null
          archived_date: string | null
          case_number: string | null
          case_result: string | null
          case_year: string | null
          claim_value: number | null
          client_id: string
          closing_date: string | null
          contingency: string | null
          county: string | null
          court: string | null
          court_division: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          external_link: string | null
          fee_amount: number | null
          fee_percent: number | null
          folder: string | null
          id: string
          judicial_phase: string | null
          last_movement: string | null
          notes: string | null
          opposing_party: string | null
          organization_id: string
          original_case: string | null
          practice_area: string | null
          protocol_number: string | null
          request_date: string | null
          res_judicata_date: string | null
          responsible_lawyer: string | null
          result_center: string | null
          segment: string | null
          stage: string | null
          status: string
          updated_at: string
        }
        Insert: {
          action_group?: string | null
          action_type?: string | null
          archived_date?: string | null
          case_number?: string | null
          case_result?: string | null
          case_year?: string | null
          claim_value?: number | null
          client_id: string
          closing_date?: string | null
          contingency?: string | null
          county?: string | null
          court?: string | null
          court_division?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          external_link?: string | null
          fee_amount?: number | null
          fee_percent?: number | null
          folder?: string | null
          id?: string
          judicial_phase?: string | null
          last_movement?: string | null
          notes?: string | null
          opposing_party?: string | null
          organization_id: string
          original_case?: string | null
          practice_area?: string | null
          protocol_number?: string | null
          request_date?: string | null
          res_judicata_date?: string | null
          responsible_lawyer?: string | null
          result_center?: string | null
          segment?: string | null
          stage?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          action_group?: string | null
          action_type?: string | null
          archived_date?: string | null
          case_number?: string | null
          case_result?: string | null
          case_year?: string | null
          claim_value?: number | null
          client_id?: string
          closing_date?: string | null
          contingency?: string | null
          county?: string | null
          court?: string | null
          court_division?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          external_link?: string | null
          fee_amount?: number | null
          fee_percent?: number | null
          folder?: string | null
          id?: string
          judicial_phase?: string | null
          last_movement?: string | null
          notes?: string | null
          opposing_party?: string | null
          organization_id?: string
          original_case?: string | null
          practice_area?: string | null
          protocol_number?: string | null
          request_date?: string | null
          res_judicata_date?: string | null
          responsible_lawyer?: string | null
          result_center?: string | null
          segment?: string | null
          stage?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_balances"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "cases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          active: boolean
          color: string
          created_at: string
          id: string
          name: string
          organization_id: string
          parent_id: string | null
          type: Database["public"]["Enums"]["category_type"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          id?: string
          name: string
          organization_id: string
          parent_id?: string | null
          type: Database["public"]["Enums"]["category_type"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          parent_id?: string | null
          type?: Database["public"]["Enums"]["category_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      client_payment_accounts: {
        Row: {
          account: string | null
          bank: string | null
          branch: string | null
          client_id: string
          created_at: string
          created_by: string | null
          holder_name: string | null
          holder_tax_id: string | null
          id: string
          organization_id: string
          pix_key: string | null
          pix_key_type: string | null
          updated_at: string
        }
        Insert: {
          account?: string | null
          bank?: string | null
          branch?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          holder_name?: string | null
          holder_tax_id?: string | null
          id?: string
          organization_id: string
          pix_key?: string | null
          pix_key_type?: string | null
          updated_at?: string
        }
        Update: {
          account?: string | null
          bank?: string | null
          branch?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          holder_name?: string | null
          holder_tax_id?: string | null
          id?: string
          organization_id?: string
          pix_key?: string | null
          pix_key_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_payment_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_payment_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_balances"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_payment_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_transfers: {
        Row: {
          amount: number
          bank_account_id: string | null
          cancel_reason: string | null
          case_id: string | null
          client_id: string
          created_at: string
          created_by: string | null
          destination_info: string | null
          id: string
          notes: string | null
          organization_id: string
          override_reason: string | null
          paid_on: string | null
          receipt_file_url: string | null
          receipt_id: string | null
          receivable_id: string | null
          scheduled_for: string | null
          status: Database["public"]["Enums"]["transfer_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          cancel_reason?: string | null
          case_id?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          destination_info?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          override_reason?: string | null
          paid_on?: string | null
          receipt_file_url?: string | null
          receipt_id?: string | null
          receivable_id?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          cancel_reason?: string | null
          case_id?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          destination_info?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          override_reason?: string | null
          paid_on?: string | null
          receipt_file_url?: string | null
          receipt_id?: string | null
          receivable_id?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_transfers_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_transfers_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_bank_balances"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "client_transfers_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_transfers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_transfers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_balances"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_transfers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_transfers_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_transfers_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "legal_receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          birth_date: string | null
          cid: string | null
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          ctps: string | null
          deleted_at: string | null
          district: string | null
          email: string | null
          gender: string | null
          id: string
          marital_status: string | null
          mother_name: string | null
          name: string
          notes: string | null
          occupation: string | null
          organization_id: string
          payer_names: string[]
          phone: string | null
          phone_secondary: string | null
          pis_pasep: string | null
          rg: string | null
          source: string | null
          state: string | null
          status: string
          tax_id: string | null
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          birth_date?: string | null
          cid?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          ctps?: string | null
          deleted_at?: string | null
          district?: string | null
          email?: string | null
          gender?: string | null
          id?: string
          marital_status?: string | null
          mother_name?: string | null
          name: string
          notes?: string | null
          occupation?: string | null
          organization_id: string
          payer_names?: string[]
          phone?: string | null
          phone_secondary?: string | null
          pis_pasep?: string | null
          rg?: string | null
          source?: string | null
          state?: string | null
          status?: string
          tax_id?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          birth_date?: string | null
          cid?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          ctps?: string | null
          deleted_at?: string | null
          district?: string | null
          email?: string | null
          gender?: string | null
          id?: string
          marital_status?: string | null
          mother_name?: string | null
          name?: string
          notes?: string | null
          occupation?: string | null
          organization_id?: string
          payer_names?: string[]
          phone?: string | null
          phone_secondary?: string | null
          pis_pasep?: string | null
          rg?: string | null
          source?: string | null
          state?: string | null
          status?: string
          tax_id?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_transactions: {
        Row: {
          is_financing: boolean
          loan_id: string | null
          import_hash: string | null
          payment_method: string | null
          recurrence_group_id: string | null
          recurrence_index: number | null
          recurrence_total: number | null
          amount: number
          attachment_url: string | null
          bank_account_id: string | null
          case_id: string | null
          category_id: string | null
          client_id: string | null
          competence_date: string | null
          created_at: string
          created_by: string | null
          description: string
          due_date: string | null
          id: string
          notes: string | null
          organization_id: string
          paid_on: string | null
          source_id: string | null
          source_type: string | null
          status: Database["public"]["Enums"]["tx_status"]
          type: Database["public"]["Enums"]["tx_type"]
          updated_at: string
        }
        Insert: {
          is_financing?: boolean
          loan_id?: string | null
          import_hash?: string | null
          payment_method?: string | null
          recurrence_group_id?: string | null
          recurrence_index?: number | null
          recurrence_total?: number | null
          amount: number
          attachment_url?: string | null
          bank_account_id?: string | null
          case_id?: string | null
          category_id?: string | null
          client_id?: string | null
          competence_date?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          due_date?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          paid_on?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["tx_status"]
          type: Database["public"]["Enums"]["tx_type"]
          updated_at?: string
        }
        Update: {
          is_financing?: boolean
          loan_id?: string | null
          import_hash?: string | null
          payment_method?: string | null
          recurrence_group_id?: string | null
          recurrence_index?: number | null
          recurrence_total?: number | null
          amount?: number
          attachment_url?: string | null
          bank_account_id?: string | null
          case_id?: string | null
          category_id?: string | null
          client_id?: string | null
          competence_date?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          paid_on?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["tx_status"]
          type?: Database["public"]["Enums"]["tx_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_bank_balances"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "financial_transactions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_balances"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "financial_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      installments: {
        Row: {
          cancel_reason: string | null
          canceled_at: string | null
          client_amount: number
          cost_reimbursement: number
          created_at: string
          created_by: string | null
          due_date: string | null
          fee_amount: number
          gross_amount: number
          id: string
          label: string | null
          notes: string | null
          number: number
          organization_id: string
          receivable_id: string
          review_pending: boolean
          success_fee_amount: number
          total_count: number
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          canceled_at?: string | null
          client_amount?: number
          cost_reimbursement?: number
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          fee_amount?: number
          gross_amount?: number
          id?: string
          label?: string | null
          notes?: string | null
          number?: number
          organization_id: string
          receivable_id: string
          review_pending?: boolean
          success_fee_amount?: number
          total_count?: number
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          canceled_at?: string | null
          client_amount?: number
          cost_reimbursement?: number
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          fee_amount?: number
          gross_amount?: number
          id?: string
          label?: string | null
          notes?: string | null
          number?: number
          organization_id?: string
          receivable_id?: string
          review_pending?: boolean
          success_fee_amount?: number
          total_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "installments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installments_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "legal_receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_receivables: {
        Row: {
          agreement_date: string | null
          cancel_reason: string | null
          case_id: string | null
          client_id: string
          cost_reimbursement: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          expected_client_amount: number
          expected_firm_amount: number
          fee_fixed_amount: number | null
          fee_percent: number | null
          flow: Database["public"]["Enums"]["flow_type"]
          gross_amount: number
          id: string
          is_estimated: boolean
          manual_override_reason: string | null
          notes: string | null
          organization_id: string
          review_pending: boolean
          status: Database["public"]["Enums"]["receivable_status"]
          success_fee_amount: number
          type: Database["public"]["Enums"]["receivable_type"]
          updated_at: string
        }
        Insert: {
          agreement_date?: string | null
          cancel_reason?: string | null
          case_id?: string | null
          client_id: string
          cost_reimbursement?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          expected_client_amount?: number
          expected_firm_amount?: number
          fee_fixed_amount?: number | null
          fee_percent?: number | null
          flow?: Database["public"]["Enums"]["flow_type"]
          gross_amount?: number
          id?: string
          is_estimated?: boolean
          manual_override_reason?: string | null
          notes?: string | null
          organization_id: string
          review_pending?: boolean
          status?: Database["public"]["Enums"]["receivable_status"]
          success_fee_amount?: number
          type?: Database["public"]["Enums"]["receivable_type"]
          updated_at?: string
        }
        Update: {
          agreement_date?: string | null
          cancel_reason?: string | null
          case_id?: string | null
          client_id?: string
          cost_reimbursement?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          expected_client_amount?: number
          expected_firm_amount?: number
          fee_fixed_amount?: number | null
          fee_percent?: number | null
          flow?: Database["public"]["Enums"]["flow_type"]
          gross_amount?: number
          id?: string
          is_estimated?: boolean
          manual_override_reason?: string | null
          notes?: string | null
          organization_id?: string
          review_pending?: boolean
          status?: Database["public"]["Enums"]["receivable_status"]
          success_fee_amount?: number
          type?: Database["public"]["Enums"]["receivable_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_receivables_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_receivables_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_receivables_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_balances"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "legal_receivables_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          amount_received: number
          bank_account_id: string | null
          contract_number: string | null
          created_at: string
          created_by: string | null
          id: string
          lender: string
          notes: string | null
          organization_id: string
          received_on: string | null
          updated_at: string
        }
        Insert: {
          amount_received?: number
          bank_account_id?: string | null
          contract_number?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lender: string
          notes?: string | null
          organization_id: string
          received_on?: string | null
          updated_at?: string
        }
        Update: {
          amount_received?: number
          bank_account_id?: string | null
          contract_number?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lender?: string
          notes?: string | null
          organization_id?: string
          received_on?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          brand_color: string
          cnpj: string | null
          created_at: string
          currency: string
          id: string
          logo_url: string | null
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          brand_color?: string
          cnpj?: string | null
          created_at?: string
          currency?: string
          id?: string
          logo_url?: string | null
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          brand_color?: string
          cnpj?: string | null
          created_at?: string
          currency?: string
          id?: string
          logo_url?: string | null
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          confirmed_at: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          invited_at: string | null
          last_sign_in_at: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          confirmed_at?: string | null
          created_at?: string
          email: string
          full_name?: string
          id: string
          invited_at?: string | null
          last_sign_in_at?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          confirmed_at?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          invited_at?: string | null
          last_sign_in_at?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          allocation_override_reason: string | null
          amount_received_in_firm_account: number
          bank_account_id: string | null
          client_amount: number
          client_amount_received_by_firm: number
          client_amount_received_direct: number
          cost_reimbursement: number
          created_at: string
          created_by: string | null
          fee_amount: number
          id: string
          installment_id: string
          notes: string | null
          organization_id: string
          payment_method: string | null
          receipt_destination: string
          received_on: string
          reconciled: boolean
          reference: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          success_fee_amount: number
          total_amount: number
          updated_at: string
        }
        Insert: {
          allocation_override_reason?: string | null
          amount_received_in_firm_account?: number
          bank_account_id?: string | null
          client_amount?: number
          client_amount_received_by_firm?: number
          client_amount_received_direct?: number
          cost_reimbursement?: number
          created_at?: string
          created_by?: string | null
          fee_amount?: number
          id?: string
          installment_id: string
          notes?: string | null
          organization_id: string
          payment_method?: string | null
          receipt_destination?: string
          received_on?: string
          reconciled?: boolean
          reference?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          success_fee_amount?: number
          total_amount: number
          updated_at?: string
        }
        Update: {
          allocation_override_reason?: string | null
          amount_received_in_firm_account?: number
          bank_account_id?: string | null
          client_amount?: number
          client_amount_received_by_firm?: number
          client_amount_received_direct?: number
          cost_reimbursement?: number
          created_at?: string
          created_by?: string | null
          fee_amount?: number
          id?: string
          installment_id?: string
          notes?: string | null
          organization_id?: string
          payment_method?: string | null
          receipt_destination?: string
          received_on?: string
          reconciled?: boolean
          reference?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          success_fee_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipts_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_bank_balances"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "receipts_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "v_installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_definitions: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_system: boolean
          name: string
          organization_id: string
          protected: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          organization_id: string
          protected?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          organization_id?: string
          protected?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          action: string
          allowed: boolean
          created_at: string
          id: string
          module: string
          organization_id: string
          role_code: string
          updated_at: string
        }
        Insert: {
          action: string
          allowed?: boolean
          created_at?: string
          id?: string
          module: string
          organization_id: string
          role_code: string
          updated_at?: string
        }
        Update: {
          action?: string
          allowed?: boolean
          created_at?: string
          id?: string
          module?: string
          organization_id?: string
          role_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      v_bank_balances: {
        Row: {
          balance: number | null
          bank_account_id: string | null
          color: string | null
          name: string | null
          organization_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_client_balances: {
        Row: {
          client_id: string | null
          name: string | null
          organization_id: string | null
          pending_transfer: number | null
          received_client: number | null
          transferred: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_installments: {
        Row: {
          balance: number | null
          cancel_reason: string | null
          canceled_at: string | null
          case_id: string | null
          client_amount: number | null
          client_id: string | null
          cost_reimbursement: number | null
          created_at: string | null
          created_by: string | null
          due_date: string | null
          fee_amount: number | null
          gross_amount: number | null
          id: string | null
          is_estimated: boolean | null
          label: string | null
          notes: string | null
          number: number | null
          organization_id: string | null
          paid_client: number | null
          paid_cost_reimbursement: number | null
          paid_fee: number | null
          paid_success_fee: number | null
          paid_total: number | null
          payment_flow: Database["public"]["Enums"]["flow_type"] | null
          receivable_id: string | null
          receivable_status:
            | Database["public"]["Enums"]["receivable_status"]
            | null
          receivable_type: Database["public"]["Enums"]["receivable_type"] | null
          review_pending: boolean | null
          status: string | null
          success_fee_amount: number | null
          total_count: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "installments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installments_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "legal_receivables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_receivables_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_receivables_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_receivables_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_balances"
            referencedColumns: ["client_id"]
          },
        ]
      }
    }
    Functions: {
      can: { Args: { _action: string; _module: string }; Returns: boolean }
      can_write: { Args: never; Returns: boolean }
      cancel_installment: {
        Args: { _installment_id: string; _reason: string }
        Returns: undefined
      }
      cancel_receivable: {
        Args: { _reason: string; _receivable_id: string }
        Returns: undefined
      }
      cancel_transfer: {
        Args: { _reason: string; _transfer_id: string }
        Returns: undefined
      }
      create_agreement_with_schedule: {
        Args: {
          _agreement_date?: string
          _case_id?: string
          _client_id: string
          _cost_reimbursement?: number
          _description?: string
          _expected_client_amount?: number
          _expected_firm_amount?: number
          _fee_fixed_amount?: number
          _fee_percent?: number
          _flow?: string
          _gross_amount?: number
          _installments?: Json
          _is_estimated?: boolean
          _manual_override_reason?: string
          _notes?: string
          _status?: string
          _success_fee_amount?: number
          _type?: string
        }
        Returns: string
      }
      create_client_with_payment_account: {
        Args: {
          _account?: string
          _bank?: string
          _branch?: string
          _email?: string
          _holder_name?: string
          _holder_tax_id?: string
          _name: string
          _notes?: string
          _payer_names?: string[]
          _phone?: string
          _pix_key?: string
          _pix_key_type?: string
          _tax_id?: string
        }
        Returns: string
      }
      current_org_id: { Args: never; Returns: string }
      delete_canceled_installment: {
        Args: { _installment_id: string }
        Returns: undefined
      }
      delete_canceled_receivable: {
        Args: { _receivable_id: string }
        Returns: undefined
      }
      create_loan: {
        Args: {
          _amount_received: number
          _bank_account_id?: string
          _category_id?: string
          _contract_number?: string
          _installments: Json
          _lender: string
          _notes?: string
          _received_on: string
        }
        Returns: string
      }
      delete_loan: {
        Args: { _loan_id: string }
        Returns: number
      }
      create_transfer_from_receipt: {
        Args: { _receipt_id: string; _scheduled_for?: string }
        Returns: string
      }
      create_backup: {
        Args: { _kind?: string; _label?: string }
        Returns: string
      }
      delete_bank_account: {
        Args: { _id: string }
        Returns: undefined
      }
      delete_category: {
        Args: { _id: string }
        Returns: undefined
      }
      delete_manual_transaction: {
        Args: { _id: string }
        Returns: undefined
      }
      delete_receivable: {
        Args: { _id: string }
        Returns: Json
      }
      delete_recurrence_series: {
        Args: { _group_id: string }
        Returns: number
      }
      restore_backup: {
        Args: { _payload: Json }
        Returns: Json
      }
      update_installment: {
        Args: {
          _client_amount?: number
          _cost_reimbursement?: number
          _due_date?: string
          _fee_amount?: number
          _gross_amount?: number
          _id: string
          _label?: string
          _stream?: string
          _success_fee_amount?: number
        }
        Returns: undefined
      }
      update_manual_transaction: {
        Args: {
          _amount: number
          _bank_account_id?: string
          _category_id?: string
          _date: string
          _description: string
          _id: string
          _notes?: string
          _payment_method?: string
          _status: string
          _type: string
        }
        Returns: undefined
      }
      update_receivable: {
        Args: {
          _agreement_date?: string
          _case_id?: string
          _cost_reimbursement?: number
          _description?: string
          _expected_client_amount?: number
          _expected_firm_amount?: number
          _fee_fixed_amount?: number
          _fee_percent?: number
          _flow?: string
          _gross_amount?: number
          _id: string
          _is_estimated?: boolean
          _notes?: string
          _status: string
          _success_fee_amount?: number
          _type: string
        }
        Returns: undefined
      }
      update_transfer: {
        Args: {
          _amount?: number
          _bank_account_id?: string
          _destination_info?: string
          _id: string
          _notes?: string
          _paid_on?: string
          _scheduled_for?: string
          _status?: string
        }
        Returns: undefined
      }
      has_permission: {
        Args: { _action: string; _module: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_member: { Args: { _org: string }; Returns: boolean }
      is_protected_admin: { Args: { _user_id: string }; Returns: boolean }
      reverse_receipt: {
        Args: { _reason: string; _receipt_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "financeiro"
        | "advogado"
        | "consulta"
        | "socio_gestor"
        | "lancador"
        | "cobranca"
      category_type: "receita" | "despesa"
      flow_type:
        | "escritorio_recebe_total"
        | "cliente_recebe_direto"
        | "recebimento_dividido"
        | "deposito_judicial"
      receivable_status:
        | "rascunho"
        | "estimado"
        | "confirmado"
        | "em_pagamento"
        | "em_execucao"
        | "encerrado"
        | "cancelado"
      receivable_type:
        | "acordo"
        | "sentenca"
        | "execucao"
        | "honorarios"
        | "outro"
      transfer_status: "pendente" | "agendado" | "pago" | "cancelado"
      tx_status: "previsto" | "pago" | "cancelado"
      tx_type:
        | "entrada"
        | "saida"
        | "transferencia_entre_contas"
        | "entrada_de_terceiros"
        | "repasse_de_terceiros"
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
      app_role: [
        "admin",
        "financeiro",
        "advogado",
        "consulta",
        "socio_gestor",
        "lancador",
        "cobranca",
      ],
      category_type: ["receita", "despesa"],
      flow_type: [
        "escritorio_recebe_total",
        "cliente_recebe_direto",
        "recebimento_dividido",
        "deposito_judicial",
      ],
      receivable_status: [
        "rascunho",
        "estimado",
        "confirmado",
        "em_pagamento",
        "em_execucao",
        "encerrado",
        "cancelado",
      ],
      receivable_type: [
        "acordo",
        "sentenca",
        "execucao",
        "honorarios",
        "outro",
      ],
      transfer_status: ["pendente", "agendado", "pago", "cancelado"],
      tx_status: ["previsto", "pago", "cancelado"],
      tx_type: [
        "entrada",
        "saida",
        "transferencia_entre_contas",
        "entrada_de_terceiros",
        "repasse_de_terceiros",
      ],
    },
  },
} as const
