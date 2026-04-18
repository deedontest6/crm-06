
import { supabase } from '@/integrations/supabase/client';
import { CSVParser } from '@/utils/csvParser';
import { DateFormatUtils } from '@/utils/dateFormatUtils';

export interface DealsProcessingOptions {
  userId: string;
  onProgress?: (processed: number, total: number) => void;
}

export interface DealsProcessingResult {
  successCount: number;
  updateCount: number;
  errorCount: number;
  errors: string[];
}

export class DealsCSVProcessor {
  async processCSV(csvText: string, options: DealsProcessingOptions): Promise<DealsProcessingResult> {
    console.log('DealsCSVProcessor: Starting processing with standardized YYYY-MM-DD date format');
    
    try {
      const { headers, rows } = CSVParser.parseCSV(csvText);
      console.log(`DealsCSVProcessor: Parsed ${rows.length} rows with headers:`, headers);

      if (rows.length === 0) {
        throw new Error('No data rows found in CSV');
      }

      const result: DealsProcessingResult = {
        successCount: 0,
        updateCount: 0,
        errorCount: 0,
        errors: []
      };

      // Process rows in batches
      const batchSize = 20;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const batchResult = await this.processBatch(batch, headers, options, i);
        
        result.successCount += batchResult.successCount;
        result.updateCount += batchResult.updateCount;
        result.errorCount += batchResult.errorCount;
        result.errors.push(...batchResult.errors);

        if (options.onProgress) {
          options.onProgress(Math.min(i + batchSize, rows.length), rows.length);
        }
      }

      console.log('DealsCSVProcessor: Processing complete:', result);
      return result;

    } catch (error: any) {
      console.error('DealsCSVProcessor: Processing failed:', error);
      throw new Error(`CSV processing failed: ${error.message}`);
    }
  }

  private async processBatch(
    rows: string[][],
    headers: string[],
    options: DealsProcessingOptions,
    batchOffset: number
  ): Promise<DealsProcessingResult> {
    
    const result: DealsProcessingResult = {
      successCount: 0,
      updateCount: 0,
      errorCount: 0,
      errors: []
    };

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const actualRowNumber = batchOffset + rowIndex + 2; // +2 for header and 1-based indexing
      
      try {
        // Convert row to object
        const rowObj: Record<string, any> = {};
        headers.forEach((header, index) => {
          if (row[index] !== undefined) {
            rowObj[header] = row[index];
          }
        });

        // Validate date formats before processing
        const dateValidationError = this.validateDateFormats(rowObj, actualRowNumber);
        if (dateValidationError) {
          result.errorCount++;
          result.errors.push(dateValidationError);
          continue;
        }

        // Extract action items if present
        let actionItemsData: any[] = [];
        if (rowObj.action_items_json) {
          try {
            actionItemsData = JSON.parse(rowObj.action_items_json);
            delete rowObj.action_items_json; // Remove from deal data
          } catch (error) {
            console.warn('Failed to parse action items JSON:', error);
          }
        }

        // Prepare deal record
        const dealRecord = this.prepareDeal(rowObj, options.userId);

        // Validate required fields - ensure deal_name is present and not empty
        if (!dealRecord.deal_name || dealRecord.deal_name.trim() === '') {
          result.errorCount++;
          result.errors.push(`Row ${actualRowNumber}: Deal name is required and cannot be empty`);
          console.error(`Row ${actualRowNumber}: Missing or empty deal_name:`, rowObj);
          continue;
        }

        // Check for existing deal by name
        const { data: existingDeals } = await supabase
          .from('deals')
          .select('id')
          .eq('deal_name', dealRecord.deal_name)
          .limit(1);

        let dealId: string;

        if (existingDeals && existingDeals.length > 0) {
          // Update existing deal
          dealId = existingDeals[0].id;
          const { error: updateError } = await supabase
            .from('deals')
            .update(dealRecord as any)
            .eq('id', dealId);

          if (updateError) {
            result.errorCount++;
            result.errors.push(`Row ${actualRowNumber}: Update failed - ${updateError.message}`);
            continue;
          }
          result.updateCount++;
        } else {
          // Insert new deal
          const dealToInsert = {
            deal_name: dealRecord.deal_name,
            stage: dealRecord.stage || 'Lead',
            project_name: dealRecord.project_name,
            customer_name: dealRecord.customer_name,
            lead_name: dealRecord.lead_name,
            lead_owner: dealRecord.lead_owner,
            region: dealRecord.region,
            priority: dealRecord.priority,
            probability: dealRecord.probability,
            internal_comment: dealRecord.internal_comment,
            expected_closing_date: dealRecord.expected_closing_date,
            customer_need: dealRecord.customer_need,
            customer_challenges: dealRecord.customer_challenges,
            relationship_strength: dealRecord.relationship_strength,
            budget: dealRecord.budget,
            business_value: dealRecord.business_value,
            decision_maker_level: dealRecord.decision_maker_level,
            is_recurring: dealRecord.is_recurring,
            start_date: dealRecord.start_date,
            end_date: dealRecord.end_date,
            currency_type: dealRecord.currency_type,
            total_contract_value: dealRecord.total_contract_value,
            project_duration: dealRecord.project_duration,
            action_items: dealRecord.action_items,
            current_status: dealRecord.current_status,
            closing: dealRecord.closing,
            won_reason: dealRecord.won_reason,
            lost_reason: dealRecord.lost_reason,
            need_improvement: dealRecord.need_improvement,
            drop_reason: dealRecord.drop_reason,
            quarterly_revenue_q1: dealRecord.quarterly_revenue_q1,
            quarterly_revenue_q2: dealRecord.quarterly_revenue_q2,
            quarterly_revenue_q3: dealRecord.quarterly_revenue_q3,
            quarterly_revenue_q4: dealRecord.quarterly_revenue_q4,
            total_revenue: dealRecord.total_revenue,
            signed_contract_date: dealRecord.signed_contract_date,
            implementation_start_date: dealRecord.implementation_start_date,
            handoff_status: dealRecord.handoff_status,
            rfq_received_date: dealRecord.rfq_received_date,
            proposal_due_date: dealRecord.proposal_due_date,
            rfq_status: dealRecord.rfq_status,
            created_by: dealRecord.created_by,
            modified_by: dealRecord.modified_by,
            created_at: dealRecord.created_at,
            modified_at: dealRecord.modified_at
          };

          const { data: insertedDeal, error: insertError } = await supabase
            .from('deals')
            .insert([dealToInsert])
            .select('id')
            .single();

          if (insertError) {
            result.errorCount++;
            result.errors.push(`Row ${actualRowNumber}: Insert failed - ${insertError.message}`);
            continue;
          }
          dealId = insertedDeal.id;
          result.successCount++;
        }

        // Process action items if any
        if (actionItemsData.length > 0) {
          await this.processActionItems(dealId, actionItemsData, options.userId);
        }

      } catch (error: any) {
        result.errorCount++;
        result.errors.push(`Row ${actualRowNumber}: Processing error - ${error.message}`);
      }
    }

    return result;
  }

  private validateDateFormats(rowObj: Record<string, any>, rowNumber: number): string | null {
    const dateFields = [
      'expected_closing_date', 'start_date', 'end_date', 
      'signed_contract_date', 'implementation_start_date', 
      'rfq_received_date', 'proposal_due_date'
    ];

    for (const field of dateFields) {
      if (rowObj[field] && rowObj[field].trim() !== '') {
        const convertedDate = DateFormatUtils.convertDateForImport(rowObj[field]);
        if (convertedDate === null) {
          return `Row ${rowNumber}: Invalid date format in field '${field}': '${rowObj[field]}'. Please use YYYY-MM-DD format.`;
        }
      }
    }

    return null; // No validation errors
  }

  private prepareDeal(rowObj: Record<string, any>, userId: string): Record<string, any> {
    const dealRecord: Record<string, any> = {
      created_by: userId,
      modified_by: userId
    };

    // Map CSV fields to database fields
    const fieldMapping: Record<string, string> = {
      'deal_name': 'deal_name',
      'stage': 'stage',
      'project_name': 'project_name',
      'customer_name': 'customer_name',
      'lead_name': 'lead_name',
      'lead_owner': 'lead_owner',
      'region': 'region',
      'priority': 'priority',
      'probability': 'probability',
      'internal_comment': 'internal_comment',
      'expected_closing_date': 'expected_closing_date',
      'customer_need': 'customer_need',
      'customer_challenges': 'customer_challenges',
      'relationship_strength': 'relationship_strength',
      'budget': 'budget',
      'business_value': 'business_value',
      'decision_maker_level': 'decision_maker_level',
      'is_recurring': 'is_recurring',
      'start_date': 'start_date',
      'end_date': 'end_date',
      'currency_type': 'currency_type',
      'total_contract_value': 'total_contract_value',
      'project_duration': 'project_duration',
      'action_items': 'action_items',
      'current_status': 'current_status',
      'closing': 'closing',
      'won_reason': 'won_reason',
      'lost_reason': 'lost_reason',
      'need_improvement': 'need_improvement',
      'drop_reason': 'drop_reason',
      'quarterly_revenue_q1': 'quarterly_revenue_q1',
      'quarterly_revenue_q2': 'quarterly_revenue_q2',
      'quarterly_revenue_q3': 'quarterly_revenue_q3',
      'quarterly_revenue_q4': 'quarterly_revenue_q4',
      'total_revenue': 'total_revenue',
      'signed_contract_date': 'signed_contract_date',
      'implementation_start_date': 'implementation_start_date',
      'handoff_status': 'handoff_status',
      'rfq_received_date': 'rfq_received_date',
      'proposal_due_date': 'proposal_due_date',
      'rfq_status': 'rfq_status'
    };

    Object.entries(fieldMapping).forEach(([csvField, dbField]) => {
      if (rowObj[csvField] !== undefined && rowObj[csvField] !== '') {
        dealRecord[dbField] = rowObj[csvField];
      }
    });

    // Ensure deal_name is always set - try multiple fallbacks
    if (!dealRecord.deal_name || dealRecord.deal_name.trim() === '') {
      // Try fallback fields
      dealRecord.deal_name = rowObj.name || 
                            rowObj.project_name || 
                            rowObj.customer_name || 
                            '';
    }

    // Handle date fields - convert to YYYY-MM-DD format
    const dateFields = ['expected_closing_date', 'start_date', 'end_date', 'signed_contract_date', 
                       'implementation_start_date', 'rfq_received_date', 'proposal_due_date'];
    
    dateFields.forEach(field => {
      if (rowObj[field]) {
        const convertedDate = DateFormatUtils.convertDateForImport(rowObj[field]);
        if (convertedDate) dealRecord[field] = convertedDate;
      }
    });

    // Handle datetime fields
    if (rowObj.created_at) {
      const convertedDate = DateFormatUtils.convertDateForImport(rowObj.created_at);
      if (convertedDate) dealRecord.created_at = convertedDate;
    }

    if (rowObj.modified_at) {
      const convertedDate = DateFormatUtils.convertDateForImport(rowObj.modified_at);
      if (convertedDate) dealRecord.modified_at = convertedDate;
    }

    // Handle numeric fields
    const numericFields = ['priority', 'probability', 'total_contract_value', 'project_duration',
                          'quarterly_revenue_q1', 'quarterly_revenue_q2', 'quarterly_revenue_q3',
                          'quarterly_revenue_q4', 'total_revenue'];
    
    numericFields.forEach(field => {
      if (rowObj[field] && rowObj[field] !== '') {
        const num = parseFloat(rowObj[field]);
        if (!isNaN(num)) dealRecord[field] = num;
      }
    });

    return dealRecord;
  }

  private async processActionItems(dealId: string, actionItemsData: any[], userId: string) {
    try {
      // Clear existing action items for this deal (optional - you might want to keep them)
      await supabase
        .from('deal_action_items')
        .delete()
        .eq('deal_id', dealId);

      // Insert new action items
      const actionItemsToInsert = actionItemsData.map(item => ({
        deal_id: dealId,
        next_action: item.next_action || '',
        status: item.status || 'Open',
        due_date: item.due_date || null,
        assigned_to: item.assigned_to || null,
        created_by: userId
      }));

      if (actionItemsToInsert.length > 0) {
        const { error } = await supabase
          .from('deal_action_items')
          .insert(actionItemsToInsert);

        if (error) {
          console.error('Error inserting deal action items:', error);
        } else {
          console.log(`Inserted ${actionItemsToInsert.length} action items for deal ${dealId}`);
        }
      }
    } catch (error) {
      console.error('Error processing deal action items:', error);
    }
  }
}
