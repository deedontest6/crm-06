import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

interface QuarterlyData {
  q1: number;
  q2: number;
  q3: number;
  q4: number;
}

interface YearlyRevenueData {
  year: number;
  target: number;
  actualRevenue: QuarterlyData;
  projectedRevenue: QuarterlyData;
  totalActual: number;
  totalProjected: number;
  hasDeals: boolean;
}

const REVENUE_FIELDS =
  "stage,total_revenue,total_contract_value,quarterly_revenue_q1,quarterly_revenue_q2,quarterly_revenue_q3,quarterly_revenue_q4,expected_closing_date,signed_contract_date";

export const useYearlyRevenueData = (selectedYear: number) => {
  const { data: revenueData, isLoading, error } = useQuery({
    queryKey: ['yearly-revenue', selectedYear],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<YearlyRevenueData> => {
      const yearStart = `${selectedYear}-01-01`;
      const yearEnd = `${selectedYear}-12-31`;

      // Get yearly target
      const { data: targetData } = await supabase
        .from('yearly_revenue_targets')
        .select('total_target')
        .eq('year', selectedYear)
        .maybeSingle();

      // Server-side year filter: deals where either expected_closing_date OR signed_contract_date is in the year
      const { data: dealsForYear } = await supabase
        .from('deals')
        .select(REVENUE_FIELDS)
        .or(
          `and(expected_closing_date.gte.${yearStart},expected_closing_date.lte.${yearEnd}),and(signed_contract_date.gte.${yearStart},signed_contract_date.lte.${yearEnd})`
        );

      if (!dealsForYear || dealsForYear.length === 0) {
        return {
          year: selectedYear,
          target: targetData?.total_target || 0,
          actualRevenue: { q1: 0, q2: 0, q3: 0, q4: 0 },
          projectedRevenue: { q1: 0, q2: 0, q3: 0, q4: 0 },
          totalActual: 0,
          totalProjected: 0,
          hasDeals: false,
        };
      }

      const wonDeals = dealsForYear.filter((d: any) => d.stage === 'Won');
      const rfqDeals = dealsForYear.filter((d: any) => d.stage === 'RFQ');

      const actualRevenue: QuarterlyData = { q1: 0, q2: 0, q3: 0, q4: 0 };
      const projectedRevenue: QuarterlyData = { q1: 0, q2: 0, q3: 0, q4: 0 };
      let totalActualRevenue = 0;
      let totalProjectedRevenue = 0;

      wonDeals.forEach((deal: any) => {
        const revenue = Number(deal.total_revenue);
        if (!isNaN(revenue) && deal.total_revenue) {
          totalActualRevenue += revenue;
          (['q1', 'q2', 'q3', 'q4'] as const).forEach((q) => {
            const v = Number(deal[`quarterly_revenue_${q}`]);
            if (!isNaN(v)) actualRevenue[q] += v;
          });
        }
      });

      rfqDeals.forEach((deal: any) => {
        const cv = Number(deal.total_contract_value);
        if (isNaN(cv) || !deal.total_contract_value) return;
        totalProjectedRevenue += cv;
        if (!deal.expected_closing_date) return;
        try {
          const closingDate = new Date(deal.expected_closing_date);
          if (closingDate.getFullYear() !== selectedYear) return;
          const month = closingDate.getMonth() + 1;
          const quarter: keyof QuarterlyData =
            month <= 3 ? 'q1' : month <= 6 ? 'q2' : month <= 9 ? 'q3' : 'q4';
          projectedRevenue[quarter] += cv;
        } catch { /* skip */ }
      });

      return {
        year: selectedYear,
        target: targetData?.total_target || 0,
        actualRevenue,
        projectedRevenue,
        totalActual: totalActualRevenue,
        totalProjected: totalProjectedRevenue,
        hasDeals: true,
      };
    },
  });

  return { revenueData, isLoading, error };
};

export const useAvailableYears = () => {
  const { data: years, isLoading } = useQuery({
    queryKey: ['available-years'],
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<number[]> => {
      const { data: deals } = await supabase
        .from('deals')
        .select('expected_closing_date')
        .not('expected_closing_date', 'is', null);

      const { data: targets } = await supabase
        .from('yearly_revenue_targets')
        .select('year');

      const yearSet = new Set<number>();
      yearSet.add(new Date().getFullYear());
      deals?.forEach((deal) => {
        if (deal.expected_closing_date) {
          yearSet.add(new Date(deal.expected_closing_date).getFullYear());
        }
      });
      targets?.forEach((t) => yearSet.add(t.year));
      return Array.from(yearSet).sort((a, b) => b - a);
    },
  });

  return { years: years || [], isLoading };
};

export const useDashboardStats = () => {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: deals } = await supabase
        .from('deals')
        .select('stage,total_revenue');

      const totalDeals = deals?.length || 0;
      let totalRevenue = 0;
      let wonDeals = 0;
      deals?.forEach((deal: any) => {
        if (deal.stage === 'Won') {
          wonDeals++;
          if (deal.total_revenue) {
            const revenue = Number(deal.total_revenue);
            if (!isNaN(revenue)) totalRevenue += revenue;
          }
        }
      });

      return { totalDeals, totalRevenue, wonDeals, todayMeetings: 0 };
    },
  });

  return { stats, isLoading };
};
