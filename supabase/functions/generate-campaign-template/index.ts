// Edge function: Generate campaign templates (email/linkedin/phone) using Lovable AI Gateway
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type TemplateType = "email" | "linkedin-connection" | "linkedin-followup" | "phone";

const toolByType: Record<TemplateType, any> = {
  email: {
    type: "function",
    function: {
      name: "return_email_template",
      description: "Return a structured email template",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Compelling subject line, max 80 chars. Use {company_name} or {first_name} where natural." },
          body: { type: "string", description: "Email body, professional, 100-200 words. MUST include personalization placeholders: {first_name}, {company_name}, {position}. May also use {country}, {region}, {owner_name}." },
        },
        required: ["subject", "body"],
        additionalProperties: false,
      },
    },
  },
  "linkedin-connection": {
    type: "function",
    function: {
      name: "return_linkedin_connection",
      description: "Return a LinkedIn connection request message (max 300 chars)",
      parameters: {
        type: "object",
        properties: {
          body: { type: "string", description: "Personal connection request, MAX 300 characters. MUST include {first_name} and ideally {company_name}." },
        },
        required: ["body"],
        additionalProperties: false,
      },
    },
  },
  "linkedin-followup": {
    type: "function",
    function: {
      name: "return_linkedin_followup",
      description: "Return a LinkedIn follow-up message (max 1000 chars)",
      parameters: {
        type: "object",
        properties: {
          body: { type: "string", description: "Follow-up after connection accepted, MAX 1000 characters. MUST include {first_name}, {company_name} and reference {position} where natural." },
        },
        required: ["body"],
        additionalProperties: false,
      },
    },
  },
  phone: {
    type: "function",
    function: {
      name: "return_phone_script",
      description: "Return a structured phone call script",
      parameters: {
        type: "object",
        properties: {
          opening_script: { type: "string", description: "30-second opening pitch. MUST include {first_name} and {company_name}." },
          talking_points: { type: "array", items: { type: "string" }, description: "3-5 key talking points tailored to the campaign goal" },
          discovery_questions: { type: "array", items: { type: "string" }, description: "3-5 discovery questions to qualify the prospect" },
          objections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                objection: { type: "string" },
                response: { type: "string" },
              },
              required: ["objection", "response"],
              additionalProperties: false,
            },
            description: "2-3 common objections with responses",
          },
        },
        required: ["opening_script", "talking_points", "discovery_questions", "objections"],
        additionalProperties: false,
      },
    },
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { templateType, campaignContext, userInstructions, tone, length } = body as {
      templateType: TemplateType;
      campaignContext: {
        campaign_name: string;
        campaign_type?: string;
        goal?: string;
        regions?: string[];
        selectedCountries?: string[];
        accountCount?: number;
        contactCount?: number;
        sampleIndustries?: string[];
        samplePositions?: string[];
      };
      userInstructions?: string;
      tone?: string;
      length?: string;
    };

    if (!templateType || !toolByType[templateType]) {
      return new Response(JSON.stringify({ error: "Invalid templateType" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ctx = campaignContext || ({} as any);
    const contextLines: string[] = [
      `Campaign: ${ctx.campaign_name || "Untitled"}`,
      ctx.campaign_type ? `Type: ${ctx.campaign_type}` : "",
      ctx.goal ? `Goal: ${ctx.goal}` : "",
      ctx.regions?.length ? `Target regions: ${ctx.regions.join(", ")}` : "",
      ctx.selectedCountries?.length ? `Target countries: ${ctx.selectedCountries.join(", ")}` : "",
      ctx.accountCount ? `Audience: ${ctx.accountCount} accounts, ${ctx.contactCount || 0} contacts` : "",
      ctx.sampleIndustries?.length ? `Industries: ${ctx.sampleIndustries.slice(0, 5).join(", ")}` : "",
      ctx.samplePositions?.length ? `Roles: ${ctx.samplePositions.slice(0, 5).join(", ")}` : "",
    ].filter(Boolean);

    const toneText = tone ? `Tone: ${tone}.` : "Tone: professional and concise.";
    const lengthText = length ? `Length: ${length}.` : "";

    const systemPrompt = `You are an expert B2B outreach copywriter. Generate a ${templateType} template that is concise, personal, value-focused, and avoids generic salesy language. ${toneText} ${lengthText}

CRITICAL: You MUST use these placeholders in your output so they auto-fill per recipient at send time:
- {first_name} — recipient's first name (always use)
- {company_name} — recipient's company (use when natural)
- {position} — recipient's job title (use when relevant)
- {country} — recipient's country (use for region-aware messaging)
- {region} — recipient's region
- {owner_name} — campaign owner's name (use in sign-offs)

Do NOT invent fake personalization — always use the placeholders above instead of made-up names or companies.`;

    const userPrompt = `Campaign context:\n${contextLines.join("\n")}\n\n${userInstructions ? `Additional instructions / angle:\n${userInstructions}` : ""}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [toolByType[templateType]],
        tool_choice: { type: "function", function: { name: toolByType[templateType].function.name } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in Settings → Workspace → Usage." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const errText = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, errText);
      return new Response(JSON.stringify({ error: "AI generation failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await aiResp.json();
    const toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ error: "AI returned no structured output" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const result = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-campaign-template error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
