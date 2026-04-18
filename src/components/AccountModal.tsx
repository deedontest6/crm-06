import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCRUDAudit } from "@/hooks/useCRUDAudit";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { countries, regions, countryToRegion } from "@/utils/countryRegionMapping";
import { useMemo } from "react";

const accountSchema = z.object({
  account_name: z.string().min(1, "Account name is required"),
  phone: z.string().optional(),
  website: z.string().optional(),
  industry: z.string().optional(),
  company_type: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  status: z.string().optional(),
  description: z.string().optional(),
  currency: z.string().optional(),
});

type AccountFormData = z.infer<typeof accountSchema>;

interface Account {
  id: string;
  account_name: string;
  phone?: string;
  website?: string;
  industry?: string;
  company_type?: string;
  country?: string;
  region?: string;
  status?: string;
  description?: string;
  currency?: string;
}

interface AccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: Account | null;
  onSuccess: () => void;
}

const industries = ["Automotive", "Technology", "Manufacturing", "Healthcare", "Finance", "Retail", "Other"];
const companyTypes = ["OEM", "Tier-1", "Tier-2", "Other"];
const statuses = ["New", "Working", "Qualified", "Inactive"];
const currencies = ["EUR", "USD", "INR"];

export const AccountModal = ({ open, onOpenChange, account, onSuccess }: AccountModalProps) => {
  const { toast } = useToast();
  const { logCreate, logUpdate } = useCRUDAudit();
  const [loading, setLoading] = useState(false);

  const form = useForm<AccountFormData>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      account_name: "",
      phone: "",
      website: "",
      industry: "Automotive",
      company_type: "",
      region: "EU",
      country: "",
      status: "New",
      description: "",
      currency: "EUR",
    },
  });

  useEffect(() => {
    if (account) {
      form.reset({
        account_name: account.account_name || "",
        phone: account.phone || "",
        website: account.website || "",
        industry: account.industry || "Automotive",
        company_type: account.company_type || "",
        region: account.region || "EU",
        country: account.country || "",
        status: account.status || "New",
        description: account.description || "",
        currency: account.currency || "EUR",
      });
    } else {
      form.reset({
        account_name: "",
        phone: "",
        website: "",
        industry: "Automotive",
        company_type: "",
        region: "EU",
        country: "",
        status: "New",
        description: "",
        currency: "EUR",
      });
    }
  }, [account, form]);

  // Auto-update region when country changes
  const watchedCountry = form.watch("country");
  const watchedRegion = form.watch("region");

  useEffect(() => {
    if (watchedCountry && countryToRegion[watchedCountry]) {
      form.setValue("region", countryToRegion[watchedCountry]);
    }
  }, [watchedCountry, form]);

  // Filter countries based on selected region
  const filteredCountries = useMemo(() => {
    if (!watchedRegion) return countries;
    return countries.filter(c => countryToRegion[c] === watchedRegion);
  }, [watchedRegion]);

  const onSubmit = async (data: AccountFormData) => {
    try {
      setLoading(true);
      const user = await supabase.auth.getUser();
      
      if (!user.data.user) {
        toast({ title: "Error", description: "You must be logged in to perform this action", variant: "destructive" });
        return;
      }

      if (account) {
        // UPDATE: only set modified_by, preserve original account_owner
        const updateData = {
          account_name: data.account_name,
          phone: data.phone || null,
          website: data.website || null,
          industry: data.industry || null,
          company_type: data.company_type || null,
          region: data.region || null,
          country: data.country || null,
          status: data.status || 'New',
          description: data.description || null,
          currency: data.currency || 'EUR',
          modified_by: user.data.user.id,
          modified_time: new Date().toISOString(),
        };

        const { error } = await supabase
          .from('accounts')
          .update(updateData)
          .eq('id', account.id);
        if (error) throw error;
        await logUpdate('accounts', account.id, updateData, account);
        toast({ title: "Success", description: "Account updated successfully" });
      } else {
        // CREATE: set account_owner, created_by, modified_by
        const insertData = {
          account_name: data.account_name,
          phone: data.phone || null,
          website: data.website || null,
          industry: data.industry || null,
          company_type: data.company_type || null,
          region: data.region || null,
          country: data.country || null,
          status: data.status || 'New',
          description: data.description || null,
          currency: data.currency || 'EUR',
          created_by: user.data.user.id,
          modified_by: user.data.user.id,
          account_owner: user.data.user.id,
        };

        const { data: newAccount, error } = await supabase
          .from('accounts')
          .insert(insertData)
          .select()
          .single();
        if (error) throw error;
        await logCreate('accounts', newAccount.id, insertData);
        toast({ title: "Success", description: "Account created successfully" });
      }

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving account:', error);
      toast({ title: "Error", description: account ? "Failed to update account" : "Failed to create account", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{account ? "Edit Account" : "Add New Account"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Row 1: Account Name + Industry */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField control={form.control} name="account_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Account Name *</FormLabel>
                  <FormControl><Input placeholder="Company Name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="industry" render={({ field }) => (
                <FormItem>
                  <FormLabel>Industry</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select industry" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {industries.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Row 2: Description (full width) */}
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl><Textarea placeholder="Additional notes about the account..." className="min-h-20" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Row 3: Website + Phone */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField control={form.control} name="website" render={({ field }) => (
                <FormItem>
                  <FormLabel>Website</FormLabel>
                  <FormControl><Input placeholder="www.example.com" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl><Input placeholder="+1 234 567 8900" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Row 4: Region + Country */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField control={form.control} name="region" render={({ field }) => (
                <FormItem>
                  <FormLabel>Region</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select region" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {regions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="country" render={({ field }) => (
                <FormItem>
                  <FormLabel>Country</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger></FormControl>
                    <SelectContent className="max-h-[300px]">
                      {filteredCountries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Row 5: Company Type + Currency + Status */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField control={form.control} name="company_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Company Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {companyTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="currency" render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select currency" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {currencies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : account ? "Save Changes" : "Add Account"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
