import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Acquire Microsoft Graph API access token
async function getGraphAccessToken(): Promise<string> {
  const tenantId = Deno.env.get('AZURE_TENANT_ID')!;
  const clientId = Deno.env.get('AZURE_CLIENT_ID')!;
  const clientSecret = Deno.env.get('AZURE_CLIENT_SECRET')!;

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to get Graph token: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return data.access_token;
}

// Send email via Microsoft Graph API
async function sendEmailViaGraph(
  accessToken: string,
  toEmail: string,
  toName: string,
  subject: string,
  htmlBody: string
): Promise<boolean> {
  const senderEmail = Deno.env.get('AZURE_SENDER_EMAIL')!;
  const url = `https://graph.microsoft.com/v1.0/users/${senderEmail}/sendMail`;

  const emailPayload = {
    message: {
      subject,
      body: { contentType: 'HTML', content: htmlBody },
      toRecipients: [{ emailAddress: { address: toEmail, name: toName } }],
    },
    saveToSentItems: false,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emailPayload),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Graph sendMail failed for ${toEmail}: ${res.status} ${errText}`);
    return false;
  }

  // 202 Accepted - no body to consume
  return true;
}

interface ActionItem {
  id: string;
  title: string;
  due_date: string | null;
  priority: string;
  status: string;
  module_type: string | null;
  module_id: string | null;
}

function categorizeItems(actionItems: ActionItem[], today: string): {
  overdue: ActionItem[];
  dueThisWeek: ActionItem[];
  upcoming: ActionItem[];
} {
  const todayDate = new Date(today);
  const oneWeekLater = new Date(todayDate);
  oneWeekLater.setDate(oneWeekLater.getDate() + 7);

  const overdue: ActionItem[] = [];
  const dueThisWeek: ActionItem[] = [];
  const upcoming: ActionItem[] = [];

  for (const item of actionItems) {
    if (item.due_date) {
      const dueDate = new Date(item.due_date);
      if (dueDate < todayDate) {
        overdue.push(item);
      } else if (dueDate <= oneWeekLater) {
        dueThisWeek.push(item);
      } else {
        upcoming.push(item);
      }
    } else {
      upcoming.push(item);
    }
  }

  return { overdue, dueThisWeek, upcoming };
}

function buildCategoryTable(
  items: ActionItem[],
  headerText: string,
  headerBg: string,
  headerColor: string,
  rowBg: string,
  today: string,
  appUrl: string,
  accountMap: Map<string, string>
): string {
  if (items.length === 0) return '';

  const rows = items.map((item) => {
    const isOverdue = item.due_date && item.due_date < today;
    const dueDateDisplay = item.due_date
      ? `${item.due_date}${isOverdue ? ' ⚠️' : ''}`
      : '—';
    const priorityBadge =
      item.priority === 'High'
        ? '<span style="color:#DC2626;font-weight:600;">High</span>'
        : item.priority === 'Medium'
        ? '<span style="color:#D97706;">Medium</span>'
        : '<span style="color:#6B7280;">Low</span>';

    const accountName = accountMap.get(item.id) || '—';
    const itemUrl = `${appUrl}/action-items?highlight=${encodeURIComponent(item.title)}`;
    return `<tr style="background-color:${rowBg};">
      <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;">${accountName}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;"><a href="${itemUrl}" style="color:#1E40AF;text-decoration:underline;font-weight:500;" target="_blank">${item.title}</a></td>
      <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;">${dueDateDisplay}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;">${priorityBadge}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;">${item.status}</td>
    </tr>`;
  }).join('');

  return `
    <div style="margin-bottom:20px;">
      <div style="background-color:${headerBg};color:${headerColor};padding:10px 14px;border-radius:6px 6px 0 0;font-weight:600;font-size:14px;">
        ${headerText} (${items.length})
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-top:none;border-radius:0 0 6px 6px;overflow:hidden;font-size:14px;color:#374151;">
        <thead>
          <tr style="background-color:#F9FAFB;">
            <th style="padding:10px 12px;text-align:left;font-weight:600;border-bottom:2px solid #E5E7EB;">Account</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;border-bottom:2px solid #E5E7EB;">Title</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;border-bottom:2px solid #E5E7EB;">Due Date</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;border-bottom:2px solid #E5E7EB;">Priority</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;border-bottom:2px solid #E5E7EB;">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// Build HTML email for action item reminders
function buildReminderEmail(
  userName: string,
  actionItems: ActionItem[],
  overdueCount: number,
  highPriorityCount: number,
  appUrl: string,
  accountMap: Map<string, string>
): string {
  const today = new Date().toISOString().split('T')[0];
  const { overdue, dueThisWeek, upcoming } = categorizeItems(actionItems, today);

  const summaryParts: string[] = [];
  if (overdueCount > 0) summaryParts.push(`<span style="color:#DC2626;font-weight:600;">${overdueCount} overdue</span>`);
  if (highPriorityCount > 0) summaryParts.push(`<span style="color:#D97706;font-weight:600;">${highPriorityCount} high priority</span>`);
  const summaryLine = summaryParts.length > 0 ? `<p style="margin:0 0 16px;">${summaryParts.join(' · ')}</p>` : '';

  const overdueTable = buildCategoryTable(overdue, '🔴 Overdue Items', '#DC2626', '#FFFFFF', '#FEF2F2', today, appUrl, accountMap);
  const dueThisWeekTable = buildCategoryTable(dueThisWeek, '🟡 Due This Week', '#D97706', '#FFFFFF', '#FFFBEB', today, appUrl, accountMap);
  const upcomingTable = buildCategoryTable(upcoming, '🟢 Upcoming Items', '#16A34A', '#FFFFFF', '#F0FDF4', today, appUrl, accountMap);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3F4F6;padding:32px 16px;">
    <tr><td align="center">
      <table width="800" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr><td style="background-color:#1E40AF;padding:24px 32px;">
          <h1 style="margin:0;color:#FFFFFF;font-size:20px;font-weight:600;">📋 Daily Action Items Reminder</h1>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:16px;color:#111827;">Hi ${userName},</p>
          <p style="margin:0 0 16px;font-size:15px;color:#374151;">You have <strong>${actionItems.length}</strong> pending action item${actionItems.length > 1 ? 's' : ''} that need your attention.</p>
          ${summaryLine}
          ${overdueTable}
          ${dueThisWeekTable}
          ${upcomingTable}
          <!-- CTA -->
          <div style="margin-top:24px;text-align:center;">
            <a href="${appUrl}/action-items" style="display:inline-block;padding:12px 28px;background-color:#1E40AF;color:#FFFFFF;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">View Action Items</a>
          </div>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px;background-color:#F9FAFB;border-top:1px solid #E5E7EB;">
          <p style="margin:0;font-size:12px;color:#9CA3AF;text-align:center;">You received this email because you have action item reminders enabled. Manage your preferences in CRM Settings.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const appUrl = 'https://crm.realthingks.com';

    // Check for test mode
    let testUserId: string | null = null;
    try {
      const body = await req.json();
      testUserId = body?.test_user_id || null;
    } catch { /* no body or not JSON */ }

    if (testUserId) {
      console.log(`[TEST MODE] Running for user ${testUserId} only, bypassing time checks`);

      const { data: existingPref } = await supabase
        .from('notification_preferences')
        .select('user_id')
        .eq('user_id', testUserId)
        .maybeSingle();

      if (!existingPref) {
        await supabase
          .from('notification_preferences')
          .insert({ user_id: testUserId, task_reminders: true, email_notifications: true });
        console.log(`[TEST MODE] Created notification_preferences for user ${testUserId}`);
      } else {
        await supabase
          .from('notification_preferences')
          .update({ task_reminders: true, email_notifications: true })
          .eq('user_id', testUserId);
      }
    }

    let prefsQuery = supabase
      .from('notification_preferences')
      .select('user_id, daily_reminder_time, last_reminder_sent_at, email_notifications')
      .eq('task_reminders', true);

    if (testUserId) {
      prefsQuery = prefsQuery.eq('user_id', testUserId);
    }

    const { data: prefs, error: prefsError } = await prefsQuery;

    if (prefsError) throw prefsError;
    if (!prefs || prefs.length === 0) {
      console.log('[INFO] No users with task_reminders enabled found');
      return new Response(JSON.stringify({ message: 'No users with task reminders enabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[INFO] Found ${prefs.length} users with task_reminders enabled`);

    const userIds = prefs.map(p => p.user_id);
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, timezone, full_name, "Email ID"')
      .in('id', userIds);

    if (profilesError) throw profilesError;

    const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
    const now = new Date();
    let notificationsSent = 0;
    let emailsSent = 0;
    const skipped: { userId: string; reason: string }[] = [];

    let graphToken: string | null = null;
    const anyEmailEnabled = prefs.some(p => p.email_notifications);
    if (anyEmailEnabled) {
      try {
        graphToken = await getGraphAccessToken();
        console.log('[INFO] Graph API token acquired successfully');
      } catch (err) {
        console.error('[CRITICAL] Failed to acquire Graph API token. ALL reminder emails will be skipped this cycle. Error:', (err as Error).message);
        console.error('[CRITICAL] If this persists, check Azure Portal → App Registrations → Certificates & Secrets for expired client secret.');
        
        // Log failed email attempt to email_history for visibility
        const senderEmail = Deno.env.get('AZURE_SENDER_EMAIL') || 'system@crm.realthingks.com';
        await supabase
          .from('email_history')
          .insert({
            recipient_email: 'system@failed',
            recipient_name: 'SYSTEM - Graph Token Failure',
            sender_email: senderEmail,
            subject: '⚠️ Daily Reminder Emails Failed - Graph API Token Error',
            body: `Graph API token acquisition failed: ${(err as Error).message}. All reminder emails skipped.`,
            status: 'failed',
            sent_by: null,
          });
      }
    }

    for (const pref of prefs) {
      const profile = profileMap.get(pref.user_id);
      const userName = profile?.full_name || 'Unknown';
      const userEmail = profile?.['Email ID'] || null;
      const timezone = profile?.timezone || 'Asia/Kolkata';

      if (!profile) {
        console.log(`[SKIP] User ${pref.user_id}: No profile found`);
        skipped.push({ userId: pref.user_id, reason: 'no_profile' });
        continue;
      }

      const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const dayOfWeek = userNow.getDay();

      // Skip weekends (Saturday=6, Sunday=0)
      if (!testUserId && (dayOfWeek === 0 || dayOfWeek === 6)) {
        console.log(`[SKIP] ${userName} (${pref.user_id}): Weekend (day=${dayOfWeek})`);
        skipped.push({ userId: pref.user_id, reason: 'weekend' });
        continue;
      }

      const userToday = `${userNow.getFullYear()}-${(userNow.getMonth() + 1).toString().padStart(2, '0')}-${userNow.getDate().toString().padStart(2, '0')}`;
      if (!testUserId && pref.last_reminder_sent_at === userToday) {
        console.log(`[SKIP] ${userName} (${pref.user_id}): Already sent today (${userToday})`);
        skipped.push({ userId: pref.user_id, reason: 'already_sent_today' });
        continue;
      }

      const { data: actionItems, error: aiError } = await supabase
        .from('action_items')
        .select('id, title, due_date, priority, status, module_type, module_id')
        .eq('assigned_to', pref.user_id)
        .not('status', 'in', '(Completed,Cancelled)')
        .is('archived_at', null);

      if (aiError) {
        console.error(`[ERROR] Fetching action items for ${userName} (${pref.user_id}):`, aiError);
        skipped.push({ userId: pref.user_id, reason: 'action_items_query_error' });
        continue;
      }

      if (!actionItems || actionItems.length === 0) {
        console.log(`[SKIP] ${userName} (${pref.user_id}): No pending action items`);
        skipped.push({ userId: pref.user_id, reason: 'no_pending_items' });
        continue;
      }

      console.log(`[PROCESS] ${userName} (${pref.user_id}): ${actionItems.length} pending items, email: ${userEmail || 'NONE'}`);

      // Resolve account names for each action item
      const accountMap = new Map<string, string>();
      const directAccountIds: string[] = [];
      const dealModuleIds: string[] = [];

      for (const item of actionItems) {
        if (item.module_type === 'accounts' && item.module_id) {
          directAccountIds.push(item.module_id);
        } else if (item.module_type === 'deals' && item.module_id) {
          dealModuleIds.push(item.module_id);
        }
      }

      // Fetch deals to get customer_name (text) and account_id (FK)
      const dealAccountMap = new Map<string, string>();
      if (dealModuleIds.length > 0) {
        const { data: deals } = await supabase
          .from('deals')
          .select('id, customer_name, account_id')
          .in('id', dealModuleIds);
        console.log(`[DEBUG] deals fetched: ${JSON.stringify(deals)}`);
        if (deals) {
          for (const deal of deals) {
            console.log(`[DEBUG] Processing deal ${deal.id}: customer_name="${deal.customer_name}", account_id="${deal.account_id}"`);
            if (deal.customer_name) {
              dealAccountMap.set(deal.id, deal.customer_name);
            } else if (deal.account_id) {
              dealAccountMap.set(deal.id, deal.account_id);
              directAccountIds.push(deal.account_id);
            }
          }
        }
      }
      console.log(`[DEBUG] dealModuleIds: ${JSON.stringify(dealModuleIds)}`);
      console.log(`[DEBUG] dealAccountMap entries: ${JSON.stringify([...dealAccountMap.entries()])}`);

      // Fetch account names only for direct account links and FK fallbacks
      const uniqueAccountIds = [...new Set(directAccountIds)];
      const accountNameMap = new Map<string, string>();
      if (uniqueAccountIds.length > 0) {
        const { data: accounts } = await supabase
          .from('accounts')
          .select('id, account_name')
          .in('id', uniqueAccountIds);
        if (accounts) {
          for (const acc of accounts) {
            accountNameMap.set(acc.id, acc.account_name);
          }
        }
      }

      // Build actionItemId → accountName map
      for (const item of actionItems) {
        if (item.module_type === 'accounts' && item.module_id) {
          accountMap.set(item.id, accountNameMap.get(item.module_id) || '—');
        } else if (item.module_type === 'deals' && item.module_id) {
          const resolvedName = dealAccountMap.get(item.module_id);
          if (resolvedName) {
            // If it looks like a UUID, it's an account_id needing lookup; otherwise it's customer_name
            const isUUID = /^[0-9a-f]{8}-/.test(resolvedName);
            accountMap.set(item.id, isUUID ? (accountNameMap.get(resolvedName) || '—') : resolvedName);
          }
        }
      }
      console.log(`[DEBUG] final accountMap: ${JSON.stringify([...accountMap.entries()])}`);

      const overdueCount = actionItems.filter(item => {
        if (!item.due_date) return false;
        return new Date(item.due_date) < new Date(userToday);
      }).length;

      const highPriorityCount = actionItems.filter(item => item.priority === 'High').length;

      let message = `📋 Daily Reminder: You have ${actionItems.length} pending action item${actionItems.length > 1 ? 's' : ''}`;
      const details: string[] = [];
      if (overdueCount > 0) details.push(`${overdueCount} overdue`);
      if (highPriorityCount > 0) details.push(`${highPriorityCount} high priority`);
      if (details.length > 0) message += ` (${details.join(', ')})`;

      const { error: notifError } = await supabase
        .from('notifications')
        .insert({
          user_id: pref.user_id,
          message,
          notification_type: 'task_reminder',
          status: 'unread',
        });

      if (notifError) {
        console.error(`[ERROR] Inserting notification for ${userName} (${pref.user_id}):`, notifError);
        continue;
      }

      notificationsSent++;
      console.log(`[OK] In-app notification sent to ${userName}`);

      // Send email if enabled and Graph token available
      if (pref.email_notifications && graphToken && profile) {
        if (userEmail) {
          try {
            const subject = overdueCount > 0
              ? `⚠️ ${overdueCount} Overdue Action Items - Daily Reminder`
              : `📋 ${actionItems.length} Pending Action Items - Daily Reminder`;

            const htmlBody = buildReminderEmail(userName, actionItems, overdueCount, highPriorityCount, appUrl, accountMap);
            const sent = await sendEmailViaGraph(graphToken, userEmail, userName, subject, htmlBody);

            if (sent) {
              emailsSent++;
              console.log(`[OK] Email sent to ${userEmail} (${userName})`);

              // Record in email_history with 'delivered' status
              const senderEmail = Deno.env.get('AZURE_SENDER_EMAIL') || 'system@crm.realthingks.com';
              await supabase
                .from('email_history')
                .insert({
                  recipient_email: userEmail,
                  recipient_name: userName,
                  sender_email: senderEmail,
                  subject,
                  body: htmlBody,
                  status: 'delivered',
                  sent_by: pref.user_id,
                  delivered_at: new Date().toISOString(),
                });
            } else {
              console.error(`[FAIL] Email failed for ${userEmail} (${userName})`);
              // Log failed email to email_history for visibility
              const senderEmail = Deno.env.get('AZURE_SENDER_EMAIL') || 'system@crm.realthingks.com';
              await supabase
                .from('email_history')
                .insert({
                  recipient_email: userEmail,
                  recipient_name: userName,
                  sender_email: senderEmail,
                  subject,
                  body: htmlBody,
                  status: 'failed',
                  sent_by: pref.user_id,
                });
            }
          } catch (emailErr) {
            console.error(`[ERROR] Sending email to ${userEmail} (${userName}):`, emailErr);
          }
        } else {
          console.log(`[SKIP-EMAIL] ${userName} (${pref.user_id}): No email address in profile`);
        }
      } else if (!pref.email_notifications) {
        console.log(`[SKIP-EMAIL] ${userName}: email_notifications disabled`);
      } else if (!graphToken) {
        console.log(`[SKIP-EMAIL] ${userName}: No Graph token available`);
      }

      // Update last_reminder_sent_at
      await supabase
        .from('notification_preferences')
        .update({ last_reminder_sent_at: userToday })
        .eq('user_id', pref.user_id);
    }

    const summary = {
      message: `Processed ${prefs.length} users, sent ${notificationsSent} in-app reminders, ${emailsSent} emails`,
      processed: prefs.length,
      notifications_sent: notificationsSent,
      emails_sent: emailsSent,
      skipped: skipped,
    };
    console.log(`[SUMMARY] ${JSON.stringify(summary)}`);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[FATAL] Error in daily-action-reminders:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
